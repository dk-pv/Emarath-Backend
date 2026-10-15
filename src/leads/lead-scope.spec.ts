import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { leadScopeWhere } from './lead-scope';

const user = (role: UserRole): CurrentUser => ({ id: 'user-1', role });

describe('leadScopeWhere', () => {
  it('hides soft-deleted leads from every role', () => {
    for (const role of Object.values(UserRole)) {
      expect(leadScopeWhere(user(role))).toMatchObject({ deletedAt: null });
    }
  });

  it('restricts a sales agent to leads assigned to them', () => {
    expect(leadScopeWhere(user(UserRole.SALES_AGENT))).toEqual({
      deletedAt: null,
      assignments: { some: { userId: 'user-1' } },
    });
  });

  it('scopes a sales agent by their own id, not a constant', () => {
    const other = leadScopeWhere({ id: 'user-2', role: UserRole.SALES_AGENT });
    expect(other).toEqual({
      deletedAt: null,
      assignments: { some: { userId: 'user-2' } },
    });
  });

  // AUTH-02.1 / ADR-0030: a sales manager sees their team's leads — any lead
  // assigned to a same-team user.
  it('restricts a sales manager to leads assigned to a same-team user', () => {
    expect(
      leadScopeWhere({
        id: 'mgr-1',
        role: UserRole.SALES_MANAGER,
        team: 'Sales',
      }),
    ).toEqual({
      deletedAt: null,
      assignments: { some: { user: { team: 'Sales' } } },
    });
  });

  it('falls a null-team manager back to own-only (fail-safe, ADR-0030 §7)', () => {
    expect(
      leadScopeWhere({
        id: 'mgr-1',
        role: UserRole.SALES_MANAGER,
        team: null,
      }),
    ).toEqual({ deletedAt: null, assignments: { some: { userId: 'mgr-1' } } });
  });

  it('falls a manager on a pre-AUTH-02.1 token (no team claim) back to own-only', () => {
    expect(
      leadScopeWhere({ id: 'mgr-1', role: UserRole.SALES_MANAGER }),
    ).toEqual({ deletedAt: null, assignments: { some: { userId: 'mgr-1' } } });
  });

  it('keeps manager team scope under the Archived quick filter', () => {
    expect(
      leadScopeWhere(
        { id: 'mgr-1', role: UserRole.SALES_MANAGER, team: 'Sales' },
        true,
      ),
    ).toEqual({
      deletedAt: { not: null },
      assignments: { some: { user: { team: 'Sales' } } },
    });
  });

  // Admin, Customer Service and Marketing remain organization-wide (ADR-0030 §2.2).
  it.each([
    UserRole.SUPERADMIN,
    UserRole.CUSTOMER_SERVICE_AGENT,
    UserRole.MARKETING_ANALYST,
  ])('does not restrict %s by assignment', (role) => {
    expect(leadScopeWhere(user(role))).toEqual({ deletedAt: null });
  });

  it('shows only soft-deleted leads for the Archived quick filter (LEAD-04.1)', () => {
    expect(leadScopeWhere(user(UserRole.SUPERADMIN), true)).toEqual({
      deletedAt: { not: null },
    });
  });

  it('keeps role scoping under the Archived quick filter', () => {
    expect(leadScopeWhere(user(UserRole.SALES_AGENT), true)).toEqual({
      deletedAt: { not: null },
      assignments: { some: { userId: 'user-1' } },
    });
  });

  // QC too (2026-10-01): it is the only gate on QC reading a lead's sales journey.
  it.each([
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.ACCOUNTS_EXECUTIVE,
    UserRole.QC,
  ])('gives %s no lead at all, even the archived view (ADR-0084)', (role) => {
    expect(leadScopeWhere(user(role))).toEqual({
      deletedAt: null,
      id: { in: [] },
    });
    expect(leadScopeWhere(user(role), true)).toEqual({
      deletedAt: { not: null },
      id: { in: [] },
    });
  });

  // ADR-0093: pipeline access, read per request into `deniedPipelines`.
  describe('pipelines closed to the caller', () => {
    const closed = ['VIP', 'Complaints'];

    it('adds nothing for any role while no pipeline is closed (All users)', () => {
      for (const role of Object.values(UserRole)) {
        expect(
          leadScopeWhere({ ...user(role), team: 'Sales', deniedPipelines: [] }),
        ).toEqual(leadScopeWhere({ ...user(role), team: 'Sales' }));
      }
    });

    it('keeps a manager to their team’s leads in the pipelines open to them (B3, B8)', () => {
      expect(
        leadScopeWhere({
          id: 'mgr-1',
          role: UserRole.SALES_MANAGER,
          team: 'Sales',
          deniedPipelines: closed,
        }),
      ).toEqual({
        deletedAt: null,
        pipeline: { notIn: ['VIP', 'Complaints'] },
        assignments: { some: { user: { team: 'Sales' } } },
      });
    });

    it('closes the pipelines to a teamless manager’s own leads too (no exception, B2)', () => {
      expect(
        leadScopeWhere(
          {
            id: 'mgr-1',
            role: UserRole.SALES_MANAGER,
            team: null,
            deniedPipelines: closed,
          },
          true,
        ),
      ).toEqual({
        deletedAt: { not: null },
        pipeline: { notIn: ['VIP', 'Complaints'] },
        assignments: { some: { userId: 'mgr-1' } },
      });
    });

    it.each([UserRole.CUSTOMER_SERVICE_AGENT, UserRole.MARKETING_ANALYST])(
      'keeps %s org-wide except the pipelines closed to them (B4)',
      (role) => {
        expect(
          leadScopeWhere({ ...user(role), deniedPipelines: closed }),
        ).toEqual({
          deletedAt: null,
          pipeline: { notIn: ['VIP', 'Complaints'] },
        });
      },
    );

    it('leaves a sales agent every lead assigned to them, in any pipeline (B2)', () => {
      expect(
        leadScopeWhere({
          ...user(UserRole.SALES_AGENT),
          deniedPipelines: closed,
        }),
      ).toEqual({
        deletedAt: null,
        assignments: { some: { userId: 'user-1' } },
      });
    });

    it('never narrows the admin, even if handed a closed list (B1)', () => {
      expect(
        leadScopeWhere({
          ...user(UserRole.SUPERADMIN),
          deniedPipelines: closed,
        }),
      ).toEqual({ deletedAt: null });
    });
  });

  it('returns a scope for every role the enum defines', () => {
    // A role added without a branch here would fall through and return
    // undefined, which Prisma reads as "no filter" — an unscoped table.
    for (const role of Object.values(UserRole)) {
      expect(leadScopeWhere(user(role))).toBeDefined();
    }
  });
});
