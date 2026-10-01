import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsRepository } from './leads.repository';

function updateData(
  customFieldValues?: { customFieldId: string; value: string }[],
): Promise<Record<string, unknown>> {
  const update = jest.fn().mockResolvedValue({ id: 'lead-1' });
  const tx = { lead: { update } } as unknown as Prisma.TransactionClient;
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
});
