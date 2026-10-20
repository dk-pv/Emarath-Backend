import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AUDIT_ENTITY_TYPES } from '../audit-events';
import { AuditEventResponse } from './audit-event.dto';

export const AUDIT_LOG_MAX_PAGE_SIZE = 100;
/** An offset is read and discarded row by row; nobody pages a log this deep. */
export const AUDIT_LOG_MAX_PAGE = 1000;

/**
 * The administrator's audit log (AUD-02): every recorded change, newest first, narrowed by
 * record type, by who made it and by a `[from, to)` window of ISO instants — the browser sends
 * its own day edges, as every date filter here does (ADR-0089).
 */
export class ListAuditLogDto {
  @IsOptional()
  @IsIn(AUDIT_ENTITY_TYPES, { message: 'entityType must be a recorded type' })
  entityType?: string;

  @IsOptional()
  @IsUUID('all', { message: 'actorId must be a user id' })
  actorId?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from must be an ISO date-time' })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to must be an ISO date-time' })
  to?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_LOG_MAX_PAGE, {
    message: `page must be at most ${AUDIT_LOG_MAX_PAGE}`,
  })
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_LOG_MAX_PAGE_SIZE, {
    message: `size must be at most ${AUDIT_LOG_MAX_PAGE_SIZE}`,
  })
  size: number = 25;
}

/**
 * One event as the log shows it: the journey's shape plus who acted and what the record is
 * called, with every sensitive value already hidden by the API (`redactAuditValue`).
 */
export interface AuditLogRow extends AuditEventResponse {
  actorName: string | null;
  entityLabel: string | null;
}

export interface AuditLogListResponse {
  rows: AuditLogRow[];
  total: number;
}

export interface AuditLogFilterOptions {
  entityTypes: readonly string[];
  actors: { id: string; name: string }[];
}
