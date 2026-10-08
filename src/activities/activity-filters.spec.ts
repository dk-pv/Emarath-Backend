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

  it('matches a term inside the title prefix ("eting", "Call with")', () => {
    expect(activitySearchWhere('eting')).toEqual({
      OR: [
        { lead: { name: { contains: 'eting', mode: 'insensitive' } } },
        { type: ActivityType.MEETING },
      ],
    });
    expect(activitySearchWhere('Call with')).toEqual({
      OR: [
        { lead: { name: { contains: 'Call with', mode: 'insensitive' } } },
        { type: ActivityType.CALL },
      ],
    });
  });

  it('matches a term spanning the prefix and the customer name ("with Om")', () => {
    const where = activitySearchWhere('with Om') as { OR: unknown[] };
    // Every type's title has "with " before the name.
    for (const type of [
      ActivityType.CALL,
      ActivityType.MEETING,
      ActivityType.TASK,
    ]) {
      expect(where.OR).toContainEqual({
        type,
        lead: { name: { startsWith: 'Om', mode: 'insensitive' } },
      });
    }
  });

  it('matches the full title of one type ("Meeting with Omar Ali")', () => {
    const where = activitySearchWhere('Meeting with Omar Ali') as {
      OR: unknown[];
    };
    expect(where.OR).toContainEqual({
      type: ActivityType.MEETING,
      lead: { name: { startsWith: 'Omar Ali', mode: 'insensitive' } },
    });
    expect(where.OR).not.toContainEqual(
      expect.objectContaining({ type: ActivityType.CALL }),
    );
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
