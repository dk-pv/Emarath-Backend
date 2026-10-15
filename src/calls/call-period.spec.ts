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

  describe('with a time of day (client request 2026-10-13)', () => {
    it('keeps a 10:00–15:00 window to the minute: [06:00Z, 11:01Z) in UAE time', () => {
      const from = '2026-10-13T06:00:00.000Z';
      const to = '2026-10-13T11:01:00.000Z';
      const { start, end } = resolvePeriod({ from, to });
      expect(start.toISOString()).toBe(from);
      expect(end.toISOString()).toBe(to);
      expect(end.getTime() - start.getTime()).toBe((5 * 60 + 1) * 60 * 1000);
    });

    it('accepts a one-minute window and rejects one that ends a minute early', () => {
      const from = '2026-10-13T06:00:00.000Z';
      const { start, end } = resolvePeriod({
        from,
        to: '2026-10-13T06:01:00.000Z',
      });
      expect(end.getTime() - start.getTime()).toBe(60 * 1000);
      expect(() =>
        resolvePeriod({ from, to: '2026-10-13T05:59:00.000Z' }),
      ).toThrow(BadRequestException);
    });

    it('applies the width cap at minute precision, not by calendar day', () => {
      const from = new Date('2026-01-01T06:00:00.000Z');
      const cap = new Date(from.getTime() + MAX_RANGE_DAYS * DAY_MS);
      expect(() =>
        resolvePeriod({ from: from.toISOString(), to: cap.toISOString() }),
      ).not.toThrow();
      expect(() =>
        resolvePeriod({
          from: from.toISOString(),
          to: new Date(cap.getTime() + 60 * 1000).toISOString(),
        }),
      ).toThrow(BadRequestException);
    });
  });
});
