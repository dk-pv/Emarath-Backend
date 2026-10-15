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

  it('keeps an agent in their own leads when a time-precise Filter and the other filters are applied', () => {
    // 10:00 AM → 3:00 PM on 13 Oct, UAE time, as the Filter builder sends it.
    const from = '2026-10-13T06:00:00.000Z';
    const to = '2026-10-13T11:01:00.000Z';
    const conditions = JSON.stringify([
      { field: 'createdAt', operator: 'between', values: [from, to] },
    ]);

    const where = buildLeadWhere(agent, {
      conditions,
      status: ['New'],
      createdFrom: '2026-10-01T00:00:00.000Z',
    });

    const parts = where.AND as Record<string, unknown>[];
    // Scope stays first and untouched; the window is one more AND, never a replacement.
    expect(parts[0]).toEqual({
      deletedAt: null,
      assignments: { some: { userId: 'agent-1' } },
    });
    expect(parts).toContainEqual({
      createdAt: { gte: new Date(from), lt: new Date(to) },
    });
    // The unrelated filters are still applied alongside it.
    expect(parts).toContainEqual({ status: { in: ['New'] } });
    expect(parts).toContainEqual({
      createdAt: { gte: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('applies the same time-precise window to an administrator without any agent scope', () => {
    const from = '2026-10-13T06:00:00.000Z';
    const to = '2026-10-13T11:01:00.000Z';
    expect(
      buildLeadWhere(admin, {
        conditions: JSON.stringify([
          { field: 'createdAt', operator: 'between', values: [from, to] },
        ]),
      }),
    ).toEqual({
      AND: [
        { deletedAt: null },
        { createdAt: { gte: new Date(from), lt: new Date(to) } },
      ],
    });
  });
});
