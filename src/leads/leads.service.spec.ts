import { NotFoundException, ConflictException } from '@nestjs/common';
import { CurrentUserService } from '../auth/current-user';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { LeadCustomFieldsService } from '../lead-custom-fields/lead-custom-fields.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SALES_CRM_DUPLICATE_DEFAULTS } from '../settings/dto/sales-crm-duplicate.dto';
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
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  assignments: [],
  tags: [],
  product: null,
  productQty: null,
  product2: null,
  product2Qty: null,
  paymentMethod: null,
  nationalCode: null,
  complaints: [],
  customFieldValues: [],
  _count: { activities: 0, calls: 0 },
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

/** A row shaped for `toLeadEditData` — the wider edit projection. */
const FAKE_EDIT_ROW = {
  ...FAKE_ROW,
  email: 'x@example.com',
  product: 'MAGIC',
  productQty: '2',
  product2: null,
  product2Qty: null,
  paymentMethod: 'COD',
  state: null,
  street: null,
  city: null,
  nationalCode: null,
  assignments: [
    {
      createdAt: new Date('2026-08-19T16:00:00.000Z'),
      user: { id: 'agent-1', name: 'Agent One' },
    },
  ],
  tags: [{ tagId: 'tag-1' }],
  complaints: [{ details: 'RETURN' }],
};

type UpdateArgs = {
  data: Prisma.LeadUpdateInput;
  assigneeIds: string[];
  tagIds: string[];
  complaintReason: string | null;
};

function makeService(
  role: UserRole = UserRole.SUPERADMIN,
  userId = 'me',
  team: string | null = null,
) {
  const create = jest.fn().mockResolvedValue(FAKE_ROW);
  const findById = jest.fn();
  const findEditById = jest.fn();
  const update = jest.fn().mockResolvedValue(FAKE_ROW);
  const pin = jest.fn().mockResolvedValue(undefined);
  const unpin = jest.fn().mockResolvedValue(undefined);
  const assignmentsForTimeline = jest.fn().mockResolvedValue([]);
  const notesForTimeline = jest.fn().mockResolvedValue([]);
  const callsForTimeline = jest.fn().mockResolvedValue([]);
  const activitiesForLead = jest.fn().mockResolvedValue([]);
  const pinnedLeadIds = jest.fn().mockResolvedValue([]);
  const findPage = jest
    .fn()
    .mockResolvedValue({ pinnedRows: [], unpinnedRows: [], total: 0 });
  const duplicatePhones = jest.fn().mockResolvedValue([]);
  const repository = {
    create,
    pinnedLeadIds,
    findPage,
    duplicatePhones,
    findById,
    findEditById,
    update,
    pin,
    unpin,
    assignmentsForTimeline,
    notesForTimeline,
    callsForTimeline,
    activitiesForLead,
  } as unknown as LeadsRepository;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: userId, role, team }),
  } as unknown as CurrentUserService;
  // Custom-field value prep is exercised in its own suite; here it is a no-op so the
  // create/update payload assertions stay focused on the core fields.
  const prepareValues = jest.fn().mockResolvedValue([]);
  const customFields = {
    prepareValues,
  } as unknown as LeadCustomFieldsService;
  // Duplicate handling has its own suite; here no lead ever matches, so the create
  // assertions below stay focused on the payload rather than the duplicate policy.
  const leadFindMany = jest.fn().mockResolvedValue([]);
  const blockedCreate = jest.fn();
  const prisma = {
    lead: { findMany: leadFindMany },
    blockedEnquiry: { create: blockedCreate },
  } as unknown as PrismaService;
  const getSalesCrmDuplicate = jest
    .fn()
    .mockResolvedValue(SALES_CRM_DUPLICATE_DEFAULTS);
  const settings = {
    getSalesCrmDuplicate,
  } as unknown as SettingsService;
  const service = new LeadsService(
    repository,
    currentUser,
    customFields,
    prisma,
    settings,
  );
  const dataOf = (call = 0): Prisma.LeadCreateInput =>
    (create.mock.calls[call] as [Prisma.LeadCreateInput])[0];
  const updateArgsOf = (call = 0): UpdateArgs =>
    (update.mock.calls[call] as [string, UpdateArgs])[1];
  return {
    leadFindMany,
    blockedCreate,
    getSalesCrmDuplicate,
    service,
    create,
    findById,
    findEditById,
    update,
    pin,
    unpin,
    dataOf,
    updateArgsOf,
    assignmentsForTimeline,
    notesForTimeline,
    callsForTimeline,
    activitiesForLead,
    findPage,
    duplicatePhones,
  };
}

