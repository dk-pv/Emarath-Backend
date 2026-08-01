import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadWhere } from './lead-where';

const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };
const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };

describe('buildLeadWhere', () => {
  it('returns the bare scope when no search or filter is present', () => {
    expect(buildLeadWhere(admin, {})).toEqual({ deletedAt: null });
  });

  it('ANDs scope with search and each filter, never widening scope', () => {
    const where = buildLeadWhere(agent, {
      search: 'aisha',
      status: ['New'],
    });

    expect(where.AND).toBeDefined();
    const conditions = where.AND as Record<string, unknown>[];
    // The agent's own-leads scope is always the first fragment.
    expect(conditions[0]).toEqual({
      deletedAt: null,
      assignments: { some: { userId: 'agent-1' } },
    });
    expect(conditions).toContainEqual({ status: { in: ['New'] } });
    expect(conditions.some((c) => 'OR' in c)).toBe(true);
  });

  it('flips the delete predicate for an archived export', () => {
    expect(buildLeadWhere(admin, { archived: true })).toEqual({
      deletedAt: { not: null },
    });
  });

  it('applies an activity preset ANDed with scope, from the client boundaries (LEAD-04.1)', () => {
    const where = buildLeadWhere(agent, {
      overdue: true,
      todayStart: '2026-08-01T00:00:00.000Z',
      todayEnd: '2026-08-02T00:00:00.000Z',
      tomorrowEnd: '2026-08-03T00:00:00.000Z',
    });

    const conditions = where.AND as Record<string, unknown>[];
    // Scope is still first and unchanged — leadScopeWhere, never activityScopeWhere.
    expect(conditions[0]).toEqual({
      deletedAt: null,
      assignments: { some: { userId: 'agent-1' } },
    });
    expect(conditions).toContainEqual({
      activities: {
        some: {
          deletedAt: null,
          completedAt: null,
          dueAt: { lt: new Date('2026-08-01T00:00:00.000Z') },
        },
      },
    });
  });

  it('ignores a window preset when the day boundaries are missing', () => {
    expect(buildLeadWhere(admin, { overdue: true })).toEqual({
      deletedAt: null,
    });
  });
});
