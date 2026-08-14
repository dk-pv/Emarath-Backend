import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildOverdueFollowUpsWhere } from './overdue-follow-ups-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };
const TODAY_START = '2026-08-14T00:00:00.000Z';

/** Every AND fragment, so a test can assert on the piece it cares about. */
function fragments(
  user: CurrentUser,
  filters: Parameters<typeof buildOverdueFollowUpsWhere>[1],
) {
  const where = buildOverdueFollowUpsWhere(user, filters);
  return (where.AND as Record<string, unknown>[]) ?? [];
}

describe('buildOverdueFollowUpsWhere', () => {
  it('always constrains to the overdue definition (open + past due), reusing the Activities bucket', () => {
    const parts = fragments(admin, { todayStart: TODAY_START });
    const overdue = parts.find((part) => 'completedAt' in part) as
      { completedAt: unknown; dueAt: { lt: Date } } | undefined;
    expect(overdue?.completedAt).toBeNull();
    expect(overdue?.dueAt.lt).toEqual(new Date(TODAY_START));
  });

  it('carries the caller role scope so an agent is limited to their own follow-ups', () => {
    const json = JSON.stringify(
      buildOverdueFollowUpsWhere(agent, { todayStart: TODAY_START }),
    );
    expect(json).toContain('"userId":"agent-1"');
    // Still overdue-only for the agent.
    expect(json).toContain('"completedAt":null');
  });

  it('adds the team predicate (assignee team) only when teams are given', () => {
    const withTeam = JSON.stringify(
      buildOverdueFollowUpsWhere(admin, {
        todayStart: TODAY_START,
        team: ['Sales'],
      }),
    );
    expect(withTeam).toContain('"user":{"team":{"in":["Sales"]}}');

    const noTeam = JSON.stringify(
      buildOverdueFollowUpsWhere(admin, { todayStart: TODAY_START }),
    );
    expect(noTeam).not.toContain('"team":{"in"');
  });

  it('threads the agent filter through the assignee join', () => {
    const json = JSON.stringify(
      buildOverdueFollowUpsWhere(admin, {
        todayStart: TODAY_START,
        agent: ['u-1', 'u-2'],
      }),
    );
    expect(json).toContain('"userId":{"in":["u-1","u-2"]}');
  });

  it('maps the period to a half-open createdAt window (no status-history field exists)', () => {
    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-08-01T00:00:00.000Z';
    const parts = fragments(admin, { todayStart: TODAY_START, from, to });
    const created = parts.find((part) => 'createdAt' in part) as
      { createdAt: { gte?: Date; lt?: Date } } | undefined;
    expect(created?.createdAt.gte).toEqual(new Date(from));
    expect(created?.createdAt.lt).toEqual(new Date(to));

    // No period → no createdAt fragment.
    const noPeriod = fragments(admin, { todayStart: TODAY_START });
    expect(noPeriod.find((part) => 'createdAt' in part)).toBeUndefined();
  });
});
