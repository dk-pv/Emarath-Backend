import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { recordAuditEvents, userActor } from '../../audit/audit-events';
import {
  LeadAuditContext,
  auditLeadChanges,
  leadDeleteBlockedEvent,
  leadDeletedEvent,
  lockLeads,
  readLeadAuditStates,
} from '../lead-audit';
import { retainedLeads } from '../lead-retention';
import { leadScopeWhere } from '../lead-scope';
import {
  BulkActionResponse,
  BulkDeleteDto,
  BulkReassignDto,
  bulkResponse,
} from './dto/bulk-actions.dto';

/** A reassignment target must be one of the lead-handling roles (as LEAD-06.2). */
const ASSIGNABLE_ROLES = [
  UserRole.SALES_AGENT,
  UserRole.SALES_MANAGER,
  UserRole.CUSTOMER_SERVICE_AGENT,
];

/**
 * Bulk actions over a set of selected leads (LEAD-09.1): reassign and delete.
 *
 * Both are scoped through `leadScopeWhere` — the same predicate the list and export
 * use — so a caller can only ever act on leads they can see; ids outside that set
 * come back as per-item failures rather than acting on someone else's lead (AC2/AC3).
 * Role-based gating of the actions themselves (e.g. "only managers may delete") is
 * deferred to the AUTH permission work, the same policy deferral `lead-scope` makes.
 * Bulk export is deferred to LEAD-09.2.
 */
@Injectable()
export class LeadsBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /**
   * Reassigns each in-scope selected lead to `agentId`, replacing its current
   * assignment(s) so ownership — and therefore scoping — changes at once (AC4). The
   * delete+create runs in one transaction, so a lead is never left unassigned; the
   * previous and new assignees are recorded in that same transaction (ADR-0083).
   * The leads' open follow-ups move to the new owner in the same transaction
   * (ADR-0086), so none is left on a worklist that can no longer see its lead.
   */
  async reassign(
    dto: BulkReassignDto,
    source = 'leads.bulk-reassign',
  ): Promise<BulkActionResponse> {
    const user = await this.currentUser.resolve();

    const agent = await this.prisma.user.findFirst({
      where: {
        id: dto.agentId,
        deletedAt: null,
        role: { in: ASSIGNABLE_ROLES },
      },
      select: { id: true },
    });
    if (!agent) {
      throw new BadRequestException(
        'Target agent not found or not assignable.',
      );
    }

    const ids = unique(dto.ids);
    const actionable = await this.actionableIds(user, ids);

    if (actionable.size > 0) {
      const leadIds = [...actionable];
      await auditLeadChanges(
        this.prisma,
        leadIds,
        { actor: userActor(user), source },
        async (tx) => {
          await handOverOpenFollowUps(tx, leadIds, dto.agentId);
          await tx.leadAssignment.deleteMany({
            where: { leadId: { in: leadIds } },
          });
          await tx.leadAssignment.createMany({
            data: leadIds.map((leadId) => ({ leadId, userId: dto.agentId })),
          });
        },
      );
    }

    return bulkResponse(ids, actionable);
  }

  /**
   * Permanently removes each in-scope selected lead (LEAD-09.1 AC5, hard delete —
   * approved). Assignments, tags and complaints go with it through their cascading
   * foreign keys; `deleteMany` over the scoped id set is the single safe batch.
   *
   * A lead other records depend on is never deleted (ADR-0083): if any selected lead is
   * retained, nothing is deleted and the request is a 409 — the same all-or-nothing
   * outcome the RESTRICT key already forced, now with the attempt recorded. Each deleted
   * lead leaves a DELETED event holding its last state, so the history outlives the row.
   */
  async delete(
    dto: BulkDeleteDto,
    source = 'leads.bulk-delete',
  ): Promise<BulkActionResponse> {
    const user = await this.currentUser.resolve();

    const ids = unique(dto.ids);
    const actionable = await this.actionableIds(user, ids);

    if (actionable.size > 0) {
      const leadIds = [...actionable];
      const retained = await this.deleteUnlessRetained(leadIds, {
        actor: userActor(user),
        source,
      });
      if (retained > 0) {
        throw new ConflictException(retainedMessage(retained, leadIds.length));
      }
    }

    return bulkResponse(ids, actionable);
  }

  /**
   * Deletes the leads unless any is retained, and returns how many were. The check runs
   * under the row lock, so a call cannot be linked between the check and the delete; the
   * foreign key is still caught in case a new RESTRICT record is ever missed by the rule.
   */
  private async deleteUnlessRetained(
    leadIds: string[],
    context: LeadAuditContext,
  ): Promise<number> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockLeads(tx, leadIds);

        const retained = await retainedLeads(tx, leadIds);
        if (retained.size > 0) {
          await recordAuditEvents(
            tx,
            [...retained].map(([id, linked]) =>
              leadDeleteBlockedEvent(id, { ...linked }, context),
            ),
          );
          return retained.size;
        }

        const states = await readLeadAuditStates(tx, leadIds);
        await recordAuditEvents(
          tx,
          [...states].map(([id, state]) =>
            leadDeletedEvent(id, state, context),
          ),
        );
        await tx.lead.deleteMany({ where: { id: { in: leadIds } } });
        return 0;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(retainedMessage(null, leadIds.length));
      }
      throw error;
    }
  }

  /**
   * The subset of the requested ids the caller may act on: leads that are both in
   * the request and inside the caller's scope. Reuses `leadScopeWhere`, so a sales
   * agent can never reach another agent's lead through a bulk call.
   */
  private async actionableIds(
    user: CurrentUser,
    ids: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.lead.findMany({
      where: { AND: [leadScopeWhere(user), { id: { in: ids } }] },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Hands the leads' open follow-ups from their departing owners to `agentId`
 * (ADR-0086). Only a lead's own outgoing assignees are swapped: anyone else on a
 * follow-up (a manager, a teammate the lead is visible to) stays on it, and
 * completed follow-ups keep their history. Reads the current assignments, so it
 * runs before they are replaced.
 */
async function handOverOpenFollowUps(
  tx: Prisma.TransactionClient,
  leadIds: string[],
  agentId: string,
): Promise<void> {
  const departing = await tx.leadAssignment.findMany({
    where: { leadId: { in: leadIds }, userId: { not: agentId } },
    select: { leadId: true, userId: true },
  });
  if (departing.length === 0) return;

  const byLead = new Map<string, string[]>();
  for (const { leadId, userId } of departing) {
    byLead.set(leadId, [...(byLead.get(leadId) ?? []), userId]);
  }
  const moving = await tx.activityAssignee.findMany({
    where: {
      OR: [...byLead].map(([leadId, userIds]) => ({
        userId: { in: userIds },
        activity: { leadId, completedAt: null, deletedAt: null },
      })),
    },
    select: { id: true, activityId: true },
  });
  if (moving.length === 0) return;

  await tx.activityAssignee.deleteMany({
    where: { id: { in: moving.map((row) => row.id) } },
  });
  await tx.activityAssignee.createMany({
    data: unique(moving.map((row) => row.activityId)).map((activityId) => ({
      activityId,
      userId: agentId,
    })),
    skipDuplicates: true,
  });
}

/** `retained` is null when the database refused the delete and the count is unknown. */
function retainedMessage(retained: number | null, requested: number): string {
  if (requested === 1) {
    return 'This lead has linked records, so it can’t be permanently deleted. Archive it instead.';
  }
  const leads =
    retained === null
      ? 'Some selected leads have'
      : retained === 1
        ? '1 selected lead has'
        : `${retained} selected leads have`;
  return `${leads} linked records, so nothing was deleted. Archive those leads instead.`;
}
