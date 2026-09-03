import { ActivityType, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildUpcomingFollowUpsWhere } from './upcoming-follow-ups-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };
const TODAY_END = '2026-09-03T00:00:00.000Z';
const base = { todayEnd: TODAY_END };

/** Every AND fragment, so a test can assert on the piece it cares about. */
function fragments(
  user: CurrentUser,
  filters: Parameters<typeof buildUpcomingFollowUpsWhere>[1],
) {
  const where = buildUpcomingFollowUpsWhere(user, filters);
  return (where.AND as Record<string, unknown>[]) ?? [];
}

describe('buildUpcomingFollowUpsWhere', () => {
  it('constrains to open follow-ups due from tomorrow onward', () => {
    const parts = fragments(admin, base);
    const upcoming = parts.find((part) => 'completedAt' in part) as
      { completedAt: unknown; dueAt: { gte: Date } } | undefined;
    expect(upcoming?.completedAt).toBeNull();
    expect(upcoming?.dueAt.gte).toEqual(new Date(TODAY_END));
  });

  it('starts at tomorrow, so it never reaches back into today or the past', () => {
    const parts = fragments(admin, base);
    const upcoming = parts.find((part) => 'completedAt' in part) as {
      dueAt: { gte: Date; lt?: Date };
    };
    // `gte todayEnd` is the exact complement of the overdue (`< todayStart`) and today
    // (`[todayStart, todayEnd)`) buckets, so the three partition every open follow-up.
    expect(upcoming.dueAt.gte).toEqual(new Date(TODAY_END));
    expect(upcoming.dueAt.lt).toBeUndefined();
  });

  it('carries the caller role scope so an agent sees only their own follow-ups', () => {
    const json = JSON.stringify(buildUpcomingFollowUpsWhere(agent, base));
    expect(json).toContain('"userId":"agent-1"');
    expect(json).toContain('"completedAt":null');
  });

  it('applies the By Date window to the due date, on top of the upcoming floor', () => {
    const parts = fragments(admin, {
      ...base,
      from: '2026-09-10T00:00:00.000Z',
      to: '2026-09-20T00:00:00.000Z',
    });
    expect(parts).toContainEqual({
      dueAt: {
        gte: new Date('2026-09-10T00:00:00.000Z'),
        lt: new Date('2026-09-20T00:00:00.000Z'),
      },
    });
    // The floor is still there, so a window cannot widen the report.
    expect(parts.some((part) => 'completedAt' in part)).toBe(true);
  });

  it('keeps the upcoming floor when the window reaches into the past', () => {
    const where = buildUpcomingFollowUpsWhere(admin, {
      ...base,
      from: '2020-01-01T00:00:00.000Z',
    });
    const parts = (where.AND as Record<string, unknown>[]) ?? [];
    // Both conditions are ANDed, so a past window intersects the floor to nothing earlier
    // than tomorrow — a past-due follow-up can never appear in an upcoming report.
    const floor = parts.find((part) => 'completedAt' in part) as {
      dueAt: { gte: Date };
    };
    expect(floor.dueAt.gte).toEqual(new Date(TODAY_END));
  });

  it('threads the agent, pipeline and type filters through the shared fragments', () => {
    const parts = fragments(admin, {
      ...base,
      agent: ['u-1'],
      pipeline: ['Lead Pipeline'],
      type: [ActivityType.CALL],
    });
    expect(parts).toContainEqual({
      assignees: { some: { userId: { in: ['u-1'] } } },
    });
    expect(parts).toContainEqual({
      lead: { pipeline: { in: ['Lead Pipeline'] } },
    });
    expect(parts).toContainEqual({ type: { in: [ActivityType.CALL] } });
  });

  it('adds no filter or window predicate when the toolbar is untouched', () => {
    const json = JSON.stringify(
      buildUpcomingFollowUpsWhere(admin, {
        ...base,
        agent: [],
        pipeline: [],
        type: [],
      }),
    );
    expect(json).not.toContain('pipeline');
    expect(json).not.toContain('"type"');
    expect(json).not.toContain('userId');
  });
});
