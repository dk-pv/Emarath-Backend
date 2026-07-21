import { leadFilterWhere, normalizeFilterValues } from './lead-filter';

describe('normalizeFilterValues', () => {
  it('returns undefined when there is nothing to filter by (AC5)', () => {
    expect(normalizeFilterValues(undefined)).toBeUndefined();
    expect(normalizeFilterValues(null)).toBeUndefined();
    expect(normalizeFilterValues('')).toBeUndefined();
    expect(normalizeFilterValues('   ')).toBeUndefined();
    expect(normalizeFilterValues([])).toBeUndefined();
    expect(normalizeFilterValues(['', '  '])).toBeUndefined();
  });

  it('wraps a single scalar value into an array', () => {
    expect(normalizeFilterValues('New')).toEqual(['New']);
  });

  it('keeps a repeated (array) value as an array', () => {
    expect(normalizeFilterValues(['New', 'Hot'])).toEqual(['New', 'Hot']);
  });

  it('trims values and drops the blank ones', () => {
    expect(normalizeFilterValues(['  New  ', '', 'Hot'])).toEqual([
      'New',
      'Hot',
    ]);
  });

  it('drops non-string entries', () => {
    expect(normalizeFilterValues(['New', 5, {}, 'Hot'])).toEqual([
      'New',
      'Hot',
    ]);
  });
});

describe('leadFilterWhere', () => {
  it('returns no fragments when no filter is set (AC5)', () => {
    expect(leadFilterWhere({})).toEqual([]);
    expect(leadFilterWhere({ source: [], status: [] })).toEqual([]);
  });

  it('filters Source by exact value, ORed within the field (AC1)', () => {
    expect(leadFilterWhere({ source: ['DoubleTick', 'Broadcast'] })).toEqual([
      { source: { in: ['DoubleTick', 'Broadcast'] } },
    ]);
  });

  it('filters Status by exact value (AC1)', () => {
    expect(leadFilterWhere({ status: ['New', 'HOT'] })).toEqual([
      { status: { in: ['New', 'HOT'] } },
    ]);
  });

  it('filters Assigned Agent through the assignment join (AC1)', () => {
    const ids = ['11111111-1111-4111-8111-111111111111'];
    expect(leadFilterWhere({ assignedAgent: ids })).toEqual([
      { assignments: { some: { userId: { in: ids } } } },
    ]);
  });

  it('emits one fragment per active filter so they combine with AND (AC2)', () => {
    const ids = ['22222222-2222-4222-8222-222222222222'];
    const fragments = leadFilterWhere({
      source: ['DoubleTick'],
      status: ['New'],
      assignedAgent: ids,
    });
    expect(fragments).toEqual([
      { source: { in: ['DoubleTick'] } },
      { status: { in: ['New'] } },
      { assignments: { some: { userId: { in: ids } } } },
    ]);
  });

  // ── LEAD-04.1 Quick Filter fragments ──────────────────────────────────────

  it('filters a created-date window as a half-open [from, to) range', () => {
    const from = '2026-07-20T20:00:00.000Z';
    const to = '2026-07-21T20:00:00.000Z';
    expect(leadFilterWhere({ createdFrom: from, createdTo: to })).toEqual([
      { createdAt: { gte: new Date(from), lt: new Date(to) } },
    ]);
  });

  it('supports an open-ended created-date bound', () => {
    const from = '2026-07-14T20:00:00.000Z';
    expect(leadFilterWhere({ createdFrom: from })).toEqual([
      { createdAt: { gte: new Date(from) } },
    ]);
  });

  it('filters unassigned leads through the assignment join', () => {
    expect(leadFilterWhere({ unassigned: true })).toEqual([
      { assignments: { none: {} } },
    ]);
    expect(leadFilterWhere({ unassigned: false })).toEqual([]);
  });
});
