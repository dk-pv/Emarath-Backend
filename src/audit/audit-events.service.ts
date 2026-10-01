import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { leadScopeWhere } from '../leads/lead-scope';
import { logisticsOrderScopeWhere } from '../logistics/logistics-roles';
import {
  AUDIT_EVENT_SELECT,
  AuditEventListResponse,
  ListAuditEventsDto,
  toAuditEventResponse,
} from './dto/audit-event.dto';

/**
 * Oldest first — a journey is read forwards. `id` breaks ties so a row never repeats across
 * pages; events written by one transaction share its start instant (ADR-0083), so their order
 * within that instant is arbitrary and the before/after chain is what actually orders them.
 */
const ORDER_BY: Prisma.AuditEventOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

/**
 * The read side of the append-only log (ADR-0083): one customer journey, in order.
 *
 * Read only, deliberately — there is no write here and none is wanted. The log is written by
 * the change that caused it, inside that change's own transaction, which is the only thing that
 * keeps a record and its history from disagreeing.
 *
 * Authorization is composed from the two scopes that already exist rather than a second model
 * of its own (CLAUDE.md §8): whoever may see the lead reads the whole journey, and whoever may
 * see its Logistics order reads that order's part of it. Nothing here branches on a role name,
 * so a later change to either scope reaches this endpoint automatically.
 */
@Injectable()
export class AuditEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async list(query: ListAuditEventsDto): Promise<AuditEventListResponse> {
    const user = await this.currentUser.resolve();
    const where = await this.journeyWhere(user, query.leadId);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        select: AUDIT_EVENT_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { rows: rows.map(toAuditEventResponse), total };
  }

  /**
   * What of this journey the caller may read, or a 404 if none of it.
   *
   * The lead scope comes first: a sales caller who can open the lead gets every event on it,
   * including the Logistics ones, which is the Lead → Logistics → Accounts timeline the client
   * asked for. Failing that, the order scope is tried, which is how the Logistics roles reach a
   * journey at all — they hold no sales access (ADR-0084), so they get their own record's
   * events and never the lead's. A lead the caller can reach by neither route is a 404 in the
   * same words the lead reads use, so this endpoint cannot be used to probe for leads.
   */
  private async journeyWhere(
    user: CurrentUser,
    leadId: string,
  ): Promise<Prisma.AuditEventWhereInput> {
    const lead = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id: leadId }] },
      select: { id: true },
    });
    if (lead) return { leadId };

    const order = await this.prisma.logisticsOrder.findFirst({
      where: { AND: [logisticsOrderScopeWhere(user), { leadId }] },
      select: { id: true },
    });
    if (order) return { leadId, entityType: 'LOGISTICS_ORDER' };

    throw new NotFoundException(
      'That lead does not exist or is not in your scope.',
    );
  }
}
