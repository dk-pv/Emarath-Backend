import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import {
  assertMayChangeLead,
  assertMayMoveLead,
  assertPipelineOpen,
  deniedPipelines,
  openPipelinesWhere,
  withPipelineAccess,
} from './pipeline-access';

function client(names: string[] = []) {
  const findMany = jest.fn().mockResolvedValue(names.map((name) => ({ name })));
  return {
    findMany,
    client: { pipeline: { findMany } } as unknown as Pick<
      Prisma.TransactionClient,
      'pipeline'
    >,
  };
}

describe('pipeline access (ADR-0093)', () => {
  describe('deniedPipelines', () => {
    it('closes every Specific pipeline holding no USER grant for them and no ROLE grant for their live org role', async () => {
      const { client: prisma, findMany } = client(['VIP']);

      await expect(deniedPipelines(prisma, 'u1')).resolves.toEqual(['VIP']);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          accessMode: 'SPECIFIC',
          permissions: {
            none: {
              OR: [
                { permissionType: 'USER', userId: 'u1' },
                {
                  permissionType: 'ROLE',
                  role: { deletedAt: null, users: { some: { id: 'u1' } } },
                },
              ],
            },
          },
        },
        select: { name: true },
      });
    });
  });

  describe('withPipelineAccess', () => {
    it.each([
      UserRole.SALES_MANAGER,
      UserRole.SALES_AGENT,
      UserRole.CUSTOMER_SERVICE_AGENT,
      UserRole.MARKETING_ANALYST,
    ])('attaches the closed pipelines to %s', async (role) => {
      const { client: prisma } = client(['VIP']);
      const user = { id: 'u1', role, team: 'Sales' };

      await expect(withPipelineAccess(prisma, user)).resolves.toEqual({
        ...user,
        deniedPipelines: ['VIP'],
      });
    });

    it.each([
      UserRole.SUPERADMIN,
      UserRole.LOGISTICS_MANAGER,
      UserRole.LOGISTICS_EXECUTIVE,
      UserRole.ACCOUNTS_EXECUTIVE,
      UserRole.QC,
    ])('leaves %s as it is, without a query', async (role) => {
      const { client: prisma, findMany } = client(['VIP']);
      const user = { id: 'u1', role };

      await expect(withPipelineAccess(prisma, user)).resolves.toBe(user);
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('openPipelinesWhere', () => {
    it('adds no condition when nothing is closed', () => {
      expect(
        openPipelinesWhere({ id: 'u1', role: UserRole.SALES_MANAGER }),
      ).toEqual({});
      expect(
        openPipelinesWhere({
          id: 'u1',
          role: UserRole.SALES_MANAGER,
          deniedPipelines: [],
        }),
      ).toEqual({});
    });

    it('adds nothing for the admin, even when handed a closed list (B1)', () => {
      expect(
        openPipelinesWhere({
          id: 'u1',
          role: UserRole.SUPERADMIN,
          deniedPipelines: ['VIP'],
        }),
      ).toEqual({});
    });

    it('excludes the closed pipelines by name', () => {
      expect(
        openPipelinesWhere({
          id: 'u1',
          role: UserRole.MARKETING_ANALYST,
          deniedPipelines: ['VIP', 'QC'],
        }),
      ).toEqual({ pipeline: { notIn: ['VIP', 'QC'] } });
    });
  });

  describe('write checks', () => {
    const agent = {
      id: 'u1',
      role: UserRole.SALES_AGENT,
      deniedPipelines: ['VIP'],
    };

    it('assertPipelineOpen refuses a closed pipeline with a 403 naming it, and passes an open one', () => {
      expect(() => assertPipelineOpen(agent, 'VIP')).toThrow(
        new ForbiddenException(`You don't have access to the "VIP" pipeline.`),
      );
      expect(() => assertPipelineOpen(agent, 'Lead Pipeline')).not.toThrow();
      expect(() =>
        assertPipelineOpen({ id: 'u1', role: UserRole.SALES_AGENT }, 'VIP'),
      ).not.toThrow();
    });

    it('assertMayChangeLead refuses a lead the caller may only see (B2)', () => {
      expect(() => assertMayChangeLead(agent, { pipeline: 'VIP' })).toThrow(
        'This lead is in the "VIP" pipeline, which you don\'t have access to. You can view it, but not change it.',
      );
      expect(() =>
        assertMayChangeLead(agent, { pipeline: 'Lead Pipeline' }),
      ).not.toThrow();
    });

    it('never refuses the admin (B1)', () => {
      const admin = { ...agent, role: UserRole.SUPERADMIN };
      expect(() => assertPipelineOpen(admin, 'VIP')).not.toThrow();
      expect(() =>
        assertMayChangeLead(admin, { pipeline: 'VIP' }),
      ).not.toThrow();
      expect(() => assertMayMoveLead(admin, 'VIP')).not.toThrow();
    });

    it.each([
      UserRole.SALES_AGENT,
      UserRole.CUSTOMER_SERVICE_AGENT,
      UserRole.MARKETING_ANALYST,
    ])('assertMayMoveLead refuses %s, whatever the target (B5)', (role) => {
      expect(() =>
        assertMayMoveLead({ id: 'u1', role }, 'Lead Pipeline'),
      ).toThrow(
        'Only a manager or an administrator can move a lead to another pipeline.',
      );
    });

    it('assertMayMoveLead lets a manager move only into a pipeline open to them', () => {
      const manager = {
        id: 'm1',
        role: UserRole.SALES_MANAGER,
        deniedPipelines: ['VIP'],
      };
      expect(() => assertMayMoveLead(manager, 'Complaints')).not.toThrow();
      expect(() => assertMayMoveLead(manager, 'VIP')).toThrow(
        `You don't have access to the "VIP" pipeline.`,
      );
    });
  });
});
