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

  it.each([
    UserRole.SUPERADMIN,
    UserRole.SALES_MANAGER,
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
