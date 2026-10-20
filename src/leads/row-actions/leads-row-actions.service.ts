import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requestedDeliveryDate } from '../../logistics/logistics-conversion';
import { CONVERTED_STATUS } from '../../reports/converted-leads-where';
import { Prisma } from '../../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../../auth/current-user';
import { ASSIGNABLE_USER_WHERE, REASSIGN_ROLES } from '../../auth/role-groups';
import { MailerService } from '../../auth/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  recordAfterEffect,
  recordAuditEvents,
  userActor,
} from '../../audit/audit-events';
import { TagAccessService } from '../../tag-access/tag-access.service';
import {
  auditLeadChanges,
  recordLeadsCreated,
  withLogisticsOrder,
} from '../lead-audit';
import { leadScopeWhere } from '../lead-scope';
import {
  assertMayChangeLead,
  assertMayMoveLead,
  assertPipelineOpen,
} from '../../pipelines/pipeline-access';
import {
  LeadListItem,
  LEAD_LIST_SELECT,
  toLeadListItem,
} from '../dto/lead-response.dto';
import { LeadsBulkService } from '../bulk/leads-bulk.service';
import { OUT_OF_SCOPE_REASON } from '../bulk/dto/bulk-actions.dto';
import {
  AddLeadNoteResponse,
  CreateLeadNoteDto,
  ReassignLeadDto,
  RowArchiveResponse,
  RowDeleteResponse,
  SendLeadEmailDto,
  SendLeadEmailResponse,
  SetLeadPipelineDto,
  SetLeadStatusDto,
} from './dto/row-actions.dto';
import { LOST_STATUS } from '../lead-status.constants';
import { firstStageName, stageOfPipeline } from '../../stages/stages.service';

/**
 * The scalar and relation fields a duplicate copies (LEAD-10.1 AC2, decided
 * "fields + assignments + tags"). id/timestamps are deliberately absent — the
 * copy is a new record with its own identity. Assignments carry over so the copy
 * stays inside the same agents' scope as its source; tags carry over as chips.
 *
 * `status` is deliberately absent too: a copy is a new lead, so it starts in the new-lead
 * default (the pipeline's first stage), never in whatever stage the source reached
 * (ADR-0092). Nothing else about the source's progress is selected either — no lost reason,
 * no status timestamp.
 */
const LEAD_COPY_SELECT = {
  name: true,
  firstName: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
  language: true,
  country: true,
  source: true,
  pipeline: true,
  product: true,
  productQty: true,
  product2: true,
  product2Qty: true,
  bookingDate: true,
  category: true,
  actualAmount: true,
  forecastedAmount: true,
  paymentMethod: true,
  state: true,
  street: true,
  city: true,
  nationalCode: true,
  callStatus: true,
  callAttempts: true,
  whatsappAttempts: true,
  assignments: { select: { userId: true } },
  tags: { select: { tagId: true } },
  // The copy is a duplicate of the source's original, or of the source itself (ADR-0092).
  id: true,
  duplicateOfId: true,
} satisfies Prisma.LeadSelect;

/**
 * Per-lead row quick actions (LEAD-10.1): duplicate, reassign, set-status and
 * delete a single lead straight from the list.
 *
 * Every action is scoped through `leadScopeWhere` — the same predicate the list,
 * export and bulk actions use — so a caller can only ever act on a lead they can
 * see; anything else is a 404, never a cross-scope mutation. Reassign and delete
 * delegate to `LeadsBulkService` with a single id rather than re-implementing the
 * scoped, transactional logic (no duplication — the bulk path is the one place
 * those two effects live). WhatsApp stays a client-side wa.me deep-link (LEAD-10.2);
 * Email is a real server send (`sendEmail`, ADR-0032) reusing the configured
 * MailerService transport rather than a mailto.
 */
