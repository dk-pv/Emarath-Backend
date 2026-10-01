import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditAction,
  AuditActor,
  AuditEventInput,
  recordAuditEvents,
} from '../audit/audit-events';
import { CONVERTED_STATUS } from '../reports/converted-leads-where';
import {
  becameConverted,
  convertLeadsToOrders,
} from '../logistics/logistics-conversion';

/**
 * Lead history capture (ADR-0083).
 *
 * Every write path reads the lead as the log sees it before and after the change, inside the
 * same transaction and under a row lock, and records the difference. One diff for every path
 * means a status change reads the same whether it came from the list, the board or the edit
 * form, and a path cannot forget to mention a field it happened to change.
 */

export interface LeadAuditContext {
  actor: AuditActor;
  source: string;
  metadata?: Prisma.InputJsonObject;
}

export interface LeadChangeOptions {
  /**
   * Set only by the Logistics service's own write-backs (QC rejection and resubmit). A
   * converted lead's status is owned by the Logistics lifecycle: every other caller — the edit
   * form, the status action, the board, Change Pipeline, bulk — is refused (client
   * clarification of 2026-09-23, "Converted Lead status editing").
   */
  logisticsWriteBack?: boolean;
}

/** Everything the log compares. Timestamps are left out: they move on every write. */
const LEAD_AUDIT_SELECT = {
  id: true,
  name: true,
  firstName: true,
  primaryPhone: true,
  secondaryPhone: true,
  email: true,
  language: true,
  country: true,
  source: true,
  status: true,
  lostReason: true,
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
  deletedAt: true,
  assignments: { select: { userId: true } },
  tags: { select: { tagId: true } },
  customFieldValues: { select: { customFieldId: true, value: true } },
  complaints: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { details: true },
  },
} satisfies Prisma.LeadSelect;

export type LeadAuditRow = Prisma.LeadGetPayload<{
  select: typeof LEAD_AUDIT_SELECT;
}>;

