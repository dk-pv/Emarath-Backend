import { ActivityType, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildTodaysFollowUpsWhere } from './todays-follow-ups-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };
const TODAY_START = '2026-09-02T00:00:00.000Z';
const TODAY_END = '2026-09-03T00:00:00.000Z';

/** Every AND fragment, so a test can assert on the piece it cares about. */
function fragments(
  user: CurrentUser,
  filters: Parameters<typeof buildTodaysFollowUpsWhere>[1],
) {
  const where = buildTodaysFollowUpsWhere(user, filters);
  return (where.AND as Record<string, unknown>[]) ?? [];
}

const base = { todayStart: TODAY_START, todayEnd: TODAY_END };

describe('buildTodaysFollowUpsWhere', () => {
  it('constrains to the today bucket — open, and due inside the half-open day', () => {
    const parts = fragments(admin, base);
    const today = parts.find((part) => 'completedAt' in part) as
      { completedAt: unknown; dueAt: { gte: Date; lt: Date } } | undefined;
    expect(today?.completedAt).toBeNull();
    expect(today?.dueAt.gte).toEqual(new Date(TODAY_START));
    expect(today?.dueAt.lt).toEqual(new Date(TODAY_END));
  });

  it('carries the caller role scope so an agent sees only their own follow-ups', () => {
    const json = JSON.stringify(buildTodaysFollowUpsWhere(agent, base));
    expect(json).toContain('"userId":"agent-1"');
    // Still today-only for the agent.
    expect(json).toContain('"completedAt":null');
  });

  it('threads the agent filter through the assignee join', () => {
    const parts = fragments(admin, { ...base, agent: ['u-1', 'u-2'] });
    expect(parts).toContainEqual({
      assignees: { some: { userId: { in: ['u-1', 'u-2'] } } },
    });
  });

  it('threads the pipeline filter through the linked lead', () => {
    const parts = fragments(admin, { ...base, pipeline: ['Lead Pipeline'] });
    expect(parts).toContainEqual({
      lead: { pipeline: { in: ['Lead Pipeline'] } },
    });
  });

  it('threads the follow-up type filter through the activity type', () => {
    const parts = fragments(admin, {
      ...base,
      type: [ActivityType.CALL, ActivityType.TASK],
    });
    expect(parts).toContainEqual({
      type: { in: [ActivityType.CALL, ActivityType.TASK] },
    });
  });

  it('adds no filter predicate when the toolbar is untouched', () => {
    const json = JSON.stringify(
      buildTodaysFollowUpsWhere(admin, {
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

  it('excludes a follow-up due exactly at the day boundary (half-open window)', () => {
    const parts = fragments(admin, base);
    const today = parts.find((part) => 'dueAt' in part) as {
      dueAt: { gte: Date; lt: Date };
    };
    // `lt` (not `lte`): midnight tomorrow belongs to tomorrow, not today.
    expect(today.dueAt.lt).toEqual(new Date(TODAY_END));
  });
});
