import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
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
   * delete+create runs in one transaction, so a lead is never left unassigned.
   */
  async reassign(dto: BulkReassignDto): Promise<BulkActionResponse> {
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
      await this.prisma.$transaction([
        this.prisma.leadAssignment.deleteMany({
          where: { leadId: { in: leadIds } },
        }),
        this.prisma.leadAssignment.createMany({
          data: leadIds.map((leadId) => ({ leadId, userId: dto.agentId })),
        }),
      ]);
    }

    return bulkResponse(ids, actionable);
  }

  /**
   * Permanently removes each in-scope selected lead (LEAD-09.1 AC5, hard delete —
   * approved). Assignments, tags and complaints go with it through their cascading
   * foreign keys; `deleteMany` over the scoped id set is the single safe batch.
   */
  async delete(dto: BulkDeleteDto): Promise<BulkActionResponse> {
    const user = await this.currentUser.resolve();

    const ids = unique(dto.ids);
    const actionable = await this.actionableIds(user, ids);

    if (actionable.size > 0) {
      await this.prisma.lead.deleteMany({
        where: { id: { in: [...actionable] } },
      });
    }

    return bulkResponse(ids, actionable);
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
