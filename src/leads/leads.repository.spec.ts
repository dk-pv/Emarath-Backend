import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsRepository } from './leads.repository';
import { ASSIGNABLE_USER_WHERE } from '../auth/role-groups';

/** The active custom fields the transaction sees; inactive and deleted ones are not read. */
const activeFields = jest
  .fn()
  .mockResolvedValue([{ id: 'cf-1' }, { id: 'cf-2' }]);

function updateData(
  customFieldValues?: { customFieldId: string; value: string }[],
): Promise<Record<string, unknown>> {
  const update = jest.fn().mockResolvedValue({ id: 'lead-1' });
  const tx = {
    lead: { update },
    leadCustomField: { findMany: activeFields },
  } as unknown as Prisma.TransactionClient;
  const repository = new LeadsRepository({} as PrismaService);
  return repository
    .update(
      'lead-1',
      {
        data: { name: 'Ahmed' },
        assigneeIds: [],
        tagIds: [],
        complaintReason: null,
        customFieldValues,
      },
      tx,
    )
    .then(
      () =>
        (update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data,
    );
}

describe('LeadsRepository.update — custom values (LEAD-05.1)', () => {
  it('leaves the custom values untouched when none were sent', async () => {
    expect(await updateData(undefined)).not.toHaveProperty('customFieldValues');
  });

  it('full-replaces them when a set was sent, even an empty one', async () => {
    expect(await updateData([])).toMatchObject({
      customFieldValues: { deleteMany: {}, create: [] },
    });
    expect(
      await updateData([{ customFieldId: 'cf-1', value: 'Gold' }]),
    ).toMatchObject({
      customFieldValues: {
        deleteMany: {},
        create: [{ customField: { connect: { id: 'cf-1' } }, value: 'Gold' }],
      },
    });
  });

  // Regression: `deleteMany: {}` erased the values of inactive fields on every edit, though
  // `prepareValues` refuses them, so the form could never send them back.
  it('replaces only active fields’ values, keeping inactive and deleted ones', async () => {
    for (const values of [[], [{ customFieldId: 'cf-1', value: 'Gold' }]]) {
      activeFields.mockClear();
      const data = (await updateData(values)) as {
        customFieldValues: { deleteMany: unknown };
      };
      expect(activeFields).toHaveBeenCalledWith({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
      });
      expect(data.customFieldValues.deleteMany).toEqual({
        customFieldId: { in: ['cf-1', 'cf-2'] },
      });
    }
  });

  it('reads no field definitions when the edit sent no custom values', async () => {
    activeFields.mockClear();
    await updateData(undefined);
    expect(activeFields).not.toHaveBeenCalled();
  });
});

describe('LeadsRepository.update — assignees and tags', () => {
  async function relationData(assigneeIds: string[], tagIds: string[]) {
    const update = jest.fn().mockResolvedValue({ id: 'lead-1' });
    const tx = { lead: { update } } as unknown as Prisma.TransactionClient;
    await new LeadsRepository({} as PrismaService).update(
      'lead-1',
      { data: {}, assigneeIds, tagIds, complaintReason: null },
      tx,
    );
    return (update.mock.calls[0] as [{ data: Record<string, unknown> }])[0]
      .data;
  }

  // Regression: `deleteMany: {}` + `create` rewrote every assignment on every save, so the
  // Assigned Date of an unchanged assignee became the time of the last edit.
  it('removes only the assignees and tags that were dropped, and adds only new ones', async () => {
    expect(await relationData(['u1', 'u2'], ['t1'])).toMatchObject({
      assignments: {
        deleteMany: { userId: { notIn: ['u1', 'u2'] } },
        createMany: {
          data: [{ userId: 'u1' }, { userId: 'u2' }],
          skipDuplicates: true,
        },
      },
      tags: {
        deleteMany: { tagId: { notIn: ['t1'] } },
        createMany: { data: [{ tagId: 't1' }], skipDuplicates: true },
      },
    });
  });

  it('still clears them all when the edit sends none', async () => {
    expect(await relationData([], [])).toMatchObject({
      assignments: {
        deleteMany: { userId: { notIn: [] } },
        createMany: { data: [], skipDuplicates: true },
      },
      tags: {
        deleteMany: { tagId: { notIn: [] } },
        createMany: { data: [], skipDuplicates: true },
      },
    });
  });
});

describe('LeadsRepository.assignableUsers', () => {
  // Phase 2A: the Assigned options listed inactive users, whom every save now refuses.
  it('offers only the users a lead may newly be assigned to', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new LeadsRepository({
      user: { findMany },
    } as unknown as PrismaService);

    await repository.assignableUsers();

    expect(findMany).toHaveBeenCalledWith({
      where: ASSIGNABLE_USER_WHERE,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(ASSIGNABLE_USER_WHERE).toMatchObject({
      deletedAt: null,
      isActive: true,
    });
  });
});

describe('LeadsRepository.statusChangesForTimeline', () => {
  it('reads only this lead’s own status moves from the audit log, newest first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new LeadsRepository({
      auditEvent: { findMany },
    } as unknown as PrismaService);

    await repository.statusChangesForTimeline('lead-1');

    const args = findMany.mock.calls[0] as [
      {
        where: unknown;
        orderBy: unknown;
        take: number;
        select: Record<string, unknown>;
      },
    ];
    expect(args[0].where).toEqual({
      leadId: 'lead-1',
      // Not the Logistics order's events, which share the journey but are not the lead's.
      entityType: 'LEAD',
      // A move to WON is filed as CONVERTED; every other move as STATUS_CHANGED.
      action: { in: ['STATUS_CHANGED', 'CONVERTED'] },
    });
    expect(args[0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args[0].take).toBe(200);
    expect(args[0].select).toMatchObject({
      before: true,
      after: true,
      actor: { select: { name: true } },
    });
  });
});
