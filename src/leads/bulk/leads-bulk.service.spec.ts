import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadsBulkService } from './leads-bulk.service';
import { bulkResponse } from './dto/bulk-actions.dto';

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const userFindFirst = jest.fn();
  const leadFindMany = jest.fn();
  const leadDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const assignmentDeleteMany = jest.fn();
  const assignmentCreateMany = jest.fn();
  const $transaction = jest.fn().mockResolvedValue([]);

  const prisma = {
    user: { findFirst: userFindFirst },
    lead: { findMany: leadFindMany, deleteMany: leadDeleteMany },
    leadAssignment: {
      deleteMany: assignmentDeleteMany,
      createMany: assignmentCreateMany,
    },
    $transaction,
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;

  const service = new LeadsBulkService(prisma, currentUser);
  return {
    service,
    userFindFirst,
    leadFindMany,
    leadDeleteMany,
    assignmentCreateMany,
    $transaction,
  };
}

describe('bulkResponse', () => {
  it('reports each id and summarises success vs failure', () => {
    const res = bulkResponse(['a', 'b', 'c'], new Set(['a', 'c']));
    expect(res.summary).toEqual({ total: 3, success: 2, failed: 1 });
    expect(res.results).toEqual([
      { id: 'a', status: 'success' },
      { id: 'b', status: 'failed', reason: 'Lead not found or not permitted.' },
      { id: 'c', status: 'success' },
    ]);
  });
});

describe('LeadsBulkService.reassign', () => {
  it('rejects an invalid target agent before touching leads', async () => {
    const { service, userFindFirst, leadFindMany } = makeService();
    userFindFirst.mockResolvedValue(null);

    await expect(
      service.reassign({ ids: ['a'], agentId: 'agent' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(leadFindMany).not.toHaveBeenCalled();
  });

  it('reassigns only in-scope leads and reports the rest as failed', async () => {
    const {
      service,
      userFindFirst,
      leadFindMany,
      assignmentCreateMany,
      $transaction,
    } = makeService();
    userFindFirst.mockResolvedValue({ id: 'agent' });
    leadFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    const res = await service.reassign({
      ids: ['a', 'b', 'c'],
      agentId: 'agent',
    });

    expect(res.summary).toEqual({ total: 3, success: 2, failed: 1 });
    expect($transaction).toHaveBeenCalledTimes(1);
    const created = (assignmentCreateMany.mock.calls as unknown[][])[0][0] as {
      data: { leadId: string; userId: string }[];
    };
    expect(created.data).toEqual([
      { leadId: 'a', userId: 'agent' },
      { leadId: 'b', userId: 'agent' },
    ]);
  });

  it('does nothing when no id is in scope', async () => {
    const { service, userFindFirst, leadFindMany, $transaction } =
      makeService();
    userFindFirst.mockResolvedValue({ id: 'agent' });
    leadFindMany.mockResolvedValue([]);

    const res = await service.reassign({ ids: ['x'], agentId: 'agent' });
    expect(res.summary).toEqual({ total: 1, success: 0, failed: 1 });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('LeadsBulkService.delete', () => {
  it('hard-deletes only in-scope leads and reports the rest as failed', async () => {
    const { service, leadFindMany, leadDeleteMany } = makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }]);

    const res = await service.delete({ ids: ['a', 'b'] });

    expect(res.summary).toEqual({ total: 2, success: 1, failed: 1 });
    const where = (leadDeleteMany.mock.calls as unknown[][])[0][0] as {
      where: { id: { in: string[] } };
    };
    expect(where.where.id.in).toEqual(['a']);
  });

  it('never issues a delete when nothing is in scope', async () => {
    const { service, leadFindMany, leadDeleteMany } = makeService();
    leadFindMany.mockResolvedValue([]);

    const res = await service.delete({ ids: ['x', 'y'] });
    expect(res.summary.success).toBe(0);
    expect(leadDeleteMany).not.toHaveBeenCalled();
  });

  it('de-duplicates repeated ids', async () => {
    const { service, leadFindMany } = makeService();
    leadFindMany.mockResolvedValue([{ id: 'a' }]);

    const res = await service.delete({ ids: ['a', 'a'] });
    expect(res.results).toHaveLength(1);
  });
});
