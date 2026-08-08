import { UserRole } from '../generated/prisma/client';
import type { CurrentUser } from '../auth/current-user';
import { documentScopeWhere } from './document-scope';

const user = (role: UserRole, id = 'user-1'): CurrentUser => ({ id, role });

describe('documentScopeWhere', () => {
  it('lets SUPERADMIN see the whole (non-deleted) repository', () => {
    expect(documentScopeWhere(user(UserRole.SUPERADMIN))).toEqual({
      deletedAt: null,
    });
  });

  it.each([
    UserRole.SALES_AGENT,
    UserRole.SALES_MANAGER,
    UserRole.CUSTOMER_SERVICE_AGENT,
    UserRole.MARKETING_ANALYST,
  ])('restricts %s to documents they own or were granted', (role) => {
    expect(documentScopeWhere(user(role, 'me'))).toEqual({
      deletedAt: null,
      OR: [{ uploaderId: 'me' }, { access: { some: { userId: 'me' } } }],
    });
  });

  it('always excludes soft-deleted documents', () => {
    for (const role of Object.values(UserRole)) {
      expect(documentScopeWhere(user(role))).toMatchObject({ deletedAt: null });
    }
  });
});
