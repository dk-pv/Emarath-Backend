import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadTagsService } from './leads-tags.service';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const TAG_ID = '22222222-2222-2222-2222-222222222222';

/** A row shaped like LEAD_LIST_SELECT — enough for toLeadListItem to run. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    name: 'Tagged',
    firstName: null,
    primaryPhone: '900',
    secondaryPhone: null,
    language: null,
    country: null,
    source: null,
    status: 'New',
    pipeline: 'Lead Pipeline',
    category: null,
    actualAmount: null,
    forecastedAmount: null,
    bookingDate: null,
    callStatus: null,
    callAttempts: 0,
    whatsappAttempts: 0,
    createdAt: new Date('2026-07-21T00:00:00.000Z'),
    assignments: [],
    tags: [{ tag: { id: TAG_ID, name: 'QC VERIFIED' } }],
    ...overrides,
  };
}

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const leadFindFirst = jest.fn();
  const leadFindUnique = jest.fn();
  const leadTagCreate = jest.fn();
  const leadTagDeleteMany = jest.fn();

  const prisma = {
    lead: { findFirst: leadFindFirst, findUnique: leadFindUnique },
    leadTag: { create: leadTagCreate, deleteMany: leadTagDeleteMany },
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;

  const service = new LeadTagsService(prisma, currentUser);
  return {
    service,
    leadFindFirst,
    leadFindUnique,
    leadTagCreate,
    leadTagDeleteMany,
  };
}

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('x', {
    code,
    clientVersion: 'test',
  });
}

describe('LeadTagsService.add', () => {
  it('applies an existing tag to an in-scope lead and returns the updated row (AC1)', async () => {
    const { service, leadFindFirst, leadTagCreate, leadFindUnique } =
      makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadTagCreate.mockResolvedValue({});
    leadFindUnique.mockResolvedValue(listRow());

    const item = await service.add(LEAD_ID, { tagId: TAG_ID });

    expect(item.tags).toEqual([{ id: TAG_ID, name: 'QC VERIFIED' }]);
    const args = (leadTagCreate.mock.calls as unknown[][])[0][0] as {
      data: unknown;
    };
    expect(args.data).toEqual({
      lead: { connect: { id: LEAD_ID } },
      tag: { connect: { id: TAG_ID } },
    });
  });

  it('404s (and never writes) an out-of-scope lead', async () => {
    const { service, leadFindFirst, leadTagCreate } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(
      service.add(LEAD_ID, { tagId: TAG_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leadTagCreate).not.toHaveBeenCalled();
  });

  it('409s when the tag is already on the lead (AC5 duplicate prevented)', async () => {
    const { service, leadFindFirst, leadTagCreate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadTagCreate.mockRejectedValue(knownError('P2002'));

    await expect(
      service.add(LEAD_ID, { tagId: TAG_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('400s when the tag id does not exist', async () => {
    const { service, leadFindFirst, leadTagCreate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadTagCreate.mockRejectedValue(knownError('P2025'));

    await expect(
      service.add(LEAD_ID, { tagId: TAG_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LeadTagsService.remove', () => {
  it('removes a tag from an in-scope lead and returns the updated row (AC2)', async () => {
    const { service, leadFindFirst, leadTagDeleteMany, leadFindUnique } =
      makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadTagDeleteMany.mockResolvedValue({ count: 1 });
    leadFindUnique.mockResolvedValue(listRow({ tags: [] }));

    const item = await service.remove(LEAD_ID, TAG_ID);

    expect(item.tags).toEqual([]);
    expect(leadTagDeleteMany).toHaveBeenCalledWith({
      where: { leadId: LEAD_ID, tagId: TAG_ID },
    });
  });

  it('is idempotent — removing an absent tag is a no-op, not an error', async () => {
    const { service, leadFindFirst, leadTagDeleteMany, leadFindUnique } =
      makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadTagDeleteMany.mockResolvedValue({ count: 0 });
    leadFindUnique.mockResolvedValue(listRow({ tags: [] }));

    await expect(service.remove(LEAD_ID, TAG_ID)).resolves.toBeDefined();
  });

  it('404s (and never deletes) an out-of-scope lead', async () => {
    const { service, leadFindFirst, leadTagDeleteMany } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(service.remove(LEAD_ID, TAG_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(leadTagDeleteMany).not.toHaveBeenCalled();
  });
});
