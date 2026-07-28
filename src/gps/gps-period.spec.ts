import { BadRequestException } from '@nestjs/common';
import { MAX_GPS_RANGE_DAYS, resolveGpsBounds } from './gps-period';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('resolveGpsBounds', () => {
  it('returns no bounds when neither date is supplied', () => {
    expect(resolveGpsBounds({})).toEqual({ from: undefined, to: undefined });
  });

  it('passes a valid window through as Dates', () => {
    const dateFrom = '2026-07-16T00:00:00.000Z';
    const dateTo = '2026-07-16T23:59:59.999Z';
    const { from, to } = resolveGpsBounds({ dateFrom, dateTo });
    expect(from?.toISOString()).toBe(dateFrom);
    expect(to?.toISOString()).toBe(dateTo);
  });

  it('leaves an open side open (only one bound)', () => {
    const { from, to } = resolveGpsBounds({
      dateFrom: '2026-07-16T00:00:00.000Z',
    });
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeUndefined();
  });

  it('rejects an inverted window (from > to)', () => {
    expect(() =>
      resolveGpsBounds({
        dateFrom: '2026-07-16T00:00:00.000Z',
        dateTo: '2026-07-01T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  it(`rejects a window wider than ${MAX_GPS_RANGE_DAYS} days`, () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date(from.getTime() + (MAX_GPS_RANGE_DAYS + 1) * DAY_MS);
    expect(() =>
      resolveGpsBounds({
        dateFrom: from.toISOString(),
        dateTo: to.toISOString(),
      }),
    ).toThrow(BadRequestException);
  });
});
