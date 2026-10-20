import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { recordAuditEvents, userActor } from '../audit/audit-events';
import { orderSearchWhere } from '../logistics/logistics-orders.service';
import { accountsRecordScopeWhere } from './accounts-roles';
import { correctionTargets, PAYMENT_MOVES } from './accounts-status';
import {
  ACCOUNTS_RECORD_SELECT,
  AccountsRecordFilterOptions,
  AccountsRecordFiltersDto,
  AccountsRecordListResponse,
  AccountsRecordResponse,
  AccountsRecordSummaryResponse,
  AccountsSortColumn,
  CorrectPaymentStatusDto,
  ListAccountsRecordsDto,
  MovePaymentStatusDto,
  toAccountsRecordResponse,
} from './dto/accounts-record.dto';

/**
 * The records a query reaches: the caller's scope first, then the narrowing terms, so a filter can
 * only ever narrow it. The list and its counts both build their `where` here.
 */
function recordWhere(
  user: CurrentUser,
  filters: AccountsRecordFiltersDto,
): Prisma.AccountsRecordWhereInput {
  return {
    AND: [
      accountsRecordScopeWhere(user),
      filters.status ? { status: { in: filters.status } } : {},
      {
        order: {
          AND: [
            orderSearchWhere(filters.search),
            filters.paymentMethod
              ? { paymentMethod: { in: filters.paymentMethod } }
              : {},
            filters.courier ? { courier: { in: filters.courier } } : {},
          ],
        },
      },
    ],
  };
}

/** The sort column as Prisma orders by it: the order's own columns sort through the relation. */
function sortOrder(
  column: AccountsSortColumn,
  direction: Prisma.SortOrder,
): Prisma.AccountsRecordOrderByWithRelationInput {
  switch (column) {
    case 'deliveredAt':
      return { order: { deliveredAt: { sort: direction, nulls: 'last' } } };
    case 'orderNumber':
      return { order: { orderNumber: direction } };
    case 'customerName':
      return { order: { customerName: direction } };
    case 'status':
    case 'statusChangedAt':
      return { [column]: direction };
  }
}

/** The distinct values a column holds, blanks left out, in name order. */
const distinctValues = (values: (string | null)[]): string[] =>
  [
    ...new Set(
      values.filter((value): value is string => Boolean(value?.trim())),
    ),
  ].sort((a, b) => a.localeCompare(b, 'en'));

/** A status change: a move along `PAYMENT_MOVES`, or a correction (Q14). */
type Change =
  | { kind: 'move'; dto: MovePaymentStatusDto }
  | { kind: 'correct'; dto: CorrectPaymentStatusDto };

/**
 * The Accounts pipeline (ADR-0096; specification §4 steps 11-12, §6): the payment record each
 * delivered order gets, read and moved by Accounts.
 *
 * Records are created by the delivery itself (`openAccountsRecord`, in the Logistics move's own
 * transaction), never here. This service reads them through the caller's scope and changes their
 * status two ways: a move the provisional table allows (`PAYMENT_MOVES`), and a correction with a
 * reason. Both are conditional on the status the caller saw (`expectedStatus`), so a stale or
 * concurrent change updates no row and is a 409 naming the status the record is in. Every change
 * writes its audit event in the same transaction, on the order's lead journey (ADR-0083).
 */
