import { BadRequestException } from '@nestjs/common';
import { MAX_RANGE_DAYS, resolvePeriod } from './call-period';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('resolvePeriod', () => {
  it('defaults to the whole of today (UTC), end exclusive', () => {
    const { start, end } = resolvePeriod({});
    expect(end.getTime() - start.getTime()).toBe(DAY_MS);
  });

  it('passes a valid window through', () => {
    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-07-08T00:00:00.000Z';
    const { start, end } = resolvePeriod({ from, to });
    expect(start.toISOString()).toBe(from);
    expect(end.toISOString()).toBe(to);
  });

  it('rejects an inverted window (from > to)', () => {
    expect(() =>
      resolvePeriod({
        from: '2026-07-08T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  it(`rejects a window wider than ${MAX_RANGE_DAYS} days`, () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date(from.getTime() + (MAX_RANGE_DAYS + 1) * DAY_MS);
    expect(() =>
      resolvePeriod({ from: from.toISOString(), to: to.toISOString() }),
    ).toThrow(BadRequestException);
  });
});
