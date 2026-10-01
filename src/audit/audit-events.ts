import { Prisma } from '../generated/prisma/client';

/**
 * The append-only audit log (ADR-0083).
 *
 * Every event is written through the same transaction client as the change it describes,
 * so a change and its history commit or roll back together — there is no path where the
 * lead moved and the log missed it, or the log claims a move that never happened.
 */

/** The kinds of record the log describes today. Later phases add their own. */
export type AuditEntityType = 'LEAD' | 'STAGE' | 'PIPELINE' | 'LOGISTICS_ORDER';

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
  | 'RTO';

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
