import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { LeadCustomFieldsService } from '../lead-custom-fields/lead-custom-fields.service';
import { LeadsRepository } from './leads.repository';
import { leadScopeWhere } from './lead-scope';
import { buildLeadWhere } from './lead-where';
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
import { LeadFilterOptions } from './dto/lead-filter-options.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';

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
  ) {}

  async list(query: ListLeadsQueryDto): Promise<LeadListResponse> {
    const user = await this.currentUser.resolve();
    const where = this.buildWhere(user, query);

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
  ): Promise<{ id: string; name: string }[]> {
    if (user.role === UserRole.SALES_AGENT) {
      const self = await this.repository.findUserSummary(user.id);
      return self ? [self] : [];
    }
    return this.repository.assigneesOf(scope);
  }

  /** Users the New Lead form can assign a lead to (LEAD-06.2). */
  async assignableAgents(): Promise<{ id: string; name: string }[]> {
    return this.repository.assignableUsers([
      UserRole.SALES_AGENT,
      UserRole.SALES_MANAGER,
      UserRole.CUSTOMER_SERVICE_AGENT,
    ]);
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

    const assigneeIds = new Set(dto.assignedAgentIds ?? []);
    if (user.role === UserRole.SALES_AGENT) assigneeIds.add(user.id);

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
      status: dto.status || 'New',
      pipeline: dto.pipeline || 'Lead Pipeline',
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
      const lead = await this.repository.create(data);
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
   * the system truly records: the lead's creation, its assignments, and its notes.
   * Email sends and the actor behind create/assign are not tracked, so they are
   * absent by design rather than fabricated (partial-but-honest, per the approved
   * decision). Newest first.
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

    const [assignments, notes] = await Promise.all([
      this.repository.assignmentsForTimeline(id),
      this.repository.notesForTimeline(id),
    ]);

    return buildLeadTimeline(lead.id, lead.createdAt, assignments, notes);
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

    const assigneeIds = new Set(dto.assignedAgentIds ?? []);
    if (user.role === UserRole.SALES_AGENT) assigneeIds.add(user.id);

    const customFieldValues = await this.customFields.prepareValues(
      dto.customFields,
    );

    const data: Prisma.LeadUpdateInput = {
      name: dto.name,
      firstName: dto.firstName ?? null,
      primaryPhone: dto.primaryPhone,
      secondaryPhone: dto.secondaryPhone ?? null,
      email: dto.email ?? null,
      language: dto.language ?? null,
      country: dto.country ?? null,
      source: dto.source ?? null,
      status: dto.status || 'New',
      pipeline: dto.pipeline || 'Lead Pipeline',
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
      const lead = await this.repository.update(id, {
        data,
        assigneeIds: [...assigneeIds],
        tagIds: dto.tagIds ?? [],
        complaintReason: dto.complaintReason ?? null,
        customFieldValues,
      });
      return toLeadListItem(lead);
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
}
