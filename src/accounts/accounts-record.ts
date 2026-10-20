import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditActor, recordAuditEvents } from '../audit/audit-events';

/**
 * Opens the payment record of an order that has just become DELIVERED (specification §4 step 11):
 * INITIAL, with its ACCOUNTS_CREATED event on the order's lead journey. Called only from inside
 * the delivery's own transaction (`LogisticsOrdersService.move`), so the order's move, its
 * DELIVERED event, this record and its event commit together or not at all.
 *
 * A second record for one order cannot happen: the delivery's conditional update lets a single
 * transaction through, and `order_id` is unique. If the key ever refuses one, an invariant broke
 * somewhere else — that is a 409 which rolls the whole delivery back, never a skipped insert, so no
 * order is left DELIVERED without exactly one record.
 */
export async function openAccountsRecord(
  tx: Prisma.TransactionClient,
  order: { id: string; leadId: string },
  actor: AuditActor,
  source: string,
): Promise<void> {
  const record = await tx.accountsRecord
    .create({
      data: { orderId: order.id },
      select: { id: true, status: true },
    })
    .catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This order already has an Accounts record, so the delivery was not recorded.',
        );
      }
      throw error;
    });
  await recordAuditEvents(tx, [
    {
      entityType: 'ACCOUNTS_RECORD',
      entityId: record.id,
      leadId: order.leadId,
      action: 'ACCOUNTS_CREATED',
      actor,
      source,
      after: { status: record.status },
      metadata: { orderId: order.id },
    },
  ]);
}