/** A lead as the log records it: JSON-safe, with lists sorted so two reads compare by value. */
export function toLeadAuditState(row: LeadAuditRow) {
  return {
    name: row.name,
    firstName: row.firstName,
    primaryPhone: row.primaryPhone,
    secondaryPhone: row.secondaryPhone,
    email: row.email,
    language: row.language,
    country: row.country,
    source: row.source,
    status: row.status,
    lostReason: row.lostReason,
    pipeline: row.pipeline,
    product: row.product,
    productQty: row.productQty?.toString() ?? null,
    product2: row.product2,
    product2Qty: row.product2Qty?.toString() ?? null,
    bookingDate: row.bookingDate?.toISOString().slice(0, 10) ?? null,
    category: row.category,
    actualAmount: row.actualAmount?.toString() ?? null,
    forecastedAmount: row.forecastedAmount?.toString() ?? null,
    paymentMethod: row.paymentMethod,
    state: row.state,
    street: row.street,
    city: row.city,
    nationalCode: row.nationalCode,
    callStatus: row.callStatus,
    callAttempts: row.callAttempts,
    whatsappAttempts: row.whatsappAttempts,
    archived: row.deletedAt !== null,
    assigneeIds: row.assignments.map((a) => a.userId).sort(),
    tagIds: row.tags.map((t) => t.tagId).sort(),
    customFields: Object.fromEntries(
      row.customFieldValues
        .map((v): [string, string] => [v.customFieldId, v.value])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    complaint: row.complaints[0]?.details ?? null,
  } satisfies Prisma.InputJsonObject;
}

export type LeadAuditState = ReturnType<typeof toLeadAuditState>;
type LeadAuditField = keyof LeadAuditState;

/** Fields that get their own event; anything else that changes is reported as UPDATED. */
const OWN_EVENT_FIELDS = new Set<LeadAuditField>([
  'status',
  'lostReason',
  'pipeline',
  'assigneeIds',
  'archived',
]);

/**
 * Locks the leads for the rest of the transaction, in id order so two bulk actions over the
 * same leads queue rather than deadlock. Without it, two concurrent changes would each read
 * the same "before" and the log would misstate what the second one changed.
 */
export async function lockLeads(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM leads WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

export async function readLeadAuditStates(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<Map<string, LeadAuditState>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.lead.findMany({
    where: { id: { in: ids } },
    select: LEAD_AUDIT_SELECT,
  });
  return new Map(rows.map((row) => [row.id, toLeadAuditState(row)]));
}

/** The events that describe how one lead went from `before` to `after`. */
export function leadChangeEvents(
  leadId: string,
  before: LeadAuditState,
  after: LeadAuditState,
  context: LeadAuditContext,
): AuditEventInput[] {
  const fields = Object.keys(after) as LeadAuditField[];
  const changed = fields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
  const has = (field: LeadAuditField) => changed.includes(field);
  const events: AuditEventInput[] = [];
  const add = (action: AuditAction, keys: LeadAuditField[]) =>
    events.push(
      leadEvent(leadId, action, context, pick(before, keys), pick(after, keys)),
    );

  if (has('status') || has('lostReason')) {
    const converted =
      after.status === CONVERTED_STATUS && before.status !== CONVERTED_STATUS;
    add(
      converted ? 'CONVERTED' : 'STATUS_CHANGED',
      has('lostReason') ? ['status', 'lostReason'] : ['status'],
    );
  }
  if (has('pipeline')) add('PIPELINE_CHANGED', ['pipeline']);
  if (has('assigneeIds')) {
    add(assignmentAction(before.assigneeIds, after.assigneeIds), [
      'assigneeIds',
    ]);
  }
  if (has('archived'))
    add(after.archived ? 'ARCHIVED' : 'UNARCHIVED', ['archived']);

  const rest = changed.filter((field) => !OWN_EVENT_FIELDS.has(field));
  if (rest.length > 0) add('UPDATED', rest);

  return events;
}

/** A new lead's full initial state, plus who it was first assigned to. */
export function leadCreatedEvents(
  leadId: string,
  state: LeadAuditState,
  context: LeadAuditContext,
): AuditEventInput[] {
  const events = [leadEvent(leadId, 'CREATED', context, undefined, state)];
  if (state.assigneeIds.length > 0) {
    events.push(
      leadEvent(
        leadId,
        'ASSIGNED',
        context,
        { assigneeIds: [] },
        { assigneeIds: state.assigneeIds },
      ),
    );
  }
  return events;
}

/** The whole lead as it stood, kept because the row itself is about to disappear. */
export function leadDeletedEvent(
  leadId: string,
  state: LeadAuditState,
  context: LeadAuditContext,
): AuditEventInput {
  return leadEvent(leadId, 'DELETED', context, state, undefined);
}

/** A hard delete refused because other records depend on the lead; the lead is unchanged. */
export function leadDeleteBlockedEvent(
  leadId: string,
  linked: Prisma.InputJsonObject,
  context: LeadAuditContext,
): AuditEventInput {
  return {
    ...leadEvent(leadId, 'DELETE_BLOCKED', context, undefined, undefined),
    metadata: { ...context.metadata, reason: 'LINKED_RECORDS', linked },
  };
}

/**
 * Lock, diff and record a change to existing leads **inside the caller's transaction**.
 *
 * `auditLeadChanges` is this with a transaction around it, and is what every lead write path
 * uses. This form exists for a caller that already holds a transaction of its own and must
 * share it: `auditLeadChanges` would open a second one, which would then wait on the lead lock
 * the first still holds (ADR-0085 §A2).
 */
export async function applyLeadChanges<T>(
  tx: Prisma.TransactionClient,
  leadIds: string[],
  context: LeadAuditContext,
  change: (tx: Prisma.TransactionClient) => Promise<T>,
  options: LeadChangeOptions = {},
): Promise<T> {
  await lockLeads(tx, leadIds);
  const before = await readLeadAuditStates(tx, leadIds);
  const result = await change(tx);
  const after = await readLeadAuditStates(tx, leadIds);

  // Only a status or pipeline move can breach a converted lead's guards or convert one, so
  // every other write path (assign, tag, note, archive, edit of ordinary fields) asks the
  // orders table nothing.
  const moved = leadIds.filter((id) => {
    const was = before.get(id);
    const now = after.get(id);
    return (
      was !== undefined &&
      now !== undefined &&
      (was.status !== now.status || was.pipeline !== now.pipeline)
    );
  });
  const ordered = await leadsWithOrders(tx, moved);
  guardConvertedLeads(moved, before, after, ordered, options);

  const conversion = await convertLeadsToOrders(
    tx,
    moved
      .filter((id) => becameConverted(before.get(id), after.get(id)!))
      .map((id) => ({ id, state: after.get(id)! })),
    context,
  );

  const events = leadIds.flatMap((id) => {
    const was = before.get(id);
    const now = after.get(id);
    if (!was || !now) return [];
    return withOrderId(
      leadChangeEvents(id, was, now, context),
      conversion.orderIdByLead.get(id),
    );
  });
  events.push(...conversion.events);
  if (events.length > 0) await recordAuditEvents(tx, events);
  return result;
}

/** Which of these leads already carry a Logistics order. */
async function leadsWithOrders(
  tx: Prisma.TransactionClient,
  leadIds: string[],
): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const rows = await tx.logisticsOrder.findMany({
    where: { leadId: { in: leadIds } },
    select: { leadId: true },
  });
  return new Set(rows.map((row) => row.leadId));
}

/**
 * The rules a converted lead lives under, enforced here because this is the one point every
 * write path passes through under the row lock — a guard on the Change Pipeline endpoint alone
 * would miss Edit, which can also change `pipeline` (ADR-0085 A2/B16).
 *
 * Once an order exists the lead's status belongs to the Logistics lifecycle, so only the
 * Logistics service's own write-backs (QC rejection and the controlled resubmit) may move it;
 * nothing may move the lead to another pipeline; and a lead may not convert while archived,
 * which the pre-lock scope check cannot rule out on its own. A 409 rolls the whole transaction
 * back, so the refused change leaves no row and no event behind.
 */
function guardConvertedLeads(
  leadIds: string[],
  before: Map<string, LeadAuditState>,
  after: Map<string, LeadAuditState>,
  ordered: Set<string>,
  options: LeadChangeOptions,
): void {
  for (const id of leadIds) {
    const was = before.get(id);
    const now = after.get(id);
    if (!was || !now) continue;

    if (ordered.has(id)) {
      if (was.pipeline !== now.pipeline) {
        throw new ConflictException(
          'This lead has a Logistics order, so it can’t be moved to another pipeline.',
        );
      }
      if (was.status !== now.status && !options.logisticsWriteBack) {
        throw new ConflictException(
          'This lead has a Logistics order, so its status is set by the Logistics workflow.',
        );
      }
    } else if (becameConverted(was, now) && now.archived) {
      throw new ConflictException(
        'An archived lead can’t be converted; restore it first.',
      );
    }
  }
}

/** `orderId` rides on the CONVERTED event alone — never on the call's shared metadata. */
function withOrderId(
  events: AuditEventInput[],
  orderId: string | undefined,
): AuditEventInput[] {
  if (!orderId) return events;
  return events.map((event) =>
    event.action === 'CONVERTED'
      ? { ...event, metadata: { ...event.metadata, orderId } }
      : event,
  );
}

/**
 * Runs a change to existing leads in one transaction and records what it changed. The lock,
 * both reads, the change and the events share the transaction, so a change that fails leaves
 * no event and an event that fails to write undoes the change.
 */
export function auditLeadChanges<T>(
  prisma: PrismaService,
  leadIds: string[],
  context: LeadAuditContext,
  change: (tx: Prisma.TransactionClient) => Promise<T>,
  options: LeadChangeOptions = {},
): Promise<T> {
  return prisma.$transaction((tx) =>
    applyLeadChanges(tx, leadIds, context, change, options),
  );
}

/**
 * Records the creation of leads just written in `tx`, read back so they match later diffs.
 *
 * A lead created straight into WON — the create form, Duplicate, Import (ADR-0085 A2 paths 1,
 * 6 and 7) — converts here, because it never passes through the change core: it gets its order
 * and its own CONVERTED event alongside CREATED, in this same transaction.
 */
export async function recordLeadsCreated(
  tx: Prisma.TransactionClient,
  leadIds: string[],
  context: LeadAuditContext,
): Promise<void> {
  const states = await readLeadAuditStates(tx, leadIds);
  const conversion = await convertLeadsToOrders(
    tx,
    [...states]
      .filter(([, state]) => becameConverted(undefined, state))
      .map(([id, state]) => ({ id, state })),
    context,
  );

  const events = [...states].flatMap(([id, state]) => {
    const created = leadCreatedEvents(id, state, context);
    const orderId = conversion.orderIdByLead.get(id);
    if (orderId) {
      created.push({
        ...leadEvent(id, 'CONVERTED', context, undefined, {
          status: state.status,
        }),
        metadata: { ...context.metadata, orderId },
      });
    }
    return created;
  });
  events.push(...conversion.events);
  if (events.length > 0) await recordAuditEvents(tx, events);
}

/** Additions only is ASSIGNED, removals only is UNASSIGNED, a swap is REASSIGNED. */
function assignmentAction(before: string[], after: string[]): AuditAction {
  const added = after.some((id) => !before.includes(id));
  const removed = before.some((id) => !after.includes(id));
  if (added && !removed) return 'ASSIGNED';
  if (removed && !added) return 'UNASSIGNED';
  return 'REASSIGNED';
}

function leadEvent(
  leadId: string,
  action: AuditAction,
  context: LeadAuditContext,
  before: Prisma.InputJsonObject | undefined,
  after: Prisma.InputJsonObject | undefined,
): AuditEventInput {
  return {
    entityType: 'LEAD',
    entityId: leadId,
    leadId,
    action,
    actor: context.actor,
    source: context.source,
    before,
    after,
    metadata: context.metadata,
  };
}

function pick(
  state: LeadAuditState,
  keys: LeadAuditField[],
): Prisma.InputJsonObject {
  return Object.fromEntries(keys.map((key) => [key, state[key]]));
}
