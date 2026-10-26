import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requestedDeliveryDate } from '../logistics/logistics-conversion';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { ASSIGNABLE_USER_WHERE, REASSIGN_ROLES } from '../auth/role-groups';
import { LeadCustomFieldsService } from '../lead-custom-fields/lead-custom-fields.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LeadAssignmentEngine } from '../assignment-rules/lead-assignment.engine';
import { TagAccessService } from '../tag-access/tag-access.service';
import {
  DuplicateCandidate,
  duplicateWhere,
  matchedField,
  pickOriginal,
} from './lead-duplicates';
import { userActor } from '../audit/audit-events';
import {
  auditLeadChanges,
  recordLeadsCreated,
  withLogisticsOrder,
} from './lead-audit';

import { LeadsRepository } from './leads.repository';
import { leadScopeWhere } from './lead-scope';
import {
  assertMayChangeLead,
  assertMayMoveLead,
  assertPipelineOpen,
} from '../pipelines/pipeline-access';
import { buildLeadWhere, withSearchScope } from './lead-where';
import { firstStageName, stageOfPipeline } from '../stages/stages.service';
import {
  LeadActivity,
  LeadEditData,
  LeadListItem,
  LeadListResponse,
  LeadTimelineEvent,
  buildLeadTimeline,
  toLeadActivity,
  toLeadEditData,
  toLeadListItem,
} from './dto/lead-response.dto';
import { AgentOption, LeadFilterOptions } from './dto/lead-filter-options.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import {
  DuplicateCheckQueryDto,
  DuplicateCheckResponse,
  LeadDuplicateLinks,
  RelatedLead,
} from './dto/lead-duplicates.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';

/** At most this many matches are reported; the warning names examples, not a list. */
const MAX_DUPLICATE_MATCHES = 5;

/** Just enough of a matched lead to explain the match to the New Lead form's warning. */
const DUPLICATE_MATCH_SELECT = {
  id: true,
  name: true,
  status: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
} satisfies Prisma.LeadSelect;

type DuplicateLeadRow = Prisma.LeadGetPayload<{
  select: typeof DUPLICATE_MATCH_SELECT;
}>;

/**
 * The oldest matches considered when choosing the original. A customer with this many earlier
 * leads has had an original recorded long before the 50th, so the oldest are the ones that matter.
 */
const MAX_ORIGINAL_CANDIDATES = 50;

/** The most duplicates of one lead the detail view lists. */
const MAX_RELATED_LEADS = 50;

const RELATED_LEAD_SELECT = {
  id: true,
  name: true,
  status: true,
  pipeline: true,
  primaryPhone: true,
  createdAt: true,
} satisfies Prisma.LeadSelect;

