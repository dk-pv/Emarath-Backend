import { ActivityType } from '../generated/prisma/client';
import { activityFilterWhere, activitySearchWhere } from './activity-filters';

describe('activitySearchWhere', () => {
  it('returns undefined for an empty or whitespace term', () => {
    expect(activitySearchWhere(undefined)).toBeUndefined();
    expect(activitySearchWhere('   ')).toBeUndefined();
  });

  it('matches the customer name case-insensitively', () => {
    expect(activitySearchWhere('acme')).toEqual({
      OR: [{ lead: { name: { contains: 'acme', mode: 'insensitive' } } }],
    });
  });

  it('also matches the type when the term is a prefix of its label', () => {
    expect(activitySearchWhere('meet')).toEqual({
      OR: [
        { lead: { name: { contains: 'meet', mode: 'insensitive' } } },
        { type: ActivityType.MEETING },
      ],
    });
  });

  it('escapes LIKE wildcards in the term', () => {
    const where = activitySearchWhere('50%') as {
      OR: [{ lead: { name: { contains: string } } }];
    };
    expect(where.OR[0].lead.name.contains).toBe('50\\%');
  });
});

describe('activityFilterWhere', () => {
  it('is empty with no filters', () => {
    expect(activityFilterWhere({})).toEqual([]);
  });

  it('matches assignee through the assignee join', () => {
    expect(activityFilterWhere({ assignedAgent: ['u1', 'u2'] })).toEqual([
      { assignees: { some: { userId: { in: ['u1', 'u2'] } } } },
    ]);
  });

  it('matches status and pipeline on the linked lead, ANDed across fields', () => {
    expect(
      activityFilterWhere({ status: ['New'], pipeline: ['Sales'] }),
    ).toEqual([
      { lead: { status: { in: ['New'] } } },
      { lead: { pipeline: { in: ['Sales'] } } },
    ]);
  });

  it('matches the follow-up type from the popup dropdown', () => {
    expect(activityFilterWhere({ type: [ActivityType.CALL] })).toEqual([
      { type: { in: [ActivityType.CALL] } },
    ]);
  });

  it('ANDs type alongside the other filters', () => {
    expect(
      activityFilterWhere({ assignedAgent: ['u1'], type: [ActivityType.TASK] }),
    ).toEqual([
      { assignees: { some: { userId: { in: ['u1'] } } } },
      { type: { in: [ActivityType.TASK] } },
    ]);
  });
});
