import {
  activityDateWindowWhere,
  activityDueRangeWhere,
  type ActivityWindowEdges,
} from './activity-date-windows';

const d = (iso: string) => new Date(iso);

const EDGES: ActivityWindowEdges = {
  todayStart: d('2026-08-29T00:00:00.000Z'),
  todayEnd: d('2026-08-30T00:00:00.000Z'),
  tomorrowEnd: d('2026-08-31T00:00:00.000Z'),
  yesterdayStart: d('2026-08-28T00:00:00.000Z'),
  weekStart: d('2026-08-24T00:00:00.000Z'),
  weekEnd: d('2026-08-31T00:00:00.000Z'),
  monthStart: d('2026-08-01T00:00:00.000Z'),
  monthEnd: d('2026-09-01T00:00:00.000Z'),
};

describe('activityDateWindowWhere', () => {
  it('adds no condition when nothing is ticked', () => {
    expect(activityDateWindowWhere(undefined, EDGES)).toBeUndefined();
    expect(activityDateWindowWhere([], EDGES)).toBeUndefined();
  });

  it('keeps Overdue open-only — a completed item is never overdue', () => {
    expect(activityDateWindowWhere(['overdue'], EDGES)).toEqual({
      completedAt: null,
      dueAt: { lt: EDGES.todayStart },
    });
  });

  it('treats every other window as a pure due-date range', () => {
    expect(activityDateWindowWhere(['today'], EDGES)).toEqual({
      dueAt: { gte: EDGES.todayStart, lt: EDGES.todayEnd },
    });
    expect(activityDateWindowWhere(['yesterday'], EDGES)).toEqual({
      dueAt: { gte: EDGES.yesterdayStart, lt: EDGES.todayStart },
    });
    expect(activityDateWindowWhere(['thisMonth'], EDGES)).toEqual({
      dueAt: { gte: EDGES.monthStart, lt: EDGES.monthEnd },
    });
  });

  it('ORs several ticked windows — no row can satisfy both at once', () => {
    expect(activityDateWindowWhere(['today', 'tomorrow'], EDGES)).toEqual({
      OR: [
        { dueAt: { gte: EDGES.todayStart, lt: EDGES.todayEnd } },
        { dueAt: { gte: EDGES.todayEnd, lt: EDGES.tomorrowEnd } },
      ],
    });
  });

  it('drops a window whose edges were not sent rather than matching everything', () => {
    const partial: ActivityWindowEdges = {
      todayStart: EDGES.todayStart,
      todayEnd: EDGES.todayEnd,
      tomorrowEnd: EDGES.tomorrowEnd,
    };
    expect(activityDateWindowWhere(['thisWeek'], partial)).toBeUndefined();
    // A ticked window with edges still applies alongside one without.
    expect(activityDateWindowWhere(['thisWeek', 'today'], partial)).toEqual({
      dueAt: { gte: EDGES.todayStart, lt: EDGES.todayEnd },
    });
  });
});

describe('activityDueRangeWhere', () => {
  it('adds no condition when neither end is set', () => {
    expect(activityDueRangeWhere(undefined, undefined)).toBeUndefined();
  });

  it('applies a half-filled range rather than ignoring it', () => {
    expect(activityDueRangeWhere(EDGES.todayStart, undefined)).toEqual({
      dueAt: { gte: EDGES.todayStart },
    });
    expect(activityDueRangeWhere(undefined, EDGES.todayEnd)).toEqual({
      dueAt: { lt: EDGES.todayEnd },
    });
  });

  it('applies both ends together', () => {
    expect(activityDueRangeWhere(EDGES.todayStart, EDGES.todayEnd)).toEqual({
      dueAt: { gte: EDGES.todayStart, lt: EDGES.todayEnd },
    });
  });

  it('keeps the minute a time-precise From/To range was picked at', () => {
    // 10:00 AM → 3:00 PM on 13 Oct, UAE time; the To edge is one minute past 3:00 PM.
    const from = new Date('2026-10-13T06:00:00.000Z');
    const to = new Date('2026-10-13T11:01:00.000Z');
    const range = activityDueRangeWhere(from, to) as {
      dueAt: { gte: Date; lt: Date };
    };
    expect(range).toEqual({ dueAt: { gte: from, lt: to } });

    // Half-open: the first included instant is 10:00:00, the first excluded is 3:01 PM.
    const inside = (iso: string) => {
      const t = Date.parse(iso);
      return t >= range.dueAt.gte.getTime() && t < range.dueAt.lt.getTime();
    };
    expect(inside('2026-10-13T05:59:59.999Z')).toBe(false);
    expect(inside('2026-10-13T06:00:00.000Z')).toBe(true);
    expect(inside('2026-10-13T11:00:59.999Z')).toBe(true);
    expect(inside('2026-10-13T11:01:00.000Z')).toBe(false);
  });
});
