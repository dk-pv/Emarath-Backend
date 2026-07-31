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

  it('returns a scope for every role the enum defines', () => {
    // A role added without a branch here would fall through and return
    // undefined, which Prisma reads as "no filter" — an unscoped table.
    for (const role of Object.values(UserRole)) {
      expect(leadScopeWhere(user(role))).toBeDefined();
    }
  });
});
