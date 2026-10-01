import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { Prisma } from '../../generated/prisma/client';

const MAX_PAGE_SIZE = 200;

/**
 * One customer journey's history (ADR-0083). `leadId` is the journey key, not a filter: an
 * order's and, later, an account's events carry the lead they belong to, so a single read
 * returns Lead → Logistics → Accounts in one list.
 */
export class ListAuditEventsDto {
  @IsUUID()
  leadId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE, { message: `size must be at most ${MAX_PAGE_SIZE}` })
  size: number = 50;
}

/**
 * One recorded change, as the API returns it.
 *
 * `entityType` and `action` are strings rather than the write-side unions: the columns are
 * VARCHAR and later phases add values (ACCOUNTS, PAYMENT_RECEIVED…) without a migration, so a
 * reader compiled today must still hand back a row written tomorrow instead of failing on it.
 */
export interface AuditEventResponse {
  id: string;
  entityType: string;
  entityId: string;
  leadId: string | null;
  action: string;
  actorType: string;
  actorId: string | null;
  source: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
}

export interface AuditEventListResponse {
  rows: AuditEventResponse[];
  total: number;
}

/**
 * Everything the response needs, declared once so query and mapper cannot drift. `updatedAt` is
 * deliberately absent: the table is never updated, so it only ever repeats `createdAt`.
 */
export const AUDIT_EVENT_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  leadId: true,
  action: true,
  actorType: true,
  actorId: true,
  source: true,
  before: true,
  after: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.AuditEventSelect;

type AuditEventRow = Prisma.AuditEventGetPayload<{
  select: typeof AUDIT_EVENT_SELECT;
}>;

export function toAuditEventResponse(row: AuditEventRow): AuditEventResponse {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
