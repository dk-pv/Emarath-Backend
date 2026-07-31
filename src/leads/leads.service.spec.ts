import { NotFoundException } from '@nestjs/common';
import { CurrentUserService } from '../auth/current-user';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadsRepository } from './leads.repository';
import { LeadsService } from './leads.service';

/** A minimal row shaped for `toLeadListItem`; the create tests only read the arg. */
const FAKE_ROW = {
  id: 'lead-1',
  name: 'X',
  firstName: null,
  primaryPhone: '1',
  secondaryPhone: null,
  language: 'English',
  country: 'UAE',
  source: null,
  status: 'New',
  pipeline: 'Lead Pipeline',
  category: 'Default',
  actualAmount: '10',
  forecastedAmount: null,
  bookingDate: null,
  callStatus: 'Answered',
  callAttempts: 0,
  whatsappAttempts: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  assignments: [],
  tags: [],
};

const BASE_DTO: CreateLeadDto = {
  name: 'Ahmed',
  primaryPhone: '971500000000',
  product: 'MAGIC',
  language: 'English',
  callStatus: 'Answered',
  callAttempts: 0,
  country: 'United Arab Emirates',
  actualAmount: '100.00',
  paymentMethod: 'COD',
};

function makeService(
  role: UserRole = UserRole.SUPERADMIN,
  userId = 'me',
  team: string | null = null,
) {
  const create = jest.fn().mockResolvedValue(FAKE_ROW);
  const findById = jest.fn();
  const repository = { create, findById } as unknown as LeadsRepository;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: userId, role, team }),
  } as unknown as CurrentUserService;
  const service = new LeadsService(repository, currentUser);
  const dataOf = (call = 0): Prisma.LeadCreateInput =>
    (create.mock.calls[call] as [Prisma.LeadCreateInput])[0];
  return { service, create, findById, dataOf };
}

describe('LeadsService.create', () => {
  it('applies Workpex defaults for status, pipeline and category (AC3/AC4)', async () => {
    const { service, dataOf } = makeService();
    await service.create({ ...BASE_DTO });
    const data = dataOf();
    expect(data.status).toBe('New');
    expect(data.pipeline).toBe('Lead Pipeline');
    expect(data.category).toBe('Default');
  });

  it('keeps provided status/pipeline/category over the defaults', async () => {
    const { service, dataOf } = makeService();
    await service.create({
      ...BASE_DTO,
      status: 'HOT',
      pipeline: 'QC',
      category: 'Logistics',
    });
    const data = dataOf();
    expect(data.status).toBe('HOT');
    expect(data.pipeline).toBe('QC');
    expect(data.category).toBe('Logistics');
  });

  it('auto-assigns the creator when a sales agent creates with no assignees', async () => {
    const { service, dataOf } = makeService(UserRole.SALES_AGENT, 'agent-1');
    await service.create({ ...BASE_DTO });
    expect(JSON.stringify(dataOf().assignments)).toContain('agent-1');
  });

  it('does not auto-assign for roles that see every lead', async () => {
    const { service, dataOf } = makeService(UserRole.SUPERADMIN, 'admin');
    await service.create({ ...BASE_DTO });
    expect(dataOf().assignments).toBeUndefined();
  });

  it('creates a complaint from the reason when one is given', async () => {
    const { service, dataOf } = makeService();
    await service.create({ ...BASE_DTO, complaintReason: 'RETURN' });
    expect(JSON.stringify(dataOf().complaints)).toContain('RETURN');
  });

  it('maps msgAttempts to whatsappAttempts, defaulting to 0', async () => {
    const { service, dataOf } = makeService();
    await service.create({ ...BASE_DTO });
    expect(dataOf(0).whatsappAttempts).toBe(0);
    await service.create({ ...BASE_DTO, msgAttempts: 3 });
    expect(dataOf(1).whatsappAttempts).toBe(3);
  });
});

describe('LeadsService.findById', () => {
  it('returns the scoped lead mapped to a list item', async () => {
    const { service, findById } = makeService();
    findById.mockResolvedValue(FAKE_ROW);

    const lead = await service.findById('lead-1');

    expect(lead.id).toBe('lead-1');
    expect(lead.name).toBe('X');
  });

  it('queries within the caller scope AND the id', async () => {
    const { service, findById } = makeService(UserRole.SALES_AGENT, 'agent-1');
    findById.mockResolvedValue(FAKE_ROW);

    await service.findById('lead-1');

    const where = (findById.mock.calls as unknown[][])[0][0] as {
      AND: [{ deletedAt: null }, { id: string }];
    };
    // scope first (excludes soft-deleted), then the id — an out-of-scope or
    // deleted lead simply won't match, so it 404s rather than leaking.
    expect(where.AND[0]).toMatchObject({ deletedAt: null });
    expect(where.AND[1]).toEqual({ id: 'lead-1' });
  });

  it('404s when the lead is out of scope, deleted or missing', async () => {
    const { service, findById } = makeService();
    findById.mockResolvedValue(null);

    await expect(service.findById('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // AUTH-02.1 / ADR-0030: the by-id read composes the manager team scope, so an
  // out-of-team id never matches (AC4) and the detail read narrows like the list (AC5).
  it('composes the manager team predicate into the by-id query', async () => {
    const { service, findById } = makeService(
      UserRole.SALES_MANAGER,
      'mgr-1',
      'Sales',
    );
    findById.mockResolvedValue(FAKE_ROW);

    await service.findById('lead-1');

    const where = (findById.mock.calls as unknown[][])[0][0] as {
      AND: [Record<string, unknown>, { id: string }];
    };
    expect(where.AND[0]).toEqual({
      deletedAt: null,
      assignments: { some: { user: { team: 'Sales' } } },
    });
    expect(where.AND[1]).toEqual({ id: 'lead-1' });
  });

  it('denies a manager an out-of-team lead by id with a 404 (AC4)', async () => {
    const { service, findById } = makeService(
      UserRole.SALES_MANAGER,
      'mgr-1',
      'Sales',
    );
    // The scoped query matches no row for an out-of-team id.
    findById.mockResolvedValue(null);

    await expect(service.findById('other-team-lead')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
