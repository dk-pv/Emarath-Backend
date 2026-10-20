import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ENTITY_TYPES } from './audit-events';
import {
  AUDIT_EVENT_SELECT,
  toAuditEventResponse,
} from './dto/audit-event.dto';
import {
  AuditLogFilterOptions,
  AuditLogListResponse,
  AuditLogRow,
  ListAuditLogDto,
} from './dto/audit-log.dto';

/** Newest first; `id` breaks ties so a row never repeats or vanishes between pages. */
const ORDER_BY: Prisma.AuditEventOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

const AUDIT_LOG_SELECT = {
  ...AUDIT_EVENT_SELECT,
  actor: { select: { name: true } },
} satisfies Prisma.AuditEventSelect;

type AuditLogDbRow = Prisma.AuditEventGetPayload<{
  select: typeof AUDIT_LOG_SELECT;
}>;

/** The user filter lists the staff directory, which is small; this only bounds the read. */
const ACTOR_OPTION_LIMIT = 1000;

export const HIDDEN = '[hidden]';

/**
 * Values the log never shows, whatever event holds them: credentials and their hashes, tokens
 * and secrets, storage paths (avatar and document keys), email addresses — a staff member's or a
 * customer's — and the free text a search or a field condition carried.
 */
const SENSITIVE_KEY =
  /password|hash|token|secret|storagekey|avatarkey|email|^search$|^conditions$/i;
const EMAIL = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi;
const BCRYPT = /^\$2[aby]\$\d{2}\$/;

/**
 * A recorded value as the log may show it. Applied at every depth, by key and by content, so an
 * address inside a note or a custom field is masked as surely as an `email` field is hidden.
 */
export function redactAuditValue(
  value: Prisma.JsonValue | null,
): Prisma.JsonValue | null {
  if (typeof value === 'string') {
    return BCRYPT.test(value) ? HIDDEN : value.replace(EMAIL, HIDDEN);
  }
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? HIDDEN : redactAuditValue(item ?? null),
      ]),
    );
  }
  return value;
}

/**
 * The administrator's audit log (AUD-02), read only. Every event the system records, for the
 * Super Admin — who already reaches every lead, order and setting, so no record is shown here
 * that its own screen would refuse. Nothing here writes: the log is written only by the change
 * that caused each event (ADR-0083).
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAuditLogDto): Promise<AuditLogListResponse> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException('The end must be after the start.');
    }

    // ponytail: newest-first over the whole table sorts every match (only actor and type have
    // an index that leads with them); add an index on created_at once the log reaches millions.
    const where: Prisma.AuditEventWhereInput = {
      entityType: query.entityType,
      actorId: query.actorId,
      ...(from || to ? { createdAt: { gte: from, lt: to } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        select: AUDIT_LOG_SELECT,
        orderBy: ORDER_BY,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    const labels = await this.entityLabels(rows);
    return { rows: rows.map((row) => toAuditLogRow(row, labels)), total };
  }

  async filterOptions(): Promise<AuditLogFilterOptions> {
    const actors = await this.prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: ACTOR_OPTION_LIMIT,
    });
    return { entityTypes: AUDIT_ENTITY_TYPES, actors };
  }

  /**
   * What each record on the page is called, read in one query per kind: a person's or role's
   * name, a lead's, an order's number. An activity, note or email has no name of its own and
   * reads as its lead. A record since deleted has no label; its event still says what it was.
   */
  private async entityLabels(
    rows: { entityType: string; entityId: string; leadId: string | null }[],
  ): Promise<Map<string, string>> {
    const idsOf = (type: string) => [
      ...new Set(
        rows
          .filter((row) => row.entityType === type)
          .map((row) => row.entityId),
      ),
    ];
    const leadIds = [
      ...new Set([
        ...idsOf('LEAD'),
        ...rows.flatMap((row) => (row.leadId ? [row.leadId] : [])),
      ]),
    ];
    const read = <T>(ids: string[], query: (ids: string[]) => Promise<T[]>) =>
      ids.length > 0 ? query(ids) : Promise.resolve([] as T[]);
    const named = { id: true, name: true } as const;

    const [users, roles, pipelines, integrations, documents, orders, leads] =
      await Promise.all([
        read(idsOf('USER'), (ids) =>
          this.prisma.user.findMany({
            where: { id: { in: ids } },
            select: named,
          }),
        ),
        read(idsOf('ROLE'), (ids) =>
          this.prisma.role.findMany({
            where: { id: { in: ids } },
            select: named,
          }),
        ),
        read(idsOf('PIPELINE'), (ids) =>
          this.prisma.pipeline.findMany({
            where: { id: { in: ids } },
            select: named,
          }),
        ),
        read(idsOf('INTEGRATION'), (ids) =>
          this.prisma.integration.findMany({
            where: { id: { in: ids } },
            select: named,
          }),
        ),
        read(idsOf('DOCUMENT'), (ids) =>
          this.prisma.document.findMany({
            where: { id: { in: ids } },
            select: { id: true, title: true },
          }),
        ),
        read(idsOf('LOGISTICS_ORDER'), (ids) =>
          this.prisma.logisticsOrder.findMany({
            where: { id: { in: ids } },
            select: { id: true, orderNumber: true },
          }),
        ),
        read(leadIds, (ids) =>
          this.prisma.lead.findMany({
            where: { id: { in: ids } },
            select: named,
          }),
        ),
      ]);

    const labels = new Map<string, string>();
    for (const [type, list] of [
      ['USER', users],
      ['ROLE', roles],
      ['PIPELINE', pipelines],
      ['INTEGRATION', integrations],
      ['LEAD', leads],
    ] as const) {
      for (const item of list) labels.set(`${type}:${item.id}`, item.name);
    }
    for (const item of documents) labels.set(`DOCUMENT:${item.id}`, item.title);
    for (const item of orders) {
      labels.set(`LOGISTICS_ORDER:${item.id}`, `#${item.orderNumber}`);
    }
    return labels;
  }
}

function toAuditLogRow(
  row: AuditLogDbRow,
  labels: Map<string, string>,
): AuditLogRow {
  const { actor, ...event } = row;
  return {
    ...toAuditEventResponse(event),
    before: redactAuditValue(event.before),
    after: redactAuditValue(event.after),
    metadata: redactAuditValue(event.metadata),
    actorName: actor?.name ?? null,
    entityLabel:
      labels.get(`${event.entityType}:${event.entityId}`) ??
      (event.leadId ? (labels.get(`LEAD:${event.leadId}`) ?? null) : null),
  };
}