function toRelatedLead(
  row: Prisma.LeadGetPayload<{ select: typeof RELATED_LEAD_SELECT }>,
): RelatedLead {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Lead reads (LEAD-02.1, LEAD-03.1, LEAD-03.2).
 *
 * The `where` is composed as an AND of independent fragments — scope, then
 * search, then each active field filter — so every concern stays isolated and
 * none can be forgotten or widen another. Sort and pagination are applied by the
 * repository over that same composed `where`, so they combine with search and
 * filters without any special case (AC4).
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly repository: LeadsRepository,
    private readonly currentUser: CurrentUserService,
    private readonly customFields: LeadCustomFieldsService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly assignment: LeadAssignmentEngine,
    private readonly tagAccess: TagAccessService,
    private readonly config: ConfigService,
  ) {}

  async list(query: ListLeadsQueryDto): Promise<LeadListResponse> {
    const user = await this.currentUser.resolve();
    const where = await this.listWhere(user, query);

    // The caller's pins within this exact view drive the pinned-first order
    // (ADR-0031). Resolved per-request from the current user, never the client.
    const pinnedIds = await this.repository.pinnedLeadIds(user.id, where);

    const { pinnedRows, unpinnedRows, total } = await this.repository.findPage({
      where,
      sort: query.sort,
      direction: query.direction,
      skip: (query.page - 1) * query.size,
      take: query.size,
      pinnedIds,
    });

    const rows = [
      ...pinnedRows.map((row) => toLeadListItem(row, true)),
      ...unpinnedRows.map((row) => toLeadListItem(row, false)),
    ];
    return { rows, total };
  }

  /**
   * One lead for the Lead Detail page. Scoped like the list, so an out-of-scope,
   * unknown or soft-deleted id is a 404 — never a cross-scope read (the graceful
   * missing/deleted state the page renders). Returns the same shape as a list
   * row, so nothing wider than the list is exposed.
   */
  async findById(id: string): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();
    const lead = await this.repository.findById({
      AND: [leadScopeWhere(user), { id }],
    });
    if (!lead) {
      throw new NotFoundException(
        'That lead does not exist or is not in your scope.',
      );
    }
    return toLeadListItem(lead);
  }

  /**
   * Pins or unpins a lead for the current caller (ADR-0031, LEAD-10.2).
   *
   * Personal, not shared: it only reorders the caller's own list, so the pin is
   * keyed by the server-resolved user — a client cannot pin as someone else.
   * Scoped like every single-lead op: an out-of-scope, unknown or soft-deleted
   * id is a 404, never a cross-scope write. Idempotent — pinning an already
   * pinned lead (or unpinning an unpinned one) is a no-op — and returns the lead
   * in its resulting state so the row can reflect it.
   */
  async setPinned(id: string, pinned: boolean): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();
    const lead = await this.repository.findById({
      AND: [leadScopeWhere(user), { id }],
    });
    if (!lead) {
      throw new NotFoundException(
        'That lead does not exist or is not in your scope.',
      );
    }
    if (pinned) await this.repository.pin(user.id, id);
    else await this.repository.unpin(user.id, id);
    return toLeadListItem(lead, pinned);
  }

  /**
   * The values the filter panel offers for each field (LEAD-03.3), scoped to the
   * caller's leads. Source and Status are faceted from the data (they are
   * free-text, with no enum to enumerate). The agent list is the assignees the
   * caller may filter by: a sales agent can only ever filter by themselves — the
   * scope hides other agents' leads — so returning only self keeps a colleague's
   * name out of an agent's UI even when they share a lead.
   */
  async filterOptions(): Promise<LeadFilterOptions> {
    const user = await this.currentUser.resolve();
    const scope = leadScopeWhere(user);

    const [sources, statuses, agents, tags] = await Promise.all([
      this.repository.distinctSources(scope),
      this.repository.distinctStatuses(scope),
      this.agentOptions(user, scope),
      this.repository.distinctTags(scope),
    ]);

    return { sources, statuses, agents, tags };
  }

  private async agentOptions(
    user: CurrentUser,
    scope: Prisma.LeadWhereInput,
  ): Promise<AgentOption[]> {
    if (user.role === UserRole.SALES_AGENT) {
      const self = await this.repository.findUserSummary(user.id);
      return self ? [{ ...self, reportingToId: null }] : [];
    }
    return this.repository.assigneesOf(scope);
  }

  /** Users the New Lead form can assign a lead to (LEAD-06.2). */
  async assignableAgents(): Promise<{ id: string; name: string }[]> {
    return this.repository.assignableUsers();
  }

  /**
   * Creates a lead from the New Lead form (LEAD-06.1).
   *
   * Defaults are applied here, not in the DB, so an omitted value becomes the
   * Workpex default rather than null (AC3/AC4). A sales agent only sees leads
   * assigned to them, so a lead they create with no assignee would be invisible
   * to its own author — the creator is auto-added in that case. Assignments,
   * tags and the optional complaint are created in the same statement, so a
   * failure leaves no half-built lead.
   */
  async create(dto: CreateLeadDto): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();

    // Tag Permissions (ADR-0091): before any side effect.
    await this.tagAccess.assertMayHandle(user, dto.tagIds ?? []);

    const pipeline = dto.pipeline || 'Lead Pipeline';
    // Only into a pipeline open to the caller (ADR-0093 B6), before its stages are read.
    assertPipelineOpen(user, pipeline);
    const status = await this.newLeadStatus(pipeline, dto.status);

    /*
      A duplicate is always created — as its own lead, with its own status — and records which
      earlier lead it duplicates (ADR-0092). Nothing about a matching lead can refuse, change or
      merge into the create: the matching rule is fixed (primary phone, secondary phone, email)
      and the only setting that touches it is whether archived leads count as the original
      (Duplicate Settings → "Check archived leads for duplicates?"). Read once, so creating a
      lead costs one settings read.
    */
    const config = await this.settings.getSalesCrmDuplicate();
    const duplicateOfId = await this.findOriginalId(
      dto,
      config.checkArchivedLeads,
    );

    const assigneeIds = new Set(dto.assignedAgentIds ?? []);
    if (user.role === UserRole.SALES_AGENT) assigneeIds.add(user.id);
    await this.assertMayAssign(user, assigneeIds, null);

    /*
      Automatic assignment (Settings → Assignment) only fills a gap: a lead the form
      already routed to someone keeps that choice, because an explicit assignee is a
      decision and the rule is a fallback for when nobody made one. The engine returns
      null whenever the feature is off, no active rule applies, or no agent is eligible,
      and it never throws — an unassigned lead is the state this create had before.
    */
    let autoAssigned = false;
    if (assigneeIds.size === 0) {
      const auto = await this.assignment.pickAssignee();
      if (auto) {
        assigneeIds.add(auto);
        autoAssigned = true;
      }
    }

    const customFieldValues = await this.customFields.prepareValues(
      dto.customFields,
    );

    const data: Prisma.LeadCreateInput = {
      name: dto.name,
      firstName: dto.firstName ?? null,
      primaryPhone: dto.primaryPhone,
      secondaryPhone: dto.secondaryPhone ?? null,
      email: dto.email ?? null,
      language: dto.language ?? null,
      country: dto.country ?? null,
      source: dto.source ?? null,
      status,
      pipeline,
      duplicateOf: duplicateOfId
        ? { connect: { id: duplicateOfId } }
        : undefined,
      product: dto.product ?? null,
      productQty: dto.productQty ?? null,
      product2: dto.product2 ?? null,
      product2Qty: dto.product2Qty ?? null,
      bookingDate: dto.bookingDate ? new Date(dto.bookingDate) : null,
      category: dto.category || 'Default',
      actualAmount: dto.actualAmount ?? null,
      forecastedAmount: dto.forecastedAmount ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      state: dto.state ?? null,
      street: dto.street ?? null,
      city: dto.city ?? null,
      nationalCode: dto.nationalCode ?? null,
      callStatus: dto.callStatus ?? null,
      callAttempts: dto.callAttempts ?? 0,
      whatsappAttempts: dto.msgAttempts ?? 0,
      assignments: assigneeIds.size
        ? {
            create: [...assigneeIds].map((userId) => ({
              user: { connect: { id: userId } },
            })),
          }
        : undefined,
      tags: dto.tagIds?.length
        ? {
            create: dto.tagIds.map((tagId) => ({
              tag: { connect: { id: tagId } },
            })),
          }
        : undefined,
      complaints: dto.complaintReason
        ? { create: [{ details: dto.complaintReason, status: 'Open' }] }
        : undefined,
      customFieldValues: customFieldValues.length
        ? {
            create: customFieldValues.map((v) => ({
              customField: { connect: { id: v.customFieldId } },
              value: v.value,
            })),
          }
        : undefined,
    };

    try {
      const lead = await this.prisma.$transaction(async (tx) => {
        const created = await this.repository.create(data, tx);
        await recordLeadsCreated(tx, [created.id], {
          actor: userActor(user),
          source: 'leads.create',
          metadata: autoAssigned ? { autoAssigned: true } : undefined,
          deliveryDate: requestedDeliveryDate(dto.deliveryDate, this.config),
        });
        return withLogisticsOrder(tx, created);
      });
      return toLeadListItem(lead);
    } catch (error) {
      // A bad agent or tag id fails the foreign key; report it as a 400, not 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2025')
      ) {
        throw new BadRequestException(
          'One or more assigned agents or tags do not exist.',
        );
      }
      throw error;
    }
  }

  /**
   * What the New Lead form shows before it saves: the existing leads this enquiry would
   * duplicate (ADR-0092). It uses the same rule and the same Duplicate Settings as `create`,
   * so the warning and the outcome cannot disagree — and it is only ever a warning: the lead is
   * created either way. Detection is global — a duplicate is a
   * duplicate whoever owns it — but what is *revealed* is scoped: a match the caller cannot
   * open comes back as `restricted`, with no id, name or status.
   */
  async checkDuplicates(
    query: DuplicateCheckQueryDto,
  ): Promise<DuplicateCheckResponse> {
    const user = await this.currentUser.resolve();
    const config = await this.settings.getSalesCrmDuplicate();
    const candidate: DuplicateCandidate = {
      primaryPhone: query.primaryPhone ?? '',
      secondaryPhone: query.secondaryPhone,
      email: query.email,
    };

    const found = await this.findDuplicates(
      candidate,
      config.checkArchivedLeads,
    );
    if (found.length === 0) return { matches: [] };

    const openable = await this.prisma.lead.findMany({
      where: {
        AND: [leadScopeWhere(user), { id: { in: found.map((m) => m.id) } }],
      },
      select: { id: true },
    });
    const visible = new Set(openable.map((lead) => lead.id));

    return {
      matches: found.map((match) => {
        const matchedOn = matchedField(candidate, match);
        return visible.has(match.id)
          ? {
              id: match.id,
              name: match.name,
              status: match.status,
              matchedOn,
              restricted: false,
            }
          : { id: null, name: null, status: null, matchedOn, restricted: true };
      }),
    };
  }

  /**
   * A lead's place in its duplicate group (ADR-0092): the original it duplicates and the leads
   * recorded as duplicates of it. Scoped like every single-lead read — the lead itself is a 404
   * out of scope — and so is each related lead: one the caller cannot open is left out and only
   * counted in `hasHidden`, so no name, phone or status of a restricted lead reaches them.
   */
  async getDuplicateLinks(id: string): Promise<LeadDuplicateLinks> {
    const user = await this.currentUser.resolve();
    const scope = leadScopeWhere(user);

    const lead = await this.prisma.lead.findFirst({
      where: { AND: [scope, { id }] },
      select: { duplicateOfId: true },
    });
    if (!lead) {
      throw new NotFoundException(
        'That lead does not exist or is not in your scope.',
      );
    }

    const [original, duplicates, duplicateTotal] = await Promise.all([
      lead.duplicateOfId
        ? this.prisma.lead.findFirst({
            where: { AND: [scope, { id: lead.duplicateOfId }] },
            select: RELATED_LEAD_SELECT,
          })
        : null,
      this.prisma.lead.findMany({
        where: { AND: [scope, { duplicateOfId: id }] },
        select: RELATED_LEAD_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: MAX_RELATED_LEADS,
      }),
      this.prisma.lead.count({ where: { duplicateOfId: id } }),
    ]);

    return {
      original: original ? toRelatedLead(original) : null,
      duplicates: duplicates.map(toRelatedLead),
      hasHidden:
        (lead.duplicateOfId !== null && original === null) ||
        duplicateTotal > duplicates.length,
    };
  }

  /**
   * The full editable record for the Edit Lead form (LEAD-06 edit mode). Scoped
   * exactly like findById — an out-of-scope, unknown or soft-deleted id is a 404,
   * never a cross-scope read — but projected wide enough to prefill every field
   * the form carries, including the ones the list never shows.
   */
  async getForEdit(id: string): Promise<LeadEditData> {
    const user = await this.currentUser.resolve();
    const row = await this.repository.findEditById({
      AND: [leadScopeWhere(user), { id }],
    });
    if (!row) {
      throw new NotFoundException(
        'That lead does not exist or is not in your scope.',
      );
    }
    return toLeadEditData(row);
  }

  /**
   * The Lead Detail timeline (Lead Detail drawer). Scoped like every single-lead
   * read — an out-of-scope/unknown/deleted id is a 404 — then aggregates the facts
   * the system truly records: the lead's creation, its assignments, notes and calls,
   * and its status moves (from the audit log, ADR-0083). Email sends and the actor
   * behind create/assign are not tracked, so they are absent by design rather than
   * fabricated (partial-but-honest, per the approved decision). Newest first.
   */
  async getTimeline(id: string): Promise<LeadTimelineEvent[]> {
    const user = await this.currentUser.resolve();
    const lead = await this.repository.findById({
      AND: [leadScopeWhere(user), { id }],
    });
    if (!lead) {
      throw new NotFoundException(
        'That lead does not exist or is not in your scope.',
      );
    }

    const [assignments, notes, calls, statusChanges] = await Promise.all([
      this.repository.assignmentsForTimeline(id),
      this.repository.notesForTimeline(id),
      this.repository.callsForTimeline(id),
      this.repository.statusChangesForTimeline(id),
    ]);

    return buildLeadTimeline(
      lead.id,
      lead.createdAt,
      assignments,
      notes,
      calls,
      statusChanges,
    );
  }

  /**
   * A lead's follow-ups for the Lead Detail drawer (ACT-03.2 / ACT-04.1). Scoped
   * like the timeline read — an out-of-scope/unknown/deleted id is a 404 — then
   * returns the lead's activities (earliest due first). The drawer derives its Next
   * Follow-up card and its Follow-up Created/Completed timeline entries from these.
   */
  async getActivities(id: string): Promise<LeadActivity[]> {
    const user = await this.currentUser.resolve();
    const lead = await this.repository.findById({
      AND: [leadScopeWhere(user), { id }],
    });
    if (!lead) {
      throw new NotFoundException(
        'That lead does not exist or is not in your scope.',
      );
    }

    const rows = await this.repository.activitiesForLead(id);
    return rows.map(toLeadActivity);
  }

  /**
   * Updates a lead from the Edit Lead form (LEAD-06 edit mode) — the same form
   * that creates one, so the payload and defaults match create. Scoped like every
   * single-lead op: an out-of-scope/unknown id is a 404, never a cross-scope write.
   * A sales agent stays on their own lead's assignee list (as in create) so an edit
   * cannot make the lead vanish from its editor's view. Assignments and tags are
   * full-replaced in a transaction (repository.update); a bad agent/tag id fails the
   * foreign key and surfaces as a 400, leaving the lead untouched.
   */
  async update(id: string, dto: CreateLeadDto): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();
    const existing = await this.repository.findById({
      AND: [leadScopeWhere(user), { id }],
    });
    if (!existing) {
      throw new NotFoundException(
        'That lead does not exist or is not in your scope.',
      );
    }
    // A lead an agent sees only because it is assigned to them, in a pipeline closed to them,
    // is theirs to view, not to edit (ADR-0093 B2).
    assertMayChangeLead(user, existing);

    // Tag Permissions (ADR-0091): only the tags this edit adds or removes need the caller's
    // permission. A tag already on the lead that the edit leaves alone is untouched, so a user
    // who may not select it can still edit everything else without losing it.
    const before = new Set(existing.tags.map((entry) => entry.tag.id));
    const after = new Set(dto.tagIds ?? []);
    await this.tagAccess.assertMayHandle(user, [
      ...[...after].filter((tagId) => !before.has(tagId)),
      ...[...before].filter((tagId) => !after.has(tagId)),
    ]);

    // An edit that leaves Status or Pipeline out keeps the lead's own. It never falls back to
    // a default, which silently moved the lead to its pipeline's first stage (or to Lead
    // Pipeline). The pair is checked only when it changes, so a lead saved before the rule
    // still takes edits to its other fields.
    const pipeline = dto.pipeline ?? existing.pipeline;
    const status = dto.status ?? existing.status;
    // A changed Pipeline is a move: managers and administrators only, into a pipeline open to
    // them (ADR-0093 B5) — the rule Change Pipeline applies.
    if (pipeline !== existing.pipeline) assertMayMoveLead(user, pipeline);
    if (pipeline !== existing.pipeline || status !== existing.status) {
      await stageOfPipeline(this.prisma, pipeline, status);
    }

    const assigneeIds = new Set(dto.assignedAgentIds ?? []);
    if (user.role === UserRole.SALES_AGENT) assigneeIds.add(user.id);
    await this.assertMayAssign(
      user,
      assigneeIds,
      new Set(existing.assignments.map((a) => a.user.id)),
    );

    // Omitted ≠ empty: no `customFields` key keeps every value; `[]` clears every active
    // field's value. An inactive or deleted field's value survives both (repository.update).
    const customFieldValues =
      dto.customFields === undefined
        ? undefined
        : await this.customFields.prepareValues(dto.customFields);

    const data: Prisma.LeadUpdateInput = {
      name: dto.name,
      firstName: dto.firstName ?? null,
      primaryPhone: dto.primaryPhone,
      secondaryPhone: dto.secondaryPhone ?? null,
      email: dto.email ?? null,
      language: dto.language ?? null,
      country: dto.country ?? null,
      source: dto.source ?? null,
      status,
      pipeline,
      product: dto.product ?? null,
      productQty: dto.productQty ?? null,
      product2: dto.product2 ?? null,
      product2Qty: dto.product2Qty ?? null,
      bookingDate: dto.bookingDate ? new Date(dto.bookingDate) : null,
      category: dto.category ?? null,
      actualAmount: dto.actualAmount ?? null,
      forecastedAmount: dto.forecastedAmount ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      state: dto.state ?? null,
      street: dto.street ?? null,
      city: dto.city ?? null,
      nationalCode: dto.nationalCode ?? null,
      callStatus: dto.callStatus ?? null,
      callAttempts: dto.callAttempts ?? 0,
      whatsappAttempts: dto.msgAttempts ?? 0,
    };

    try {
      const lead = await auditLeadChanges(
        this.prisma,
        [id],
        {
          actor: userActor(user),
          source: 'leads.update',
          deliveryDate: requestedDeliveryDate(dto.deliveryDate, this.config),
        },
        (tx) =>
          this.repository.update(
            id,
            {
              data,
              assigneeIds: [...assigneeIds],
              tagIds: dto.tagIds ?? [],
              complaintReason: dto.complaintReason ?? null,
              customFieldValues,
            },
            tx,
          ),
      );
      return toLeadListItem(await withLogisticsOrder(this.prisma, lead));
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2025')
      ) {
        throw new BadRequestException(
          'One or more assigned agents or tags do not exist.',
        );
      }
      throw error;
    }
  }

  /**
   * The scoped, searched, filtered `where` for the list — the same builder the
   * export uses (`buildLeadWhere`), so a file and the on-screen list can never
   * disagree and neither can leak a lead outside the caller's scope.
   */
  private buildWhere(
    user: CurrentUser,
    query: ListLeadsQueryDto,
  ): Prisma.LeadWhereInput {
    return buildLeadWhere(user, query);
  }

  /**
   * Leads this enquiry duplicates, newest first.
   *
   * One indexed query against the fixed match fields; the only configurable input is
   * whether archived (soft-deleted) leads count, which is the reference's "Check archived
   * leads for duplicates?" toggle. Scope is deliberately *not* applied: a duplicate is a
   * duplicate whoever owns it, and letting an agent create a second copy of a lead they
   * cannot see is exactly the problem this setting exists to prevent.
   */
  private async findDuplicates(
    dto: DuplicateCandidate,
    includeArchived: boolean,
  ): Promise<DuplicateLeadRow[]> {
    const where = duplicateWhere(dto, includeArchived);
    if (!where) return [];

    return this.prisma.lead.findMany({
      where,
      select: DUPLICATE_MATCH_SELECT,
      orderBy: { createdAt: 'desc' },
      take: MAX_DUPLICATE_MATCHES,
    });
  }

  /**
   * The lead a new duplicate is recorded against (`pickOriginal`: the oldest match that is not
   * itself a duplicate), so every duplicate of one customer points at the same original.
   */
  private async findOriginalId(
    dto: CreateLeadDto,
    includeArchived: boolean,
  ): Promise<string | null> {
    const where = duplicateWhere(dto, includeArchived);
    if (!where) return null;

    const matches = await this.prisma.lead.findMany({
      where,
      select: { id: true, createdAt: true, duplicateOfId: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_ORIGINAL_CANDIDATES,
    });
    return pickOriginal(matches);
  }

  /**
   * Who a create or an edit may assign the lead to — the rules the Reassign actions enforce
   * (`REASSIGN_ROLES` on the route, `ASSIGNABLE_USER_WHERE` on the target), applied to the
   * form's Assigned field so it is not a way round them.
   *
   * Only a manager or an administrator chooses assignees. Anyone else may create a lead for
   * themselves alone (a sales agent always is: the callers add them) and must leave an existing
   * lead's assignees exactly as they are. Every assignee a request adds must be a live, active
   * user in an assignable role; one already on the lead is not re-checked, so a lead assigned
   * before this rule — or to someone since deactivated — still takes edits. `current` is null
   * for a create.
   */
  private async assertMayAssign(
    user: CurrentUser,
    requested: ReadonlySet<string>,
    current: ReadonlySet<string> | null,
  ): Promise<void> {
    const added = [...requested].filter((id) => !current?.has(id));

    if (!REASSIGN_ROLES.includes(user.role)) {
      const allowed = current
        ? added.length === 0 && requested.size === current.size
        : added.every((id) => id === user.id);
      if (!allowed) {
        throw new ForbiddenException(
          current
            ? 'Only a manager or an administrator can change who a lead is assigned to.'
            : 'Only a manager or an administrator can assign a lead to someone else.',
        );
      }
    }

    if (added.length === 0) return;
    const assignable = await this.prisma.user.count({
      where: { id: { in: added }, ...ASSIGNABLE_USER_WHERE },
    });
    if (assignable !== added.length) {
      throw new BadRequestException(
        'One or more assignees were not found or can’t be assigned leads.',
      );
    }
  }

  /**
   * The status a new lead is saved with: the one given, else its pipeline's first stage, so
   * a lead created on any board lands in that board's first column. Either way it must be a
   * stage of that pipeline.
   */
  private async newLeadStatus(
    pipeline: string,
    status: string | undefined,
  ): Promise<string> {
    return stageOfPipeline(
      this.prisma,
      pipeline,
      status ?? (await firstStageName(this.prisma, pipeline)),
    );
  }

  /** The list's `where`, with the "Duplicate Lead" search scope applied (`withSearchScope`). */
  private listWhere(
    user: CurrentUser,
    query: ListLeadsQueryDto,
  ): Promise<Prisma.LeadWhereInput> {
    return withSearchScope(user, query, this.buildWhere(user, query), (scope) =>
      this.repository.duplicatePhones(scope),
    );
  }
}
