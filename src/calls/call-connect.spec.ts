import { callConnectPct } from './call-connect';

describe('callConnectPct (CALL-07.1, Option A: Answered ÷ Total × 100)', () => {
  it('matches the Workpex sample: 9 answered of 16 total = 56.25% (AC5)', () => {
    expect(callConnectPct(9, 16)).toBe(56.25);
  });

  it('computes other known samples to two decimals', () => {
    expect(callConnectPct(12, 16)).toBe(75);
    expect(callConnectPct(1, 3)).toBe(33.33);
    expect(callConnectPct(5, 5)).toBe(100);
  });

  it('returns 0 for zero calls without a division error (AC4)', () => {
    expect(callConnectPct(0, 0)).toBe(0);
  });

  it('returns 0 when no calls were answered', () => {
    expect(callConnectPct(0, 16)).toBe(0);
  });

  it('is a percentage distinct from the Answered count (AC2)', () => {
    // 9 answered → 56.25%, never the raw count 9.
    expect(callConnectPct(9, 16)).not.toBe(9);
  });
});