@Injectable()
export class LeadRowActionsService {
  private readonly logger = new Logger(LeadRowActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly bulk: LeadsBulkService,
    private readonly mailer: MailerService,
    private readonly tagAccess: TagAccessService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Duplicates one lead into a new record (AC2). The source is loaded through the
   * caller's scope, so a lead they cannot see cannot be copied. Fields, the assignees
   * the caller may give it (`copyableAssignees`) and the tags they may select are written
   * in a single create.
   *
   * The copy starts in the new-lead default status — the first stage of the source's
   * pipeline, else 'New' — whatever the source's status (LOST, WON or anything else), exactly
   * as a lead created from the form does (ADR-0092). The source is only read, never written,
   * so it keeps its status, and a WON source does not make a second converted lead.
   */
  async duplicate(id: string): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();

    const source = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: LEAD_COPY_SELECT,
    });
    if (!source) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    // The copy lands in the source's pipeline, so the caller must be able to create there
    // (ADR-0093 B9) — an agent copying an assigned lead from a pipeline closed to them cannot.
    assertPipelineOpen(user, source.pipeline);
    // The copy starts in its pipeline's first stage. If that is WON the copy would be a new
    // converted lead, and a converted lead's order needs a delivery date (client, 2026-10-17)
    // that this request has no way to carry, so it is refused before anything is written.
    const status =
      (await firstStageName(this.prisma, source.pipeline)) ?? 'New';
    if (status === CONVERTED_STATUS) {
      throw new ConflictException(
        `The “${source.pipeline}” pipeline’s first stage is ${CONVERTED_STATUS}, so a copy would be a converted lead without a Delivery Date. Change that pipeline’s stage order before duplicating into it.`,
      );
    }

    const {
      assignments,
      tags,
      id: sourceId,
      duplicateOfId,
      ...scalars
    } = source;
    // Tag Permissions (ADR-0091): a copy must not hand the caller a tag they may not select.
    const permitted = new Set(
      await this.tagAccess.handleable(
        user,
        tags.map((t) => t.tagId),
      ),
    );
    const copiedTags = tags.filter((t) => permitted.has(t.tagId));
    const copiedAssignees = await this.copyableAssignees(
      user,
      assignments.map((a) => a.userId),
    );
    const data: Prisma.LeadCreateInput = {
      ...scalars,
      status,
      // The copy shares the source's phone, so it duplicates the same original (ADR-0092).
      duplicateOf: { connect: { id: duplicateOfId ?? sourceId } },
      assignments: copiedAssignees.length
        ? {
            create: copiedAssignees.map((userId) => ({
              user: { connect: { id: userId } },
            })),
          }
        : undefined,
      tags: copiedTags.length
        ? {
            create: copiedTags.map((t) => ({
              tag: { connect: { id: t.tagId } },
            })),
          }
        : undefined,
    };

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.lead.create({ data, select: LEAD_LIST_SELECT });
      await recordLeadsCreated(tx, [row.id], {
        actor: userActor(user),
        source: 'leads.duplicate',
        metadata: { duplicatedFrom: id },
      });
      // The copy starts in the first stage, which a reordered board can make WON.
      return withLogisticsOrder(tx, row);
    });
    return toLeadListItem(created);
  }

  /**
   * The copy's assignees. A copy is a new lead, so these are new assignments under the create
   * rule (`LeadsService.assertMayAssign`): a manager or an administrator keeps the source's
   * assignees; anyone else keeps only their own assignment — an agent who can see the source is
   * always on it, so the copy stays visible to them. Either way only live, active, assignable
   * users are carried over (`ASSIGNABLE_USER_WHERE`); the source's assignments are not touched.
   */
  private async copyableAssignees(
    user: CurrentUser,
    sourceAssignees: string[],
  ): Promise<string[]> {
    const wanted = REASSIGN_ROLES.includes(user.role)
      ? sourceAssignees
      : sourceAssignees.filter((userId) => userId === user.id);
    if (wanted.length === 0) return [];
    const assignable = await this.prisma.user.findMany({
      where: { id: { in: wanted }, ...ASSIGNABLE_USER_WHERE },
      select: { id: true },
    });
    const allowed = new Set(assignable.map((row) => row.id));
    return wanted.filter((userId) => allowed.has(userId));
  }

  /**
   * Reassigns one lead to `agentId` (AC3). Delegates to the bulk reassign so the
   * agent-validation and the delete+create-in-one-transaction live in a single
   * place; a lead outside scope comes back as a per-item failure, surfaced here
   * as a 404. The updated lead is returned so the row can reflect its new owner.
   */
  async reassign(id: string, dto: ReassignLeadDto): Promise<LeadListItem> {
    const result = await this.bulk.reassign(
      { ids: [id], agentId: dto.agentId },
      'leads.reassign',
    );
    if (result.results[0]?.status !== 'success') {
      throw new NotFoundException(OUT_OF_SCOPE_REASON);
    }
    return this.loadById(id);
  }

  /**
   * Sets one lead's status to a caller-provided value (AC4). Scoped through the
   * same predicate before the update, so an out-of-scope id never mutates. Not a
   * toggle: the value is whatever the UI sends (see the DTO).
   */
  async setStatus(id: string, dto: SetLeadStatusDto): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();

    const target = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: { id: true, status: true, pipeline: true },
    });
    if (!target) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    assertMayChangeLead(user, target);

    // A changed status must be a stage of the lead's OWN pipeline — the rule create, edit and
    // the Kanban move apply (400, nothing written). Convert sends WON, so on a pipeline with no
    // WON stage it is refused rather than converting a lead no board column shows. An unchanged
    // status (a repeated Convert, a new LOST reason) is not re-checked, so legacy rows still
    // take it. Logistics write-backs do not come through here (ADR-0085).
    if (dto.status !== target.status) {
      await stageOfPipeline(this.prisma, target.pipeline, dto.status);
    }

    const updated = await auditLeadChanges(
      this.prisma,
      [id],
      {
        actor: userActor(user),
        source: 'leads.status',
        deliveryDate: requestedDeliveryDate(dto.deliveryDate, this.config),
      },
      (tx) =>
        tx.lead.update({
          where: { id },
          // The capture rule: a move to LOST stores the reason (null when none was offered);
          // any other status clears it — a reason belongs to the loss it described.
          data: {
            status: dto.status,
            lostReason:
              dto.status === LOST_STATUS ? (dto.lostReason ?? null) : null,
          },
          select: LEAD_LIST_SELECT,
        }),
    );
    return toLeadListItem(await withLogisticsOrder(this.prisma, updated));
  }

  /**
   * Sends an email from a lead's row (LEAD-10.2, ADR-0032). Scoped like every row
   * action: the lead is loaded through the caller's scope first, so a lead they
   * cannot see is a 404 and never a channel to send through. Recipients, subject
   * and body are the caller's; the From is the transport's verified sender, never
   * client-supplied. A provider failure surfaces as a 500 so the composer keeps the
   * drawer open for a retry rather than silently dropping the send.
   */
  async sendEmail(
    id: string,
    dto: SendLeadEmailDto,
  ): Promise<SendLeadEmailResponse> {
    const user = await this.currentUser.resolve();

    const lead = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: { id: true, pipeline: true },
    });
    if (!lead) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    assertMayChangeLead(user, lead);

    try {
      await this.mailer.sendMail({
        to: dto.to,
        cc: dto.cc,
        bcc: dto.bcc,
        subject: dto.subject ?? '',
        text: dto.message ?? '',
      });
    } catch {
      // The transport already logged the provider's reason; surface a clean failure
      // so the composer shows an error and offers a retry without leaking internals.
      throw new InternalServerErrorException(
        'The email could not be sent. Please try again.',
      );
    }

    // Recorded only once the provider has accepted it, so a failed send is never history.
    // The subject and how many were addressed, never the addresses or the body (AUD-01).
    await recordAfterEffect(this.prisma, this.logger, {
      entityType: 'LEAD',
      entityId: id,
      leadId: id,
      action: 'EMAIL_SENT',
      actor: userActor(user),
      source: 'leads.email',
      metadata: {
        subject: dto.subject ?? '',
        to: dto.to.length,
        cc: dto.cc?.length ?? 0,
        bcc: dto.bcc?.length ?? 0,
      },
    });
    return { sent: true };
  }

  /**
   * Adds a free-text note to a lead (LEAD-10.2, ADR-0035). Scoped like every row
   * action: the lead is loaded through the caller's scope first, so a lead they
   * cannot see is a 404 and never receives a note. The author is the resolved
   * caller — never client-supplied — and the body is trimmed and length-bounded
   * by the DTO. Each call is its own row, so notes accumulate rather than
   * overwrite; there is no notes-history read here (Workpex captures only creation).
   */
  async addNote(
    id: string,
    dto: CreateLeadNoteDto,
  ): Promise<AddLeadNoteResponse> {
    const user = await this.currentUser.resolve();

    const lead = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: { id: true, pipeline: true },
    });
    if (!lead) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    assertMayChangeLead(user, lead);

    // On the lead's journey (AUD-01): whoever reads the lead reads its notes already.
    const note = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leadNote.create({
        data: { leadId: id, authorId: user.id, body: dto.body },
        select: { id: true },
      });
      await recordAuditEvents(tx, [
        {
          entityType: 'LEAD_NOTE',
          entityId: row.id,
          leadId: id,
          action: 'CREATED',
          actor: userActor(user),
          source: 'leads.note',
          after: { body: dto.body },
        },
      ]);
      return row;
    });
    return { id: note.id };
  }

  /**
   * Permanently removes one lead (AC5, hard delete — matching the approved bulk
   * decision). Delegates to the bulk delete so the scope check, the retention guard and
   * the cascading hard delete are not written twice; an out-of-scope id is a 404 and a
   * lead other records depend on is a 409 (ADR-0083).
   */
  async delete(id: string): Promise<RowDeleteResponse> {
    // The bulk path counts a lead the caller may see but not change as not permitted; one lead
    // gets the reason instead (ADR-0093 B2).
    const user = await this.currentUser.resolve();
    const visible = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: { pipeline: true },
    });
    if (visible) assertMayChangeLead(user, visible);

    const result = await this.bulk.delete({ ids: [id] }, 'leads.delete');
    if (result.results[0]?.status !== 'success') {
      throw new NotFoundException(OUT_OF_SCOPE_REASON);
    }
    return { id };
  }

  /**
   * Moves a lead to another pipeline (KAN-03.1 card menu). `pipeline` is a real axis
   * separate from `status`, so the lead also lands on the target pipeline's first stage
   * (by position) — otherwise it would sit on a stage that isn't on its new board.
   * A pipeline with no stages is refused (BadRequest → the UI toasts it), never a
   * silent move into an invalid state. Scoped: an out-of-scope id is a 404.
   */
  async changePipeline(
    id: string,
    dto: SetLeadPipelineDto,
  ): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();

    const target = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: { id: true, status: true, pipeline: true },
    });
    if (!target) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    // Managers and administrators only (the route's @Roles), out of a pipeline they may change
    // and into one open to them (ADR-0093 B5).
    assertMayChangeLead(user, target);
    assertMayMoveLead(user, dto.pipeline);

    const firstStage = await firstStageName(this.prisma, dto.pipeline);
    if (!firstStage) {
      throw new BadRequestException(
        `The “${dto.pipeline}” pipeline has no stages, so a lead can’t be moved into it.`,
      );
    }
    // The move lands the lead on that first stage. If that is WON the move would convert it, and
    // a converted lead's order needs a delivery date (client, 2026-10-17) that this request has no
    // way to carry. A lead that is already WON does not convert again, so it may still move.
    if (firstStage === CONVERTED_STATUS && target.status !== CONVERTED_STATUS) {
      throw new ConflictException(
        `The “${dto.pipeline}” pipeline’s first stage is ${CONVERTED_STATUS}, so moving the lead there would convert it without a Delivery Date. Convert the lead with its Delivery Date instead, or change that pipeline’s stage order.`,
      );
    }

    const updated = await auditLeadChanges(
      this.prisma,
      [id],
      { actor: userActor(user), source: 'leads.pipeline' },
      (tx) =>
        tx.lead.update({
          where: { id },
          data: { pipeline: dto.pipeline, status: firstStage },
          select: LEAD_LIST_SELECT,
        }),
    );
    return toLeadListItem(await withLogisticsOrder(this.prisma, updated));
  }

  /**
   * Soft-archives a lead (KAN-03.1 card menu): sets `deletedAt`, the same state the
   * Leads "Archived leads" filter reads. The lead leaves the active board/list but is
   * recoverable via `unarchive` — distinct from the hard `delete` that removes the row.
   * Scoped over active leads, so an out-of-scope or already-archived id is a 404.
   */
  async archive(id: string): Promise<RowArchiveResponse> {
    const user = await this.currentUser.resolve();

    const target = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: { id: true, pipeline: true },
    });
    if (!target) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    assertMayChangeLead(user, target);

    await auditLeadChanges(
      this.prisma,
      [id],
      { actor: userActor(user), source: 'leads.archive' },
      (tx) =>
        tx.lead.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    return { id };
  }

  /**
   * Restores an archived lead (clears `deletedAt`). Scoped over archived leads
   * (`leadScopeWhere(user, true)`), so a caller can only restore one they could see;
   * an active or out-of-scope id is a 404. Returns the restored lead for the caller
   * to adopt back into the active view.
   */
  async unarchive(id: string): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();

    const target = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user, true), { id }] },
      select: { id: true, pipeline: true },
    });
    if (!target) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    assertMayChangeLead(user, target);

    const updated = await auditLeadChanges(
      this.prisma,
      [id],
      { actor: userActor(user), source: 'leads.unarchive' },
      (tx) =>
        tx.lead.update({
          where: { id },
          data: { deletedAt: null },
          select: LEAD_LIST_SELECT,
        }),
    );
    return toLeadListItem(updated);
  }

  /** The lead by id after a successful action (it exists), as a list item. */
  private async loadById(id: string): Promise<LeadListItem> {
    const row = await this.prisma.lead.findUnique({
      where: { id },
      select: LEAD_LIST_SELECT,
    });
    if (!row) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    return toLeadListItem(row);
  }
}