@Injectable()
export class AccountsRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** A scoped page of records. */
  async list(
    query: ListAccountsRecordsDto,
  ): Promise<AccountsRecordListResponse> {
    const user = await this.currentUser.resolve();
    const where = recordWhere(user, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.accountsRecord.findMany({
        where,
        select: ACCOUNTS_RECORD_SELECT,
        // `id` breaks ties so a row never repeats across pages.
        orderBy: [sortOrder(query.sort, query.direction), { id: 'asc' }],
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.accountsRecord.count({ where }),
    ]);
    return {
      rows: rows.map((row) => toAccountsRecordResponse(row, user.role)),
      total,
    };
  }

  /**
   * How many records hold each status under every filter but the status filter itself — so the
   * counts, which double as the status filter, never hide one another — and their total. Each
   * status's count is the list's total for that status under the same filters.
   */
  async summary(
    filters: AccountsRecordFiltersDto,
  ): Promise<AccountsRecordSummaryResponse> {
    const user = await this.currentUser.resolve();
    const groups = await this.prisma.accountsRecord.groupBy({
      by: ['status'],
      where: recordWhere(user, { ...filters, status: undefined }),
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      Object.values(PaymentStatus).map((status) => [status, 0]),
    ) as Record<PaymentStatus, number>;
    for (const group of groups) counts[group.status] += group._count._all;
    return {
      counts,
      total: groups.reduce((sum, group) => sum + group._count._all, 0),
    };
  }

  /** The payment methods and couriers of the caller's records' orders, whatever the filters. */
  async filterOptions(): Promise<AccountsRecordFilterOptions> {
    const user = await this.currentUser.resolve();
    const groups = await this.prisma.logisticsOrder.groupBy({
      by: ['paymentMethod', 'courier'],
      where: { accountsRecord: { is: accountsRecordScopeWhere(user) } },
    });
    return {
      paymentMethods: distinctValues(
        groups.map((group) => group.paymentMethod),
      ),
      couriers: distinctValues(groups.map((group) => group.courier)),
    };
  }

  /** One record, through the caller's scope: a record they may not see is a 404. */
  async get(id: string): Promise<AccountsRecordResponse> {
    const user = await this.currentUser.resolve();
    return this.loadFull(this.prisma, id, user);
  }

  /** The Accounts Executive's payment update (§4 step 12), along `PAYMENT_MOVES`. */
  async move(
    id: string,
    dto: MovePaymentStatusDto,
  ): Promise<AccountsRecordResponse> {
    return this.change(id, { kind: 'move', dto });
  }

  /** A correction — backwards included — with its reason (Q14). Super Admin only for now. */
  async correct(
    id: string,
    dto: CorrectPaymentStatusDto,
  ): Promise<AccountsRecordResponse> {
    return this.change(id, { kind: 'correct', dto });
  }

  /**
   * One status change and its event, in one transaction. Refused with a 409, writing nothing, when
   * the record is no longer in the status the caller saw, or when the change is not one this kind
   * of change may make from there. The update itself is conditional on that status too, so a
   * concurrent change that commits after the read still turns this one into a 409.
   */
  private async change(
    id: string,
    change: Change,
  ): Promise<AccountsRecordResponse> {
    const user = await this.currentUser.resolve();
    const { status: target, expectedStatus } = change.dto;
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.accountsRecord.findFirst({
        where: { AND: [accountsRecordScopeWhere(user), { id }] },
        select: {
          id: true,
          status: true,
          order: { select: { id: true, leadId: true } },
        },
      });
      if (!record) throw new NotFoundException('Accounts record not found.');
      if (record.status !== expectedStatus) throw staleRecord(record.status);

      if (
        change.kind === 'move' &&
        !PAYMENT_MOVES[record.status].includes(target)
      ) {
        throw new ConflictException(
          `This record is ${record.status}; it cannot be moved to ${target}. That change needs a correction.`,
        );
      }
      if (
        change.kind === 'correct' &&
        !correctionTargets(record.status).includes(target)
      ) {
        throw new ConflictException(`This record is already ${target}.`);
      }

      const { count } = await tx.accountsRecord.updateMany({
        where: { id, status: expectedStatus },
        data: { status: target, statusChangedAt: new Date() },
      });
      if (count === 0) {
        const current = await tx.accountsRecord.findUniqueOrThrow({
          where: { id },
          select: { status: true },
        });
        throw staleRecord(current.status);
      }

      await recordAuditEvents(tx, [
        {
          entityType: 'ACCOUNTS_RECORD',
          entityId: id,
          leadId: record.order.leadId,
          actor: userActor(user),
          before: { status: record.status },
          after: { status: target },
          ...(change.kind === 'move'
            ? {
                action: 'PAYMENT_STATUS_CHANGED' as const,
                source: 'accounts.status',
                metadata: {
                  orderId: record.order.id,
                  remarks: change.dto.remarks?.trim() || null,
                },
              }
            : {
                action: 'PAYMENT_STATUS_CORRECTED' as const,
                source: 'accounts.correction',
                metadata: {
                  orderId: record.order.id,
                  reason: change.dto.reason,
                },
              }),
        },
      ]);
      return this.loadFull(tx, id, user);
    });
  }

  private async loadFull(
    client: Pick<Prisma.TransactionClient, 'accountsRecord'>,
    id: string,
    user: CurrentUser,
  ): Promise<AccountsRecordResponse> {
    const record = await client.accountsRecord.findFirst({
      where: { AND: [accountsRecordScopeWhere(user), { id }] },
      select: ACCOUNTS_RECORD_SELECT,
    });
    if (!record) throw new NotFoundException('Accounts record not found.');
    return toAccountsRecordResponse(record, user.role);
  }
}

/** The answer to a change made against a status the record no longer has. */
function staleRecord(status: PaymentStatus): ConflictException {
  return new ConflictException(
    `This record is now ${status}; reload it before changing its status.`,
  );
}