describe('LeadsService.list', () => {
  const query = { page: 1, size: 100 } as ListLeadsQueryDto;
  const whereOf = (findPage: jest.Mock): string =>
    JSON.stringify(
      (findPage.mock.calls[0] as [{ where: Prisma.LeadWhereInput }])[0].where,
    );

  it('leaves the scoped where alone without a search scope', async () => {
    const { service, findPage, duplicatePhones } = makeService();
    await service.list(query);
    expect(duplicatePhones).not.toHaveBeenCalled();
    expect(whereOf(findPage)).not.toContain('primaryPhone');
  });

  it('narrows the "Duplicate Lead" scope to phones held by more than one lead', async () => {
    const { service, findPage, duplicatePhones } = makeService();
    duplicatePhones.mockResolvedValue(['971500000000']);
    await service.list({ ...query, searchScope: 'duplicate' });
    expect(duplicatePhones).toHaveBeenCalledTimes(1);
    expect(whereOf(findPage)).toContain(
      '"primaryPhone":{"in":["971500000000"]}',
    );
  });
});

describe('LeadsService.getTimeline', () => {
  it('404s (and never aggregates) an out-of-scope lead', async () => {
    const {
      service,
      findById,
      assignmentsForTimeline,
      notesForTimeline,
      callsForTimeline,
    } = makeService();
    findById.mockResolvedValue(null);

    await expect(service.getTimeline('lead-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(assignmentsForTimeline).not.toHaveBeenCalled();
    expect(notesForTimeline).not.toHaveBeenCalled();
    expect(callsForTimeline).not.toHaveBeenCalled();
  });

  it('merges created + assignments + notes newest-first for an in-scope lead', async () => {
    const {
      service,
      findById,
      assignmentsForTimeline,
      notesForTimeline,
      callsForTimeline,
    } = makeService();
    findById.mockResolvedValue({
      ...FAKE_ROW,
      id: 'lead-1',
      createdAt: new Date('2026-08-19T14:15:00.000Z'),
    });
    assignmentsForTimeline.mockResolvedValue([
      {
        id: 'a1',
        createdAt: new Date('2026-08-19T16:00:00.000Z'),
        user: { name: 'ADEEB C' },
      },
    ]);
    notesForTimeline.mockResolvedValue([
      {
        id: 'n1',
        createdAt: new Date('2026-08-20T11:39:00.000Z'),
        body: 'hello',
        author: { name: 'Ahamed' },
      },
    ]);
    callsForTimeline.mockResolvedValue([
      {
        id: 'c1',
        startedAt: new Date('2026-08-21T10:53:00.000Z'),
        direction: 'OUTBOUND',
        agent: { name: 'ADEEB C' },
      },
    ]);

    const events = await service.getTimeline('lead-1');

    // Newest first: the call (Aug 21), the note (Aug 20), then the assignment and
    // creation (Aug 19).
    expect(events.map((e) => e.type)).toEqual([
      'call',
      'note',
      'assigned',
      'created',
    ]);
    expect(events[0]).toMatchObject({
      type: 'call',
      direction: 'OUTBOUND',
      agentName: 'ADEEB C',
    });
    expect(events[1]).toMatchObject({
      type: 'note',
      authorName: 'Ahamed',
      body: 'hello',
    });
    expect(events[2]).toMatchObject({
      type: 'assigned',
      assigneeName: 'ADEEB C',
    });
    expect(events[3]).toMatchObject({ type: 'created' });
  });
});

describe('LeadsService.getActivities', () => {
  it('404s (and never reads activities) an out-of-scope lead', async () => {
    const { service, findById, activitiesForLead } = makeService();
    findById.mockResolvedValue(null);

    await expect(service.getActivities('lead-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(activitiesForLead).not.toHaveBeenCalled();
  });

  it('maps the lead activities (dates → ISO, assignees flattened)', async () => {
    const { service, findById, activitiesForLead } = makeService();
    findById.mockResolvedValue({ ...FAKE_ROW, id: 'lead-1' });
    activitiesForLead.mockResolvedValue([
      {
        id: 'act-1',
        type: 'MEETING',
        description: 'tfyguijop',
        dueAt: new Date('2026-08-28T00:30:00.000Z'),
        endAt: null,
        completedAt: null,
        createdAt: new Date('2026-08-20T09:47:00.000Z'),
        assignees: [
          {
            createdAt: new Date('2026-08-19T16:00:00.000Z'),
            user: { id: 'u1', name: 'ADEEB C' },
          },
        ],
      },
    ]);

    const activities = await service.getActivities('lead-1');

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      id: 'act-1',
      type: 'MEETING',
      description: 'tfyguijop',
      dueAt: '2026-08-28T00:30:00.000Z',
      completedAt: null,
      assignees: [{ id: 'u1', name: 'ADEEB C' }],
    });
  });
});

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

  // Verified Workpex behaviour: only Name and Primary Phone are truly required (Status/Pipeline
  // default). The rest are optional and must persist as null (callAttempts as 0), never rejected.
  it('creates from the minimal required fields, nulling the optional ones', async () => {
    const { service, dataOf } = makeService();
    await service.create({
      name: 'Ahmed',
      primaryPhone: '971500000000',
    });
    const data = dataOf();
    expect(data.product).toBeNull();
    expect(data.language).toBeNull();
    expect(data.country).toBeNull();
    expect(data.callStatus).toBeNull();
    expect(data.actualAmount).toBeNull();
    expect(data.paymentMethod).toBeNull();
    expect(data.callAttempts).toBe(0);
    expect(data.status).toBe('New');
    expect(data.pipeline).toBe('Lead Pipeline');
    expect(data.category).toBe('Default');
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

describe('LeadsService.getForEdit', () => {
  it('maps the wide edit projection, renaming whatsappAttempts to msgAttempts', async () => {
    const { service, findEditById } = makeService();
    findEditById.mockResolvedValue({ ...FAKE_EDIT_ROW, whatsappAttempts: 4 });

    const data = await service.getForEdit('lead-1');

    expect(data.msgAttempts).toBe(4);
    expect(data.product).toBe('MAGIC');
    expect(data.productQty).toBe('2');
    expect(data.assignedAgents).toEqual([{ id: 'agent-1', name: 'Agent One' }]);
    expect(data.tagIds).toEqual(['tag-1']);
    expect(data.complaintReason).toBe('RETURN');
  });

  it('scopes the read by role AND id', async () => {
    const { service, findEditById } = makeService(
      UserRole.SALES_AGENT,
      'agent-1',
    );
    findEditById.mockResolvedValue(FAKE_EDIT_ROW);

    await service.getForEdit('lead-1');

    const where = (findEditById.mock.calls as unknown[][])[0][0] as {
      AND: [Record<string, unknown>, { id: string }];
    };
    expect(where.AND[0]).toMatchObject({
      assignments: { some: { userId: 'agent-1' } },
    });
    expect(where.AND[1]).toEqual({ id: 'lead-1' });
  });

  it('404s when the lead is out of scope or missing', async () => {
    const { service, findEditById } = makeService();
    findEditById.mockResolvedValue(null);

    await expect(service.getForEdit('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('LeadsService.update', () => {
  it('404s (and never writes) when the lead is out of scope or missing', async () => {
    const { service, findById, update } = makeService();
    findById.mockResolvedValue(null);

    await expect(
      service.update('nope', { ...BASE_DTO }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('maps the payload and full-replaces assignments/tags/complaint', async () => {
    const { service, findById, updateArgsOf } = makeService();
    findById.mockResolvedValue(FAKE_ROW);

    await service.update('lead-1', {
      ...BASE_DTO,
      msgAttempts: 5,
      category: undefined,
      assignedAgentIds: ['u1', 'u2'],
      tagIds: ['t1'],
      complaintReason: 'RETURN',
    });

    const args = updateArgsOf();
    expect(args.data.whatsappAttempts).toBe(5);
    // Edit respects a cleared category (null), rather than re-defaulting to "Default".
    expect(args.data.category).toBeNull();
    expect(args.assigneeIds).toEqual(['u1', 'u2']);
    expect(args.tagIds).toEqual(['t1']);
    expect(args.complaintReason).toBe('RETURN');
  });

  it('keeps a sales agent on their own lead so an edit cannot hide it', async () => {
    const { service, findById, updateArgsOf } = makeService(
      UserRole.SALES_AGENT,
      'agent-1',
    );
    findById.mockResolvedValue(FAKE_ROW);

    await service.update('lead-1', {
      ...BASE_DTO,
      assignedAgentIds: ['other'],
    });

    expect(updateArgsOf().assigneeIds).toContain('agent-1');
  });

  it('reports a bad agent/tag id (foreign key) as a 400, not a 500', async () => {
    const { service, findById, update } = makeService();
    findById.mockResolvedValue(FAKE_ROW);
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.update('lead-1', { ...BASE_DTO, tagIds: ['nope'] }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ADR-0031: per-user pin. Personal (keyed by the server-resolved user), scoped
// like every single-lead op, and idempotent.
describe('LeadsService.setPinned', () => {
  it('pins for the resolved caller and returns the lead pinned', async () => {
    const { service, findById, pin, unpin } = makeService(
      UserRole.SALES_AGENT,
      'agent-1',
    );
    findById.mockResolvedValue(FAKE_ROW);

    const lead = await service.setPinned('lead-1', true);

    expect(pin).toHaveBeenCalledWith('agent-1', 'lead-1');
    expect(unpin).not.toHaveBeenCalled();
    expect(lead.isPinned).toBe(true);
  });

  it('unpins for the resolved caller and returns the lead unpinned', async () => {
    const { service, findById, pin, unpin } = makeService(
      UserRole.SALES_AGENT,
      'agent-1',
    );
    findById.mockResolvedValue(FAKE_ROW);

    const lead = await service.setPinned('lead-1', false);

    expect(unpin).toHaveBeenCalledWith('agent-1', 'lead-1');
    expect(pin).not.toHaveBeenCalled();
    expect(lead.isPinned).toBe(false);
  });

  it('scopes the lookup by role AND id before writing a pin', async () => {
    const { service, findById } = makeService(UserRole.SALES_AGENT, 'agent-1');
    findById.mockResolvedValue(FAKE_ROW);

    await service.setPinned('lead-1', true);

    const where = (findById.mock.calls as unknown[][])[0][0] as {
      AND: [{ assignments: unknown }, { id: string }];
    };
    expect(where.AND[0]).toMatchObject({
      assignments: { some: { userId: 'agent-1' } },
    });
    expect(where.AND[1]).toEqual({ id: 'lead-1' });
  });

  it('404s (and never writes) when the lead is out of scope or missing', async () => {
    const { service, findById, pin, unpin } = makeService();
    findById.mockResolvedValue(null);

    await expect(service.setPinned('nope', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(pin).not.toHaveBeenCalled();
    expect(unpin).not.toHaveBeenCalled();
  });
});

describe('LeadsService.create — duplicate handling', () => {
  const enquiry = {
    name: 'Repeat Caller',
    primaryPhone: '+971500000001',
    email: 'repeat@example.com',
  };
  const match = {
    id: 'lead-1',
    name: 'Original Lead',
    primaryPhone: '+971500000001',
    secondaryPhone: null,
    email: 'repeat@example.com',
    assignments: [{ user: { name: 'Aisha Khan' } }],
  };

  it('saves the lead in Warn mode, even when it duplicates an existing one', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([match]);
    kit.getSalesCrmDuplicate.mockResolvedValue({
      ...SALES_CRM_DUPLICATE_DEFAULTS,
      mode: 'WARN_ALLOW_SAVE',
    });

    await kit.service.create(enquiry);

    // AC: the lead is saved, and nothing is logged as blocked.
    expect(kit.create).toHaveBeenCalledTimes(1);
    expect(kit.blockedCreate).not.toHaveBeenCalled();
  });

  it('refuses the lead in Block mode and creates no row', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([match]);
    kit.getSalesCrmDuplicate.mockResolvedValue({
      ...SALES_CRM_DUPLICATE_DEFAULTS,
      mode: 'BLOCK_HARD_STOP',
    });

    await expect(kit.service.create(enquiry as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // The guarantee that matters: no partial lead.
    expect(kit.create).not.toHaveBeenCalled();
  });

  it('logs the blocked enquiry, naming the lead it duplicated', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([match]);
    kit.getSalesCrmDuplicate.mockResolvedValue({
      ...SALES_CRM_DUPLICATE_DEFAULTS,
      mode: 'BLOCK_HARD_STOP',
    });

    await kit.service.create(enquiry as never).catch(() => undefined);

    const [call] = kit.blockedCreate.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(call.data).toMatchObject({
      name: 'Repeat Caller',
      primaryPhone: '+971500000001',
      matchedLeadId: 'lead-1',
      matchedOn: 'primaryPhone',
    });
  });

  it('omits assignee names entirely while that setting is off', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([match]);
    kit.getSalesCrmDuplicate.mockResolvedValue({
      ...SALES_CRM_DUPLICATE_DEFAULTS,
      mode: 'BLOCK_HARD_STOP',
      displayAssigneeInfo: false,
    });

    const error = await kit.service
      .create(enquiry as never)
      .catch((caught: ConflictException) => caught);
    const body = (error as ConflictException).getResponse() as {
      matches: Record<string, unknown>[];
    };
    // Absent, not empty: the key never reaches the client.
    expect(body.matches[0]).not.toHaveProperty('assignees');
  });

  it('includes assignee names when that setting is on', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([match]);
    kit.getSalesCrmDuplicate.mockResolvedValue({
      ...SALES_CRM_DUPLICATE_DEFAULTS,
      mode: 'BLOCK_HARD_STOP',
      displayAssigneeInfo: true,
    });

    const error = await kit.service
      .create(enquiry as never)
      .catch((caught: ConflictException) => caught);
    const body = (error as ConflictException).getResponse() as {
      matches: { assignees?: string[] }[];
    };
    expect(body.matches[0].assignees).toEqual(['Aisha Khan']);
  });

  it('creates the lead normally when nothing matches, in either mode', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([]);
    kit.getSalesCrmDuplicate.mockResolvedValue({
      ...SALES_CRM_DUPLICATE_DEFAULTS,
      mode: 'BLOCK_HARD_STOP',
    });

    await kit.service.create(enquiry);

    expect(kit.create).toHaveBeenCalledTimes(1);
    expect(kit.blockedCreate).not.toHaveBeenCalled();
  });

  it('asks the database to include archived leads only when that setting is on', async () => {
    const kit = makeService();
    kit.getSalesCrmDuplicate.mockResolvedValue({
      ...SALES_CRM_DUPLICATE_DEFAULTS,
      checkArchivedLeads: true,
    });

    await kit.service.create(enquiry);

    const [call] = kit.leadFindMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(call.where).not.toHaveProperty('deletedAt');
  });
});
