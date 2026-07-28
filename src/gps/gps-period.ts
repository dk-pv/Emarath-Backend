import { BadRequestException } from '@nestjs/common';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Caps the aggregation window so a wide range can't force an unbounded scan. */
export const MAX_GPS_RANGE_DAYS = 366;

/**
 * The optional [from, to] bounds a GPS read covers (GPS-04.1 / GPS-05.1, filtered
 * by GPS-07.1). Either bound may be absent — the caller then leaves that side open.
 * Rejects an inverted or oversized window here, the one place the summary and
 * locations reads turn `dateFrom`/`dateTo` into a range (mirrors the Call guard).
 */
export function resolveGpsBounds(dto: { dateFrom?: string; dateTo?: string }): {
  from?: Date;
  to?: Date;
} {
  const from = dto.dateFrom ? new Date(dto.dateFrom) : undefined;
  const to = dto.dateTo ? new Date(dto.dateTo) : undefined;
  if (from && to) {
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('dateTo must be on or after dateFrom');
    }
    if (to.getTime() - from.getTime() > MAX_GPS_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `date range must not exceed ${MAX_GPS_RANGE_DAYS} days`,
      );
    }
  }
  return { from, to };
}
