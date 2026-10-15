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

  it.each([
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.ACCOUNTS_EXECUTIVE,
    UserRole.QC,
  ])('gives %s no import job (ADR-0084)', (role) => {
    expect(importJobScopeWhere({ id: 'u1', role })).toEqual({
      deletedAt: null,
      id: { in: [] },
    });
  });

  // ADR-0093: a job into a pipeline closed to the caller is out of scope — its error report
  // carries the rejected rows' customer data.
  describe('pipelines closed to the caller', () => {
    const deniedPipelines = ['VIP'];

    it('adds nothing for any role while no pipeline is closed (All users)', () => {
      for (const role of Object.values(UserRole)) {
        expect(
          importJobScopeWhere({
            id: 'u1',
            role,
            team: 'Sales',
            deniedPipelines: [],
          }),
        ).toEqual(importJobScopeWhere({ id: 'u1', role, team: 'Sales' }));
      }
    });

    it('hides a manager’s team imports into a closed pipeline', () => {
      expect(
        importJobScopeWhere({
          id: 'mgr-1',
          role: UserRole.SALES_MANAGER,
          team: 'Sales',
          deniedPipelines,
        }),
      ).toEqual({
        deletedAt: null,
        pipeline: { notIn: ['VIP'] },
        createdBy: { team: 'Sales' },
      });
    });

    it.each([UserRole.CUSTOMER_SERVICE_AGENT, UserRole.MARKETING_ANALYST])(
      'hides imports into a closed pipeline from %s',
      (role) => {
        expect(
          importJobScopeWhere({ id: 'u1', role, deniedPipelines }),
        ).toEqual({ deletedAt: null, pipeline: { notIn: ['VIP'] } });
      },
    );

    it('keeps an agent’s own imports and never narrows the admin', () => {
      expect(
        importJobScopeWhere({
          id: 'u1',
          role: UserRole.SALES_AGENT,
          deniedPipelines,
        }),
      ).toEqual({ deletedAt: null, createdById: 'u1' });
      expect(
        importJobScopeWhere({
          id: 'u1',
          role: UserRole.SUPERADMIN,
          deniedPipelines,
        }),
      ).toEqual({ deletedAt: null });
    });
  });

  it('returns a scope for every role the enum defines', () => {
    for (const role of Object.values(UserRole)) {
      expect(importJobScopeWhere({ id: 'u1', role })).toBeDefined();
    }
  });
});
