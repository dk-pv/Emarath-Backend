import {
  activityBucketWhere,
  overdueCutoff,
  type DayBoundaries,
  type OverdueRule,
} from './activity-buckets';

/**
 * "Make Appointment as Overdue" (Settings → Activity and Reminders) moves one instant —
 * the cutoff Overdue sits below and Today sits above. These assert that the shipped rule
 * is untouched when nothing is configured, and that the two buckets never claim the same
 * row when a custom span is.
 */
const boundaries: DayBoundaries = {
  todayStart: new Date('2026-09-05T00:00:00.000Z'),
  todayEnd: new Date('2026-09-06T00:00:00.000Z'),
  tomorrowEnd: new Date('2026-09-07T00:00:00.000Z'),
};

const now = new Date('2026-09-05T14:00:00.000Z');

const custom = (minutes: number): OverdueRule => ({
  mode: 'CUSTOM_TIME_SPAN',
  minutes,
  now,
});

/** `dueAt` narrowed to the shape the bucket predicates actually build. */
const dueAt = (where: ReturnType<typeof activityBucketWhere>) =>
  where.dueAt as { gte?: Date; lt?: Date };

describe('overdueCutoff', () => {
  it('is the start of today when no rule is configured', () => {
    expect(overdueCutoff(boundaries)).toEqual(boundaries.todayStart);
  });

  it('is the start of today under the end-of-day rule', () => {
    expect(
      overdueCutoff(boundaries, { mode: 'END_OF_DAY', minutes: 15, now }),
    ).toEqual(boundaries.todayStart);
  });

  it('is the configured span before now under a custom time span', () => {
    expect(overdueCutoff(boundaries, custom(15))).toEqual(
      new Date('2026-09-05T13:45:00.000Z'),
    );
  });
});

describe('activityBucketWhere', () => {
  it('leaves the shipped buckets exactly as they were without a rule', () => {
    expect(activityBucketWhere('overdue', boundaries)).toEqual({
      completedAt: null,
      dueAt: { lt: boundaries.todayStart },
    });
    expect(activityBucketWhere('today', boundaries)).toEqual({
      completedAt: null,
      dueAt: { gte: boundaries.todayStart, lt: boundaries.todayEnd },
    });
  });

  it('moves the overdue cutoff to the custom span', () => {
    const where = activityBucketWhere('overdue', boundaries, custom(30));

    expect(dueAt(where).lt).toEqual(new Date('2026-09-05T13:30:00.000Z'));
  });

  it('starts Today at the cutoff, so a lapsed appointment is only overdue', () => {
    const where = activityBucketWhere('today', boundaries, custom(15));

    // Due at 13:00 today: past the 13:45 cutoff, so Today no longer claims it.
    expect(dueAt(where).gte).toEqual(new Date('2026-09-05T13:45:00.000Z'));
    expect(dueAt(where).lt).toEqual(boundaries.todayEnd);
  });

  it('keeps Today starting at midnight when the cutoff is earlier', () => {
    // A span long enough to reach back past midnight cannot pull Today backwards.
    const where = activityBucketWhere('today', boundaries, {
      mode: 'CUSTOM_TIME_SPAN',
      minutes: 24 * 60,
      now,
    });

    expect(dueAt(where).gte).toEqual(boundaries.todayStart);
  });

  it('never lets Overdue and Today claim the same instant', () => {
    const rule = custom(15);
    const overdue = dueAt(activityBucketWhere('overdue', boundaries, rule));
    const today = dueAt(activityBucketWhere('today', boundaries, rule));

    expect(overdue.lt).toEqual(today.gte);
  });

  it('leaves Tomorrow, Completed and All untouched by the rule', () => {
    const rule = custom(60);

    expect(activityBucketWhere('tomorrow', boundaries, rule)).toEqual({
      completedAt: null,
      dueAt: { gte: boundaries.todayEnd, lt: boundaries.tomorrowEnd },
    });
    expect(activityBucketWhere('completed', boundaries, rule)).toEqual({
      completedAt: { not: null },
    });
    expect(activityBucketWhere('all', boundaries, rule)).toEqual({});
  });
});
