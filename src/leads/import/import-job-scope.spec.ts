import { UserRole } from '../../generated/prisma/client';
import { importJobScopeWhere } from './import-job-scope';

describe('importJobScopeWhere (AUTH-02.1)', () => {
  it('excludes soft-deleted for every role', () => {
    for (const role of Object.values(UserRole)) {
      expect(importJobScopeWhere({ id: 'u1', role })).toMatchObject({
        deletedAt: null,
      });
    }
  });

  it('restricts a sales agent to imports they created', () => {
    expect(
      importJobScopeWhere({ id: 'u1', role: UserRole.SALES_AGENT }),
    ).toEqual({ deletedAt: null, createdById: 'u1' });
  });

  it('restricts a sales manager to imports created by a same-team user', () => {
    expect(
      importJobScopeWhere({
        id: 'mgr-1',
        role: UserRole.SALES_MANAGER,
        team: 'Sales',
      }),
    ).toEqual({ deletedAt: null, createdBy: { team: 'Sales' } });
  });

  it('falls a null-team manager back to own-only (ADR-0030 §7)', () => {
    expect(
      importJobScopeWhere({
        id: 'mgr-1',
        role: UserRole.SALES_MANAGER,
        team: null,
      }),
    ).toEqual({ deletedAt: null, createdById: 'mgr-1' });
  });

  it.each([
    UserRole.SUPERADMIN,
    UserRole.CUSTOMER_SERVICE_AGENT,
    UserRole.MARKETING_ANALYST,
  ])('leaves %s organization-wide', (role) => {
    expect(importJobScopeWhere({ id: 'u1', role })).toEqual({
      deletedAt: null,
    });
  });

  it('returns a scope for every role the enum defines', () => {
    for (const role of Object.values(UserRole)) {
      expect(importJobScopeWhere({ id: 'u1', role })).toBeDefined();
    }
  });
});
