import type { Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

/**
 * The append-only audit log (ADR-0083).
 *
 * Every event is written through the same transaction client as the change it describes,
 * so a change and its history commit or roll back together — there is no path where the
 * lead moved and the log missed it, or the log claims a move that never happened.
 */

/**
 * The kinds of record the log describes today. Later phases add their own.
 *
 * Only LEAD, LOGISTICS_ORDER, ACCOUNTS_RECORD, ACTIVITY and LEAD_NOTE events carry a `leadId`
 * and so appear on a customer journey. The administrative ones (users, roles, permissions,
 * settings, documents, exports) have `leadId` null and no read route yet (AUD-01).
 */
export const AUDIT_ENTITY_TYPES = [
  'LEAD',
  'STAGE',
  'PIPELINE',
  'LOGISTICS_ORDER',
  'ACCOUNTS_RECORD',
  'USER',
  'ROLE',
  'TAG_ACCESS_POLICY',
  'SETTING',
  'INTEGRATION',
  'DOCUMENT',
  'ACTIVITY',
  'LEAD_NOTE',
  'EXPORT',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export type AuditAction =
  | 'CREATED'
  | 'UPDATED'
  | 'STATUS_CHANGED'
  | 'CONVERTED'
  | 'PIPELINE_CHANGED'
  | 'ASSIGNED'
  | 'UNASSIGNED'
  | 'REASSIGNED'
  | 'ARCHIVED'
  | 'UNARCHIVED'
  | 'DELETED'
  | 'DELETE_BLOCKED'
  | 'RENAMED'
  // The Logistics lifecycle (ADR-0085 B14). Each carries the order's before/after status,
  // and `leadId` keeps it on the lead's own journey.
  | 'QC_VERIFIED'
  | 'QC_REJECTED'
  | 'RESUBMITTED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RTO'
  // The Logistics Manager's correction of a dispatched order's tracking number (Q9). A
  // correction of the order's data is the generic UPDATED.
  | 'AWB_CORRECTED'
  // The Accounts pipeline (ADR-0096): the record a delivery opens, a payment-status move, and a
  // correction — which carries its mandatory reason (Q14). Each keeps the order's `leadId`.
  | 'ACCOUNTS_CREATED'
  | 'PAYMENT_STATUS_CHANGED'
  | 'PAYMENT_STATUS_CORRECTED'
  // Administration and the remaining lead-side records (AUD-01). A field group that matters on
  // its own — a user's role, any access grant, an account's active flag — gets its own action
  // so it can be found without reading every UPDATED; the rest of a change stays UPDATED.
  | 'ROLE_CHANGED'
  | 'PERMISSIONS_CHANGED'
  | 'ACTIVATED'
  | 'DEACTIVATED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'MOVED'
  | 'COMPLETED'
  | 'EMAIL_SENT'
  | 'EXPORTED';

/**
 * Who made a change. A person is identified by user id. An automation or an integration
 * has no user; the event's `source` names it instead.
 */
export type AuditActor =
  { type: 'USER'; id: string } | { type: 'SYSTEM' } | { type: 'INTEGRATION' };

export interface AuditEventInput {
  entityType: AuditEntityType;
  entityId: string;
  /** The customer journey the change belongs to; null for catalogue records. */
  leadId: string | null;
  action: AuditAction;
  actor: AuditActor;
  /** The operation that produced the change, e.g. `leads.status`. */
  source: string;
  /** Only the fields that changed, before and after. */
  before?: Prisma.InputJsonObject;
  after?: Prisma.InputJsonObject;
  metadata?: Prisma.InputJsonObject;
}

export function userActor(user: { id: string }): AuditActor {
  return { type: 'USER', id: user.id };
}

/**
 * Writes the events through `client`, which must be the transaction the change itself runs
 * in. Returns the Prisma promise unawaited so it can also sit inside an array `$transaction`.
 */
export function recordAuditEvents(
  client: Prisma.TransactionClient,
  events: AuditEventInput[],
) {
  return client.auditEvent.createMany({ data: events.map(toRow) });
}

/**
 * For an action whose effect lies outside the database — an email the provider accepted, a file
 * already streamed to the browser — there is no transaction to share. The event is written once
 * the effect has happened, so a failed send or export is never recorded; and a failure to write
 * it is logged rather than thrown, because the effect cannot be taken back and a retry would
 * repeat it (a second email to the customer).
 */
export async function recordAfterEffect(
  client: Prisma.TransactionClient,
  logger: Pick<Logger, 'error'>,
  event: AuditEventInput,
): Promise<void> {
  try {
    await recordAuditEvents(client, [event]);
  } catch (error) {
    logger.error(
      `Audit event ${event.action} (${event.source}) was not recorded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A record as the log compares it: JSON-safe values only, lists already sorted. */
export type AuditState = Record<string, Prisma.InputJsonValue | null>;

/**
 * The events describing how one record went from `before` to `after`, the shape every lead path
 * already produces (`leadChangeEvents`): each `own` group that changed gets its own action,
 * whatever else changed is one UPDATED, and an unchanged record yields no event at all — a save
 * that changes nothing is not history.
 */
export function stateChangeEvents(
  base: Omit<AuditEventInput, 'action' | 'before' | 'after'>,
  before: AuditState,
  after: AuditState,
  own: [AuditAction, readonly string[]][] = [],
): AuditEventInput[] {
  const changed = Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  const claimed = new Set(own.flatMap(([, keys]) => keys));
  const groups: [AuditAction, string[]][] = [
    ...own.map(([action, keys]): [AuditAction, string[]] => [
      action,
      changed.filter((key) => keys.includes(key)),
    ]),
    ['UPDATED', changed.filter((key) => !claimed.has(key))],
  ];
  return groups
    .filter(([, keys]) => keys.length > 0)
    .map(([action, keys]) => ({
      ...base,
      action,
      before: pickState(before, keys),
      after: pickState(after, keys),
    }));
}

function pickState(state: AuditState, keys: string[]): Prisma.InputJsonObject {
  return Object.fromEntries(keys.map((key) => [key, state[key]]));
}

function toRow(event: AuditEventInput): Prisma.AuditEventCreateManyInput {
  return {
    entityType: event.entityType,
    entityId: event.entityId,
    leadId: event.leadId,
    action: event.action,
    actorType: event.actor.type,
    actorId: event.actor.type === 'USER' ? event.actor.id : null,
    source: event.source,
    before: event.before,
    after: event.after,
    metadata: event.metadata,
  };
}
