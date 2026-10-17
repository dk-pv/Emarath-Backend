import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CurrentUserService } from '../auth/current-user';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { LeadCustomFieldsService } from '../lead-custom-fields/lead-custom-fields.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LeadAssignmentEngine } from '../assignment-rules/lead-assignment.engine';
import {
  TAG_NOT_PERMITTED,
  TagAccessService,
} from '../tag-access/tag-access.service';
import { SALES_CRM_DUPLICATE_DEFAULTS } from '../settings/dto/sales-crm-duplicate.dto';
import { LeadsRepository } from './leads.repository';
import { LeadsService } from './leads.service';
import { LEAD_EDIT_SELECT, LEAD_LIST_SELECT } from './dto/lead-response.dto';

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

/** A lead assigned to agent-1 — the only kind a sales agent can open. */
const AGENT_OWN_ROW = {
  ...FAKE_ROW,
  assignments: [
    {
      createdAt: new Date('2026-08-19T16:00:00.000Z'),
      user: { id: 'agent-1', name: 'Agent One' },
    },
  ],
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
  customFieldValues?: { customFieldId: string; value: string }[];
};

function makeService(
  role: UserRole = UserRole.SUPERADMIN,
  userId = 'me',
  team: string | null = null,
  // The pipelines closed to the caller (ADR-0093); none unless a test says so.
  deniedPipelines?: string[],
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
  const statusChangesForTimeline = jest.fn().mockResolvedValue([]);
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
    statusChangesForTimeline,
    activitiesForLead,
  } as unknown as LeadsRepository;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue({
      id: userId,
      role,
      team,
      ...(deniedPipelines ? { deniedPipelines } : {}),
    }),
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
  const leadFindFirst = jest.fn().mockResolvedValue(null);
  const leadCount = jest.fn().mockResolvedValue(0);
  const blockedCreate = jest.fn();
  // The audit reads and write, inside the transaction the change runs in (ADR-0083).
  const auditFindMany = jest.fn().mockResolvedValue([]);
  const auditCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  // The re-read of a lead that has just become WON (`withLogisticsOrder`): inside the create's
  // transaction, or on the client once an edit has committed. Nothing found by default.
  const txLeadFindUnique = jest.fn().mockResolvedValue(null);
  const leadFindUnique = jest.fn().mockResolvedValue(null);
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    lead: { findMany: auditFindMany, findUnique: txLeadFindUnique },
    auditEvent: { createMany: auditCreateMany },
    // The conversion hook (ADR-0085): `createManyAndReturn` echoes what it was asked to
    // insert, so a lead that becomes WON gets an order id on its CONVERTED event.
    logisticsOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      createManyAndReturn: jest.fn((args: { data: { leadId: string }[] }) =>
        Promise.resolve(
          args.data.map((row, index) => ({
            id: `order-${index + 1}`,
            leadId: row.leadId,
            orderNumber: 1000 + index,
            status: 'INITIAL',
          })),
        ),
      ),
    },
  };
  const $transaction = jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
    run(tx),
  );
  // A pipeline's first stage, for a lead saved with no status: 'New' on Lead Pipeline.
  const stageFindFirst = jest.fn().mockResolvedValue({ name: 'New' });
  // The assignee check counts the added assignees that are live and assignable: all of them
  // unless a test says otherwise.
  const userCount = jest.fn((args: { where: { id: { in: string[] } } }) =>
    Promise.resolve(args.where.id.in.length),
  );
  // The pipeline/stage check: every pipeline and stage exists unless a test says otherwise.
  const pipelineFindUnique = jest.fn().mockResolvedValue({ id: 'pipeline-1' });
  const stageFindUnique = jest.fn().mockResolvedValue({ id: 'stage-1' });
  const prisma = {
    lead: {
      findMany: leadFindMany,
      findFirst: leadFindFirst,
      findUnique: leadFindUnique,
      count: leadCount,
    },
    pipeline: { findUnique: pipelineFindUnique },
    stage: { findFirst: stageFindFirst, findUnique: stageFindUnique },
    user: { count: userCount },
    blockedEnquiry: { create: blockedCreate },
    $transaction,
  } as unknown as PrismaService;
  const getSalesCrmDuplicate = jest
    .fn()
    .mockResolvedValue(SALES_CRM_DUPLICATE_DEFAULTS);
  const settings = {
    getSalesCrmDuplicate,
  } as unknown as SettingsService;
  /*
    The assignment engine is stubbed to "nothing applies", which is what it returns for a
    tenant with no active rule — so these cases keep asserting the assignment behaviour
    the form itself produces. Automatic assignment has its own suite.
  */
  const pickAssignee = jest.fn().mockResolvedValue(null);
  const assignment = { pickAssignee } as unknown as LeadAssignmentEngine;
  // Tag Permissions (ADR-0091) have their own suite; here every tag is allowed unless a test
  // makes the policy refuse.
  const assertMayHandle = jest.fn().mockResolvedValue(undefined);
  const tagAccess = { assertMayHandle } as unknown as TagAccessService;
  const service = new LeadsService(
    repository,
    currentUser,
    customFields,
    prisma,
    settings,
    assignment,
    tagAccess,
  );
  const dataOf = (call = 0): Prisma.LeadCreateInput =>
    (create.mock.calls[call] as [Prisma.LeadCreateInput])[0];
  const updateArgsOf = (call = 0): UpdateArgs =>
    (update.mock.calls[call] as [string, UpdateArgs])[1];
  return {
    leadFindMany,
    leadFindFirst,
    leadCount,
    assertMayHandle,
    stageFindFirst,
    pipelineFindUnique,
    stageFindUnique,
    txLeadFindUnique,
    leadFindUnique,
    userCount,
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
    statusChangesForTimeline,
    activitiesForLead,
    findPage,
    duplicatePhones,
    pickAssignee,
    prepareValues,
    tx,
    auditFindMany,
    auditCreateMany,
  };
}

/** A row shaped like the audit select (ADR-0083) — only what the log compares. */
function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    status: 'New',
    lostReason: null,
    pipeline: 'Lead Pipeline',
    city: null,
    deletedAt: null,
    assignments: [],
    tags: [],
    customFieldValues: [],
    complaints: [],
    ...overrides,
  };
}

/** The audit rows written by the one createMany call a change makes. */
function recorded(auditCreateMany: jest.Mock): Record<string, unknown>[] {
  return (
    auditCreateMany.mock.calls[0] as [{ data: Record<string, unknown>[] }]
  )[0].data;
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
      statusChangesForTimeline,
    } = makeService();
    findById.mockResolvedValue(null);

    await expect(service.getTimeline('lead-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(statusChangesForTimeline).not.toHaveBeenCalled();
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

  describe('status moves from the audit log', () => {
    const inScope = (
      findById: jest.Mock,
      createdAt = '2026-10-01T05:00:00.000Z',
    ) =>
      findById.mockResolvedValue({
        ...FAKE_ROW,
        id: 'lead-1',
        createdAt: new Date(createdAt),
      });

    it('shows Cold → WON with who made it and when, in time order among the other entries', async () => {
      const { service, findById, notesForTimeline, statusChangesForTimeline } =
        makeService();
      inScope(findById);
      notesForTimeline.mockResolvedValue([
        {
          id: 'n1',
          createdAt: new Date('2026-10-13T09:00:00.000Z'),
          body: 'called back',
          author: { name: 'Ahamed' },
        },
      ]);
      // The log files a move to WON as CONVERTED (it also creates the Logistics order).
      statusChangesForTimeline.mockResolvedValue([
        {
          id: 'e2',
          createdAt: new Date('2026-10-13T10:30:00.000Z'),
          before: { status: 'Cold' },
          after: { status: 'WON' },
          actor: { name: 'Sales Manager' },
        },
      ]);

      const events = await service.getTimeline('lead-1');

      expect(statusChangesForTimeline).toHaveBeenCalledWith('lead-1');
      expect(events.map((e) => e.type)).toEqual(['status', 'note', 'created']);
      expect(events[0]).toEqual({
        id: 'status:e2',
        type: 'status',
        at: '2026-10-13T10:30:00.000Z',
        from: 'Cold',
        to: 'WON',
        actorName: 'Sales Manager',
      });
    });

    it('lists successive moves newest first, each with its own transition', async () => {
      const { service, findById, statusChangesForTimeline } = makeService();
      inScope(findById);
      statusChangesForTimeline.mockResolvedValue([
        {
          id: 'e2',
          createdAt: new Date('2026-10-12T08:00:00.000Z'),
          before: { status: 'Warm' },
          after: { status: 'Cold' },
          actor: { name: 'Agent One' },
        },
        {
          id: 'e1',
          createdAt: new Date('2026-10-11T08:00:00.000Z'),
          before: { status: 'New' },
          after: { status: 'Warm' },
          actor: { name: 'Agent One' },
        },
      ]);

      const events = await service.getTimeline('lead-1');

      expect(
        events
          .filter((e) => e.type === 'status')
          .map((e) => (e.type === 'status' ? `${e.from}>${e.to}` : '')),
      ).toEqual(['Warm>Cold', 'New>Warm']);
    });

    it('names no actor for an automation or an unknown user rather than inventing one', async () => {
      const { service, findById, statusChangesForTimeline } = makeService();
      inScope(findById);
      statusChangesForTimeline.mockResolvedValue([
        {
          id: 'e1',
          createdAt: new Date('2026-10-12T08:00:00.000Z'),
          before: { status: 'New' },
          after: { status: 'HOT' },
          actor: null,
        },
      ]);

      const [first] = await service.getTimeline('lead-1');

      expect(first).toMatchObject({ type: 'status', actorName: null });
    });

    it('does not turn things that are not moves into status entries', async () => {
      const { service, findById, statusChangesForTimeline } = makeService();
      inScope(findById);
      statusChangesForTimeline.mockResolvedValue([
        // A lost-reason edit is filed under a status event, but the status did not move.
        {
          id: 'e1',
          createdAt: new Date('2026-10-12T08:00:00.000Z'),
          before: { status: 'LOST', lostReason: 'Price' },
          after: { status: 'LOST', lostReason: 'Competitor' },
          actor: { name: 'Agent One' },
        },
        // A lead created straight into WON has no previous status.
        {
          id: 'e2',
          createdAt: new Date('2026-10-12T09:00:00.000Z'),
          before: null,
          after: { status: 'WON' },
          actor: { name: 'Agent One' },
        },
        // Damaged or unrelated JSON never breaks the feed.
        {
          id: 'e3',
          createdAt: new Date('2026-10-12T10:00:00.000Z'),
          before: 'x',
          after: { status: 7 },
          actor: null,
        },
      ]);

      const events = await service.getTimeline('lead-1');

      expect(events.map((e) => e.type)).toEqual(['created']);
    });
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

  it("lands a status-less lead on its own pipeline's first stage", async () => {
    const { service, dataOf, stageFindFirst } = makeService();
    stageFindFirst.mockResolvedValue({ name: 'Intake' });
    await service.create({ ...BASE_DTO, pipeline: 'Complaints' });
    expect(stageFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pipeline: 'Complaints' } }),
    );
    expect(dataOf().status).toBe('Intake');
    expect(dataOf().pipeline).toBe('Complaints');
  });

  // Was "falls back to 'New'": that saved a lead in no column of any board. Import and
  // Change Pipeline already refused a pipeline with no stages; create now agrees.
  it('refuses a pipeline that has no stages yet, creating nothing', async () => {
    const { service, create, stageFindFirst } = makeService();
    stageFindFirst.mockResolvedValue(null);
    await expect(
      service.create({ ...BASE_DTO, pipeline: 'Empty' }),
    ).rejects.toThrow('The "Empty" pipeline has no stages yet.');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a pipeline that does not exist, creating nothing', async () => {
    const { service, create, pipelineFindUnique } = makeService();
    pipelineFindUnique.mockResolvedValue(null);
    await expect(
      service.create({ ...BASE_DTO, pipeline: 'Nope', status: 'HOT' }),
    ).rejects.toThrow('Pipeline "Nope" does not exist.');
    expect(pipelineFindUnique).toHaveBeenCalledWith({
      where: { name: 'Nope' },
      select: { id: true },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a status that is not one of the pipeline's stages", async () => {
    const { service, create, stageFindUnique } = makeService();
    stageFindUnique.mockResolvedValue(null);
    await expect(
      service.create({
        ...BASE_DTO,
        pipeline: 'Lead Pipeline',
        status: 'Bogus',
      }),
    ).rejects.toThrow(
      '"Bogus" is not a stage of the "Lead Pipeline" pipeline.',
    );
    expect(stageFindUnique).toHaveBeenCalledWith({
      where: { pipeline_name: { pipeline: 'Lead Pipeline', name: 'Bogus' } },
      select: { id: true },
    });
    expect(create).not.toHaveBeenCalled();
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
  // Regression: a lead created as WON answered with `logisticsOrder: null` — the row was read
  // before `recordLeadsCreated` made its order in the same transaction.
  it('returns a lead created as WON with the order its create made', async () => {
    const { service, create, txLeadFindUnique } = makeService();
    create.mockResolvedValue({
      ...FAKE_ROW,
      status: 'WON',
      logisticsOrder: null,
    });
    txLeadFindUnique.mockResolvedValue({
      ...FAKE_ROW,
      status: 'WON',
      logisticsOrder: { orderNumber: 1000, status: 'INITIAL' },
    });

    const lead = await service.create({ ...BASE_DTO, status: 'WON' });

    expect(txLeadFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-1' } }),
    );
    expect(lead.logisticsOrder).toEqual({
      orderNumber: 1000,
      status: 'INITIAL',
    });
  });

  it('does not re-read a lead created in an ordinary status', async () => {
    const { service, txLeadFindUnique } = makeService();
    await service.create({ ...BASE_DTO });
    expect(txLeadFindUnique).not.toHaveBeenCalled();
  });

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

  it('carries the lead’s Logistics order number and status, or null without one', async () => {
    const { service, findById } = makeService();
    findById.mockResolvedValue({
      ...FAKE_ROW,
      status: 'WON',
      logisticsOrder: { orderNumber: 42, status: 'QC_VERIFIED' },
    });
    expect((await service.findById('lead-1')).logisticsOrder).toEqual({
      orderNumber: 42,
      status: 'QC_VERIFIED',
    });

    // A legacy WON lead converted before ADR-0085 has no order, and none is invented.
    findById.mockResolvedValue({
      ...FAKE_ROW,
      status: 'WON',
      logisticsOrder: null,
    });
    expect((await service.findById('lead-1')).logisticsOrder).toBeNull();
  });

  it('reads only the order’s id, number, status and delivery date into the lead', () => {
    expect(LEAD_LIST_SELECT.logisticsOrder).toEqual({
      select: { id: true, orderNumber: true, status: true, deliveryDate: true },
    });
    expect(LEAD_EDIT_SELECT.logisticsOrder).toEqual({
      select: { id: true, orderNumber: true, status: true, deliveryDate: true },
    });
  });

  // Phase 2D: the lead screens show the order's delivery date, as the day it is (ADR-0094).
  it('carries the order’s delivery date as YYYY-MM-DD, or null when it has none', async () => {
    const { service, findById } = makeService();
    findById.mockResolvedValue({
      ...FAKE_ROW,
      status: 'WON',
      logisticsOrder: {
        id: 'order-42',
        orderNumber: 42,
        status: 'INITIAL',
        deliveryDate: new Date('2026-10-20T00:00:00.000Z'),
      },
    });
    expect((await service.findById('lead-1')).logisticsOrder).toEqual({
      id: 'order-42',
      orderNumber: 42,
      status: 'INITIAL',
      deliveryDate: '2026-10-20',
    });

    findById.mockResolvedValue({
      ...FAKE_ROW,
      status: 'WON',
      logisticsOrder: {
        id: 'order-42',
        orderNumber: 42,
        status: 'INITIAL',
        deliveryDate: null,
      },
    });
    expect(
      (await service.findById('lead-1')).logisticsOrder?.deliveryDate,
    ).toBeNull();
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
    expect(data.logisticsOrder).toBeNull();
  });

  it('tells the form the lead has a Logistics order, so it can lock Status and Pipeline', async () => {
    const { service, findEditById } = makeService();
    findEditById.mockResolvedValue({
      ...FAKE_EDIT_ROW,
      logisticsOrder: { orderNumber: 7, status: 'INITIAL' },
    });

    const data = await service.getForEdit('lead-1');

    expect(data.logisticsOrder).toEqual({ orderNumber: 7, status: 'INITIAL' });
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

  // Was: an agent sending `['other']` — reassigning their lead, which only a manager or an
  // administrator may do (now refused below). The rule it pinned still holds: an edit that
  // leaves Assigned empty cannot drop the agent off their own lead.
  it('keeps a sales agent on their own lead so an edit cannot hide it', async () => {
    const { service, findById, updateArgsOf } = makeService(
      UserRole.SALES_AGENT,
      'agent-1',
    );
    findById.mockResolvedValue(AGENT_OWN_ROW);

    await service.update('lead-1', { ...BASE_DTO, assignedAgentIds: [] });

    expect(updateArgsOf().assigneeIds).toEqual(['agent-1']);
  });

  // Regression: the Lead Detail and Kanban edit forms opened without the custom-field
  // definitions and sent `customFields: []`, which erased every value on save.
  it('keeps custom values when the edit omits customFields', async () => {
    const { service, findById, updateArgsOf, prepareValues } = makeService();
    findById.mockResolvedValue(FAKE_ROW);

    await service.update('lead-1', { ...BASE_DTO });

    expect(prepareValues).not.toHaveBeenCalled();
    expect(updateArgsOf().customFieldValues).toBeUndefined();
  });

  it('still clears custom values when the edit sends an empty set', async () => {
    const { service, findById, updateArgsOf, prepareValues } = makeService();
    findById.mockResolvedValue(FAKE_ROW);

    await service.update('lead-1', { ...BASE_DTO, customFields: [] });

    expect(prepareValues).toHaveBeenCalledWith([]);
    expect(updateArgsOf().customFieldValues).toEqual([]);
  });

  // Regression: an edit with no status fell back to the pipeline's first stage, and one with
  // no pipeline to Lead Pipeline — a silent move of a lead nobody asked to move.
  // Regression: an edit to WON answered with `logisticsOrder: null`, so the edited row kept its
  // Delete and status controls until a reload.
  it('returns a lead edited to WON with the order the edit created', async () => {
    const { service, findById, update, leadFindUnique } = makeService();
    findById.mockResolvedValue(FAKE_ROW);
    update.mockResolvedValue({
      ...FAKE_ROW,
      status: 'WON',
      logisticsOrder: null,
    });
    leadFindUnique.mockResolvedValue({
      ...FAKE_ROW,
      status: 'WON',
      logisticsOrder: { orderNumber: 1002, status: 'INITIAL' },
    });

    const lead = await service.update('lead-1', { ...BASE_DTO, status: 'WON' });

    expect(leadFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-1' } }),
    );
    expect(lead.logisticsOrder).toEqual({
      orderNumber: 1002,
      status: 'INITIAL',
    });
  });

  it('keeps the lead’s own status and pipeline when the edit leaves them out', async () => {
    const { service, findById, updateArgsOf, stageFindFirst, stageFindUnique } =
      makeService();
    findById.mockResolvedValue({
      ...FAKE_ROW,
      status: 'HOT',
      pipeline: 'Complaints',
    });
    stageFindFirst.mockResolvedValue({ name: 'New' });

    await service.update('lead-1', { ...BASE_DTO });

    expect(updateArgsOf().data).toMatchObject({
      status: 'HOT',
      pipeline: 'Complaints',
    });
    expect(stageFindFirst).not.toHaveBeenCalled();
    expect(stageFindUnique).not.toHaveBeenCalled();
  });

  it('still edits a lead whose unchanged status predates the pipeline rule', async () => {
    const { service, findById, update, stageFindUnique, pipelineFindUnique } =
      makeService();
    findById.mockResolvedValue({
      ...FAKE_ROW,
      status: 'Legacy',
      pipeline: 'QC',
    });
    stageFindUnique.mockResolvedValue(null);
    pipelineFindUnique.mockResolvedValue(null);

    await service.update('lead-1', {
      ...BASE_DTO,
      status: 'Legacy',
      pipeline: 'QC',
    });

    expect(update).toHaveBeenCalled();
    expect(stageFindUnique).not.toHaveBeenCalled();
  });

  it('checks a changed status against the lead’s pipeline', async () => {
    const { service, findById, update, updateArgsOf, stageFindUnique } =
      makeService();
    findById.mockResolvedValue(FAKE_ROW);

    await service.update('lead-1', { ...BASE_DTO, status: 'HOT' });

    expect(stageFindUnique).toHaveBeenCalledWith({
      where: { pipeline_name: { pipeline: 'Lead Pipeline', name: 'HOT' } },
      select: { id: true },
    });
    expect(updateArgsOf().data).toMatchObject({ status: 'HOT' });

    update.mockClear();
    stageFindUnique.mockResolvedValue(null);
    await expect(
      service.update('lead-1', { ...BASE_DTO, status: 'Bogus' }),
    ).rejects.toThrow(
      '"Bogus" is not a stage of the "Lead Pipeline" pipeline.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a pipeline change whose status is not a stage of the new pipeline', async () => {
    const { service, findById, update, stageFindUnique } = makeService();
    findById.mockResolvedValue(FAKE_ROW);
    stageFindUnique.mockResolvedValue(null);

    // No status sent: the lead's own ('New') is checked against the new pipeline, never
    // swapped for that pipeline's first stage.
    await expect(
      service.update('lead-1', { ...BASE_DTO, pipeline: 'Complaints' }),
    ).rejects.toThrow('"New" is not a stage of the "Complaints" pipeline.');
    expect(update).not.toHaveBeenCalled();
  });

  it('moves the lead when the new pipeline and status agree', async () => {
    const { service, findById, updateArgsOf } = makeService();
    findById.mockResolvedValue(FAKE_ROW);

    await service.update('lead-1', {
      ...BASE_DTO,
      pipeline: 'Complaints',
      status: 'Intake',
    });

    expect(updateArgsOf().data).toMatchObject({
      pipeline: 'Complaints',
      status: 'Intake',
    });
  });

  it('refuses a move to a pipeline that does not exist', async () => {
    const { service, findById, update, pipelineFindUnique } = makeService();
    findById.mockResolvedValue(FAKE_ROW);
    pipelineFindUnique.mockResolvedValue(null);

    await expect(
      service.update('lead-1', {
        ...BASE_DTO,
        pipeline: 'Nope',
        status: 'HOT',
      }),
    ).rejects.toThrow('Pipeline "Nope" does not exist.');
    expect(update).not.toHaveBeenCalled();
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

describe('LeadsService — audit (ADR-0083)', () => {
  it('records a new lead as CREATED, then ASSIGNED, through the create’s transaction', async () => {
    const { service, create, tx, auditFindMany, auditCreateMany } =
      makeService();
    auditFindMany.mockResolvedValue([
      auditRow({ assignments: [{ userId: 'u1' }] }),
    ]);

    await service.create({ ...BASE_DTO, assignedAgentIds: ['u1'] });

    // The lead is written through the same transaction client the events use.
    expect((create.mock.calls[0] as unknown[])[1]).toBe(tx);
    expect(recorded(auditCreateMany)).toMatchObject([
      {
        action: 'CREATED',
        entityId: 'lead-1',
        actorId: 'me',
        source: 'leads.create',
        after: { status: 'New', pipeline: 'Lead Pipeline' },
      },
      { action: 'ASSIGNED', after: { assigneeIds: ['u1'] } },
    ]);
  });

  it('marks an assignment the rule engine chose as automatic', async () => {
    const { service, pickAssignee, auditFindMany, auditCreateMany } =
      makeService();
    pickAssignee.mockResolvedValue('auto-agent');
    auditFindMany.mockResolvedValue([
      auditRow({ assignments: [{ userId: 'auto-agent' }] }),
    ]);

    await service.create({ ...BASE_DTO });

    expect(recorded(auditCreateMany)[1]).toMatchObject({
      action: 'ASSIGNED',
      metadata: { autoAssigned: true },
    });
  });

  it('records no creation when the create fails', async () => {
    const { service, create, auditCreateMany } = makeService();
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(service.create({ ...BASE_DTO })).rejects.toMatchObject({
      status: 400,
    });
    expect(auditCreateMany).not.toHaveBeenCalled();
  });

  /*
    A lead created straight into WON (form, Quick Add, or a duplicate/import batch) records
    CREATED with that status and no CONVERTED — `leadCreatedEvents` has no conversion branch.
    Pinned because ADR-0085 B8 has to cover the created-as-WON paths explicitly.
  */
  it('converts a lead created straight into WON', async () => {
    const { service, dataOf, auditFindMany, auditCreateMany } = makeService();
    auditFindMany.mockResolvedValue([auditRow({ status: 'WON' })]);

    await service.create({ ...BASE_DTO, status: 'WON' });

    expect(dataOf().status).toBe('WON');
    const events = recorded(auditCreateMany);
    // ADR-0085 A2 path 1: the create transaction makes the order and records the
    // conversion, so a lead that never passes through the change core still converts.
    expect(events).toMatchObject([
      { action: 'CREATED', source: 'leads.create', after: { status: 'WON' } },
      { action: 'CONVERTED', metadata: { orderId: 'order-1' } },
      { entityType: 'LOGISTICS_ORDER', action: 'CREATED', leadId: 'lead-1' },
    ]);
  });

  it('records an edit as one event per kind of change, each with old and new values', async () => {
    const { service, findById, update, tx, auditFindMany, auditCreateMany } =
      makeService();
    findById.mockResolvedValue(FAKE_ROW);
    auditFindMany
      .mockResolvedValueOnce([
        auditRow({ city: 'Dubai', assignments: [{ userId: 'u1' }] }),
      ])
      .mockResolvedValueOnce([
        auditRow({
          status: 'WON',
          city: 'Sharjah',
          assignments: [{ userId: 'u2' }],
        }),
      ]);

    await service.update('lead-1', { ...BASE_DTO, status: 'WON' });

    expect((update.mock.calls[0] as unknown[])[2]).toBe(tx);
    expect(
      recorded(auditCreateMany).map((e) => [e.action, e.before, e.after]),
    ).toEqual([
      ['CONVERTED', { status: 'New' }, { status: 'WON' }],
      ['REASSIGNED', { assigneeIds: ['u1'] }, { assigneeIds: ['u2'] }],
      ['UPDATED', { city: 'Dubai' }, { city: 'Sharjah' }],
      [
        'CREATED',
        undefined,
        expect.objectContaining({ orderNumber: 1000, status: 'INITIAL' }),
      ],
    ]);
    // Only the conversion names the order; the other lead events keep their own metadata.
    expect(recorded(auditCreateMany).map((e) => e.metadata)).toEqual([
      { orderId: 'order-1' },
      undefined,
      undefined,
      undefined,
    ]);
    expect(recorded(auditCreateMany)[0]).toMatchObject({
      actorId: 'me',
      source: 'leads.update',
    });
  });

  it('leaves no event behind when the edit fails (bad agent id)', async () => {
    const { service, findById, update, auditFindMany, auditCreateMany } =
      makeService();
    findById.mockResolvedValue(FAKE_ROW);
    auditFindMany.mockResolvedValue([auditRow()]);
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.update('lead-1', { ...BASE_DTO }),
    ).rejects.toMatchObject({ status: 400 });
    expect(auditCreateMany).not.toHaveBeenCalled();
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

describe('LeadsService.create — a duplicate is never refused (ADR-0092)', () => {
  const enquiry = {
    name: 'Repeat Caller',
    primaryPhone: '+971500000001',
    email: 'repeat@example.com',
  };
  const match = {
    id: 'lead-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    duplicateOfId: null,
  };

  it('creates the lead even though it duplicates an existing one', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([match]);

    await expect(kit.service.create(enquiry)).resolves.toBeDefined();

    expect(kit.create).toHaveBeenCalledTimes(1);
    expect(kit.dataOf().duplicateOf).toEqual({ connect: { id: 'lead-1' } });
    // The enquiry-blocking log is gone: nothing is ever written to it.
    expect(kit.blockedCreate).not.toHaveBeenCalled();
  });

  /*
    A row saved while Block, hard stop existed may still carry it (and the Block-only
    "assignee info" toggle). Whatever it says, it must not be able to refuse a lead.
  */
  describe.each([
    ['a legacy Block, hard stop row', { mode: 'BLOCK_HARD_STOP' }],
    [
      'a legacy Block row with its Block-only toggle on',
      { mode: 'BLOCK_HARD_STOP', displayAssigneeInfo: true },
    ],
    ['a legacy Warn row', { mode: 'WARN_ALLOW_SAVE' }],
    ['a row with an unknown mode', { mode: 'SOMETHING_ELSE' }],
  ])('with %s stored', (_label, legacy) => {
    const withLegacy = (kit: ReturnType<typeof makeService>) =>
      kit.getSalesCrmDuplicate.mockResolvedValue({
        ...SALES_CRM_DUPLICATE_DEFAULTS,
        ...legacy,
      });

    it('still creates the duplicate as its own lead, linked to the original', async () => {
      const kit = makeService();
      kit.leadFindMany.mockResolvedValue([match]);
      withLegacy(kit);

      await expect(kit.service.create(enquiry)).resolves.toBeDefined();

      expect(kit.create).toHaveBeenCalledTimes(1);
      expect(kit.dataOf().duplicateOf).toEqual({ connect: { id: 'lead-1' } });
      expect(kit.blockedCreate).not.toHaveBeenCalled();
    });

    it('starts it in the normal default status', async () => {
      const kit = makeService();
      kit.leadFindMany.mockResolvedValue([match]);
      withLegacy(kit);

      await kit.service.create(enquiry);

      expect(kit.dataOf().status).toBe('New');
    });

    it('creates a lead with no match exactly as before', async () => {
      const kit = makeService();
      kit.leadFindMany.mockResolvedValue([]);
      withLegacy(kit);

      await kit.service.create(enquiry);

      expect(kit.create).toHaveBeenCalledTimes(1);
      expect(kit.dataOf().duplicateOf).toBeUndefined();
    });
  });

  it('makes one duplicate lookup per create — the original — not a warning query as well', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([match]);

    await kit.service.create(enquiry);

    expect(kit.leadFindMany).toHaveBeenCalledTimes(1);
  });

  it('creates the lead normally when nothing matches', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([]);

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

describe('LeadsService — Tag Permissions (ADR-0091)', () => {
  it('asks the policy about the tags on a new lead before doing anything else', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');

    await kit.service.create({ ...BASE_DTO, tagIds: ['t1', 't2'] });

    expect(kit.assertMayHandle).toHaveBeenCalledWith(
      { id: 'agent-1', role: UserRole.SALES_AGENT, team: null },
      ['t1', 't2'],
    );
  });

  it('refuses a lead carrying a tag the caller may not select, creating nothing', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
    kit.assertMayHandle.mockRejectedValue(
      new ForbiddenException(TAG_NOT_PERMITTED),
    );

    await expect(
      kit.service.create({ ...BASE_DTO, tagIds: ['forbidden'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(kit.create).not.toHaveBeenCalled();
    // Refused before the duplicate check could log anything either.
    expect(kit.blockedCreate).not.toHaveBeenCalled();
    expect(kit.leadFindMany).not.toHaveBeenCalled();
  });

  it('checks no tag permission for a lead with no tags', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');

    await kit.service.create({ ...BASE_DTO });

    expect(kit.assertMayHandle).toHaveBeenCalledWith(expect.anything(), []);
  });

  describe('update', () => {
    // An agent only ever sees (and so edits) a lead assigned to them.
    const existing = {
      ...FAKE_ROW,
      assignments: [
        {
          createdAt: new Date('2026-08-19T16:00:00.000Z'),
          user: { id: 'agent-1', name: 'Agent One' },
        },
      ],
      tags: [
        { tag: { id: 'kept', name: 'KEPT' } },
        { tag: { id: 'locked', name: 'LOCKED' } },
      ],
    };

    it('needs no permission for a tag the edit leaves alone', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      kit.findById.mockResolvedValue(existing);

      // The form re-sends every tag already on the lead, including the one the user
      // cannot select: nothing changes, so nothing is asked of the policy.
      await kit.service.update('lead-1', {
        ...BASE_DTO,
        tagIds: ['kept', 'locked'],
      });

      expect(kit.assertMayHandle).toHaveBeenCalledWith(expect.anything(), []);
      expect(kit.updateArgsOf().tagIds).toEqual(['kept', 'locked']);
    });

    it('asks about exactly the tags the edit adds', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      kit.findById.mockResolvedValue(existing);

      await kit.service.update('lead-1', {
        ...BASE_DTO,
        tagIds: ['kept', 'locked', 'new'],
      });

      expect(kit.assertMayHandle).toHaveBeenCalledWith(expect.anything(), [
        'new',
      ]);
    });

    it('asks about exactly the tags the edit removes', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      kit.findById.mockResolvedValue(existing);

      await kit.service.update('lead-1', { ...BASE_DTO, tagIds: ['kept'] });

      expect(kit.assertMayHandle).toHaveBeenCalledWith(expect.anything(), [
        'locked',
      ]);
    });

    it('treats an omitted tag list as removing every tag, so it needs permission for all of them', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      kit.findById.mockResolvedValue(existing);

      await kit.service.update('lead-1', { ...BASE_DTO });

      expect(kit.assertMayHandle).toHaveBeenCalledWith(expect.anything(), [
        'kept',
        'locked',
      ]);
    });

    it('refuses an edit that changes a tag the caller may not select, writing nothing', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      kit.findById.mockResolvedValue(existing);
      kit.assertMayHandle.mockRejectedValue(
        new ForbiddenException(TAG_NOT_PERMITTED),
      );

      await expect(
        kit.service.update('lead-1', { ...BASE_DTO, tagIds: ['kept'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(kit.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an out-of-scope lead before the policy is asked', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      kit.findById.mockResolvedValue(null);

      await expect(
        kit.service.update('lead-1', { ...BASE_DTO, tagIds: ['x'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(kit.assertMayHandle).not.toHaveBeenCalled();
    });
  });
});

describe('LeadsService.create — duplicate relationship (ADR-0092)', () => {
  const enquiry = {
    name: 'Customer A',
    primaryPhone: '9999999999',
  };
  /** A matched lead as the duplicate query returns it. */
  const existing = (over: Record<string, unknown> = {}) => ({
    id: 'orig-1',
    name: 'Customer A',
    status: 'LOST',
    primaryPhone: '9999999999',
    secondaryPhone: null,
    email: null,
    assignments: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    duplicateOfId: null,
    ...over,
  });

  it('creates the duplicate as a separate lead recorded against the original', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([existing()]);

    await kit.service.create(enquiry);

    expect(kit.create).toHaveBeenCalledTimes(1);
    const data = kit.dataOf();
    expect(data.duplicateOf).toEqual({ connect: { id: 'orig-1' } });
    // Its own identity: nothing in the payload names the original's id as its own.
    expect(data).not.toHaveProperty('id');
    expect(data.name).toBe('Customer A');
    expect(data.primaryPhone).toBe('9999999999');
  });

  it('starts the duplicate as NEW even when the original is LOST, and never touches the original', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([existing({ status: 'LOST' })]);

    await kit.service.create(enquiry);

    expect(kit.dataOf().status).toBe('New');
    // The only lead writes available are the create and the audit rows: the mocked database
    // has no way to update or delete the original, and the repository's update never ran.
    expect(kit.update).not.toHaveBeenCalled();
  });

  it('starts the duplicate as NEW when the original is WON, with no conversion', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([existing({ status: 'WON' })]);

    await kit.service.create(enquiry);

    expect(kit.dataOf().status).toBe('New');
    expect(kit.tx.logisticsOrder.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('still honours a status the user explicitly chose', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([existing({ status: 'LOST' })]);

    await kit.service.create({ ...enquiry, status: 'HOT' });

    expect(kit.dataOf().status).toBe('HOT');
  });

  it('records no relationship when nothing matches', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([]);

    await kit.service.create(enquiry);

    expect(kit.dataOf().duplicateOf).toBeUndefined();
  });

  it('points at the oldest match that is not itself a duplicate, so duplicates form a star', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([
      existing({
        id: 'dup-2',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        duplicateOfId: 'orig-1',
      }),
      existing({
        id: 'dup-1',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        duplicateOfId: 'orig-1',
      }),
      existing({
        id: 'orig-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);

    await kit.service.create(enquiry);

    expect(kit.dataOf().duplicateOf).toEqual({ connect: { id: 'orig-1' } });
  });

  it('exposes only that the lead is a duplicate — never the other lead’s id', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([existing()]);
    kit.create.mockResolvedValue({ ...FAKE_ROW, duplicateOfId: 'orig-1' });

    const lead = await kit.service.create(enquiry);

    // The original may be a lead the caller is not allowed to open; its id must not ride along.
    expect(lead.isDuplicate).toBe(true);
    expect(lead).not.toHaveProperty('duplicateOfId');
    expect(JSON.stringify(lead)).not.toContain('orig-1');
  });

  it('reports a lead that is not a duplicate as such', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([]);
    kit.create.mockResolvedValue({ ...FAKE_ROW, duplicateOfId: null });

    const lead = await kit.service.create(enquiry);

    expect(lead.isDuplicate).toBe(false);
  });

  it('searches archived leads for the original only when Duplicate Settings says so', async () => {
    const kit = makeService();
    kit.leadFindMany.mockResolvedValue([existing()]);

    await kit.service.create(enquiry);
    const live = kit.leadFindMany.mock.calls.map(
      (call) => (call as [{ where: Record<string, unknown> }])[0].where,
    );
    // Both the warning query and the original lookup exclude archived leads by default.
    expect(live.every((where) => where.deletedAt === null)).toBe(true);
  });
});

describe('LeadsService.checkDuplicates (the New Lead form’s warning)', () => {
  const match = (over: Record<string, unknown> = {}) => ({
    id: 'lead-9',
    name: 'Existing Customer',
    status: 'HOT',
    primaryPhone: '5551',
    secondaryPhone: null,
    email: null,
    assignments: [],
    ...over,
  });

  it('asks nothing of the database when no contact value was given', async () => {
    const kit = makeService();

    const result = await kit.service.checkDuplicates({});

    expect(result).toEqual({ matches: [] });
    expect(kit.leadFindMany).not.toHaveBeenCalled();
  });

  it('names a match the caller can open, with the field that matched', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
    kit.leadFindMany
      .mockResolvedValueOnce([match()])
      .mockResolvedValueOnce([{ id: 'lead-9' }]);

    const result = await kit.service.checkDuplicates({ primaryPhone: '5551' });

    expect(result.matches).toEqual([
      {
        id: 'lead-9',
        name: 'Existing Customer',
        status: 'HOT',
        matchedOn: 'primaryPhone',
        restricted: false,
      },
    ]);
  });

  it('reveals nothing about a match outside the caller’s scope', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
    kit.leadFindMany
      .mockResolvedValueOnce([match({ name: 'Secret Customer' })])
      .mockResolvedValueOnce([]);

    const result = await kit.service.checkDuplicates({ primaryPhone: '5551' });

    expect(result.matches).toEqual([
      {
        id: null,
        name: null,
        status: null,
        matchedOn: 'primaryPhone',
        restricted: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('Secret Customer');
    expect(JSON.stringify(result)).not.toContain('lead-9');
  });

  it('scopes the visibility check to the caller and the matched ids', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
    kit.leadFindMany.mockResolvedValueOnce([match()]).mockResolvedValueOnce([]);

    await kit.service.checkDuplicates({ primaryPhone: '5551' });

    const [visibility] = kit.leadFindMany.mock.calls[1] as [
      { where: { AND: unknown[] } },
    ];
    const text = JSON.stringify(visibility.where);
    expect(text).toContain('agent-1');
    expect(text).toContain('lead-9');
  });

  it('is only ever a warning: it carries no outcome, even under a legacy Block setting', async () => {
    const kit = makeService();
    kit.getSalesCrmDuplicate.mockResolvedValue({
      ...SALES_CRM_DUPLICATE_DEFAULTS,
      mode: 'BLOCK_HARD_STOP',
    });
    kit.leadFindMany
      .mockResolvedValueOnce([match()])
      .mockResolvedValueOnce([{ id: 'lead-9' }]);

    const result = await kit.service.checkDuplicates({ email: 'a@b.co' });

    expect(Object.keys(result)).toEqual(['matches']);
    expect(result.matches).toHaveLength(1);
  });
});

describe('LeadsService.getDuplicateLinks', () => {
  const related = (id: string) => ({
    id,
    name: 'Lead ' + id,
    status: 'New',
    pipeline: 'Lead Pipeline',
    primaryPhone: '5551',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  it('404s a lead outside the caller’s scope without reading any related lead', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
    kit.leadFindFirst.mockResolvedValue(null);

    await expect(
      kit.service.getDuplicateLinks('lead-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(kit.leadFindMany).not.toHaveBeenCalled();
  });

  it('returns the original and the leads recorded as duplicates of this one', async () => {
    const kit = makeService();
    kit.leadFindFirst
      .mockResolvedValueOnce({ duplicateOfId: 'orig-1' })
      .mockResolvedValueOnce(related('orig-1'));
    kit.leadFindMany.mockResolvedValue([related('dup-1'), related('dup-2')]);
    kit.leadCount.mockResolvedValue(2);

    const links = await kit.service.getDuplicateLinks('lead-1');

    expect(links.original?.id).toBe('orig-1');
    expect(links.original?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(links.duplicates.map((d) => d.id)).toEqual(['dup-1', 'dup-2']);
    expect(links.hasHidden).toBe(false);
  });

  it('has no original for a lead that is not a duplicate', async () => {
    const kit = makeService();
    kit.leadFindFirst.mockResolvedValueOnce({ duplicateOfId: null });

    const links = await kit.service.getDuplicateLinks('lead-1');

    expect(links.original).toBeNull();
    expect(links.hasHidden).toBe(false);
    // Only the lead itself was looked up; there is no original to fetch.
    expect(kit.leadFindFirst).toHaveBeenCalledTimes(1);
  });

  it('leaves out an original the caller cannot open and says something is hidden', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
    kit.leadFindFirst
      .mockResolvedValueOnce({ duplicateOfId: 'orig-1' })
      .mockResolvedValueOnce(null);

    const links = await kit.service.getDuplicateLinks('lead-1');

    expect(links.original).toBeNull();
    expect(links.hasHidden).toBe(true);
  });

  it('applies the caller’s scope to the original and to the duplicates', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
    kit.leadFindFirst
      .mockResolvedValueOnce({ duplicateOfId: 'orig-1' })
      .mockResolvedValueOnce(related('orig-1'));

    await kit.service.getDuplicateLinks('lead-1');

    const originalQuery = kit.leadFindFirst.mock.calls[1] as [
      { where: unknown },
    ];
    const duplicatesQuery = kit.leadFindMany.mock.calls[0] as [
      { where: unknown },
    ];
    expect(JSON.stringify(originalQuery[0].where)).toContain('agent-1');
    expect(JSON.stringify(duplicatesQuery[0].where)).toContain('agent-1');
  });

  it('counts duplicates the caller cannot see as hidden, without listing them', async () => {
    const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
    kit.leadFindFirst.mockResolvedValueOnce({ duplicateOfId: null });
    kit.leadFindMany.mockResolvedValue([related('dup-1')]);
    kit.leadCount.mockResolvedValue(3);

    const links = await kit.service.getDuplicateLinks('lead-1');

    expect(links.duplicates).toHaveLength(1);
    expect(links.hasHidden).toBe(true);
  });
});

/*
  Assignees (Phase 1B): the New/Edit Lead form's Assigned field obeys the Reassign actions'
  rules — only a manager or an administrator chooses assignees, and anyone added must be a
  live user in an assignable role. Regression: an agent's POST/PUT assigned the lead to any
  user id, an operational user included, although Reassign refused them (403).
*/
describe('LeadsService — assignees', () => {
  const assignedTo = (...ids: string[]) => ({
    ...FAKE_ROW,
    assignments: ids.map((id) => ({
      createdAt: new Date('2026-08-19T16:00:00.000Z'),
      user: { id, name: id },
    })),
  });
  const createdAssignees = (kit: ReturnType<typeof makeService>) =>
    JSON.stringify(kit.dataOf().assignments ?? null);

  describe('a sales agent', () => {
    it('creates a lead assigned to themselves', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      await kit.service.create({ ...BASE_DTO, assignedAgentIds: ['agent-1'] });
      expect(createdAssignees(kit)).toContain('agent-1');
      expect(kit.userCount).toHaveBeenCalledWith({
        where: {
          id: { in: ['agent-1'] },
          deletedAt: null,
          // Phase 2A: an assignee a request adds must also be active.
          isActive: true,
          role: {
            in: [
              UserRole.SALES_AGENT,
              UserRole.SALES_MANAGER,
              UserRole.CUSTOMER_SERVICE_AGENT,
            ],
          },
        },
      });
    });

    it('may not create a lead for another user (403), and nothing is written', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      await expect(
        kit.service.create({ ...BASE_DTO, assignedAgentIds: ['agent-2'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(kit.create).not.toHaveBeenCalled();
    });

    it('may not change an existing lead’s assignees (403), and nothing is written', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      kit.findById.mockResolvedValue(assignedTo('agent-1'));
      for (const ids of [['agent-1', 'agent-2'], ['agent-2']]) {
        await expect(
          kit.service.update('lead-1', { ...BASE_DTO, assignedAgentIds: ids }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(kit.update).not.toHaveBeenCalled();
    });

    it('edits a lead without changing its assignees', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1');
      kit.findById.mockResolvedValue(assignedTo('agent-1', 'agent-2'));

      await kit.service.update('lead-1', {
        ...BASE_DTO,
        city: 'Dubai',
        assignedAgentIds: ['agent-2', 'agent-1'],
      });

      expect(kit.updateArgsOf().assigneeIds.sort()).toEqual([
        'agent-1',
        'agent-2',
      ]);
      // Nobody is added, so nobody needs checking.
      expect(kit.userCount).not.toHaveBeenCalled();
    });
  });

  it('a customer service agent (sees every lead) may edit one but not unassign or reassign it', async () => {
    const kit = makeService(UserRole.CUSTOMER_SERVICE_AGENT, 'cs-1');
    kit.findById.mockResolvedValue(assignedTo('agent-1'));

    await kit.service.update('lead-1', {
      ...BASE_DTO,
      assignedAgentIds: ['agent-1'],
    });
    expect(kit.update).toHaveBeenCalledTimes(1);

    for (const ids of [[], ['cs-1'], ['agent-1', 'cs-1']]) {
      await expect(
        kit.service.update('lead-1', { ...BASE_DTO, assignedAgentIds: ids }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(kit.update).toHaveBeenCalledTimes(1);
  });

  it.each([UserRole.SALES_MANAGER, UserRole.SUPERADMIN])(
    '%s assigns and reassigns to assignable users',
    async (role) => {
      const kit = makeService(role, 'boss-1');
      await kit.service.create({ ...BASE_DTO, assignedAgentIds: ['agent-2'] });
      expect(createdAssignees(kit)).toContain('agent-2');

      kit.findById.mockResolvedValue(assignedTo('agent-1'));
      await kit.service.update('lead-1', {
        ...BASE_DTO,
        assignedAgentIds: ['agent-2', 'cs-1'],
      });
      expect(kit.updateArgsOf().assigneeIds).toEqual(['agent-2', 'cs-1']);
      // Only the users the edit adds are checked.
      const [last] = kit.userCount.mock.calls.at(-1) as [
        { where: { id: { in: string[] } } },
      ];
      expect(last.where.id).toEqual({ in: ['agent-2', 'cs-1'] });
    },
  );

  it.each([UserRole.SALES_MANAGER, UserRole.SUPERADMIN])(
    '%s cannot assign a deleted or non-assignable user (400), and nothing is written',
    async (role) => {
      const kit = makeService(role, 'boss-1');
      // The live, assignable count comes back short: one id is deleted, missing or, say,
      // an operational or admin user.
      kit.userCount.mockResolvedValue(0);

      await expect(
        kit.service.create({ ...BASE_DTO, assignedAgentIds: ['ops-1'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      kit.findById.mockResolvedValue(assignedTo('agent-1'));
      await expect(
        kit.service.update('lead-1', {
          ...BASE_DTO,
          assignedAgentIds: ['agent-1', 'gone-1'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(kit.create).not.toHaveBeenCalled();
      expect(kit.update).not.toHaveBeenCalled();
    },
  );

  it('does not re-check an assignee already on the lead, so an older assignment still takes edits', async () => {
    const kit = makeService(UserRole.SUPERADMIN, 'admin-1');
    // Assigned to an administrator before the rule — not an assignable role.
    kit.findById.mockResolvedValue(assignedTo('admin-1'));
    kit.userCount.mockResolvedValue(0);

    await kit.service.update('lead-1', {
      ...BASE_DTO,
      assignedAgentIds: ['admin-1'],
    });

    expect(kit.userCount).not.toHaveBeenCalled();
    expect(kit.updateArgsOf().assigneeIds).toEqual(['admin-1']);
  });

  // Phase 2A: an assignee a request adds must be active; one the lead already has is kept.
  it('refuses a newly added inactive user (400), and keeps an inactive one the lead already has', async () => {
    const kit = makeService(UserRole.SALES_MANAGER, 'mgr-1');
    kit.findById.mockResolvedValue(assignedTo('agent-1', 'inactive-1'));
    // The live, active, assignable count of the added id comes back short: it is inactive.
    kit.userCount.mockResolvedValue(0);

    await expect(
      kit.service.update('lead-1', {
        ...BASE_DTO,
        assignedAgentIds: ['agent-1', 'inactive-1', 'inactive-2'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const [checked] = kit.userCount.mock.calls[0] as [
      { where: { id: { in: string[] }; isActive: boolean } },
    ];
    expect(checked.where.id).toEqual({ in: ['inactive-2'] });
    expect(checked.where.isActive).toBe(true);
    expect(kit.update).not.toHaveBeenCalled();

    // An unrelated edit keeps the inactive assignee and checks nobody.
    kit.userCount.mockClear();
    await kit.service.update('lead-1', {
      ...BASE_DTO,
      city: 'Dubai',
      assignedAgentIds: ['agent-1', 'inactive-1'],
    });
    expect(kit.userCount).not.toHaveBeenCalled();
    expect(kit.updateArgsOf().assigneeIds).toEqual(['agent-1', 'inactive-1']);
  });

  it('a caller outside the assignable roles cannot assign even themselves', async () => {
    const kit = makeService(UserRole.MARKETING_ANALYST, 'mkt-1');
    kit.userCount.mockResolvedValue(0);

    await expect(
      kit.service.create({ ...BASE_DTO, assignedAgentIds: ['mkt-1'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Left unassigned, the lead is created (automatic assignment may fill it).
    await kit.service.create({ ...BASE_DTO, assignedAgentIds: [] });
    expect(kit.create).toHaveBeenCalledTimes(1);
  });
});

// ADR-0093: pipeline access on the writes — create into, edit in, move between pipelines.
describe('LeadsService — pipeline access (ADR-0093)', () => {
  const CLOSED = ['VIP'];
  const VIP_ROW = { ...AGENT_OWN_ROW, pipeline: 'VIP' };

  describe('create (B6)', () => {
    it('refuses a pipeline closed to the caller, before its stages are read', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1', null, CLOSED);

      await expect(
        kit.service.create({ ...BASE_DTO, pipeline: 'VIP' }),
      ).rejects.toThrow(
        new ForbiddenException(`You don't have access to the "VIP" pipeline.`),
      );
      expect(kit.stageFindFirst).not.toHaveBeenCalled();
      expect(kit.create).not.toHaveBeenCalled();
    });

    it('creates in a pipeline open to the caller, the rest of the rules unchanged', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1', null, CLOSED);

      await kit.service.create({ ...BASE_DTO, pipeline: 'Complaints' });

      expect(kit.dataOf().pipeline).toBe('Complaints');
      expect(kit.dataOf().assignments).toEqual({
        create: [{ user: { connect: { id: 'agent-1' } } }],
      });
    });

    it('lets the admin create in any pipeline (B1)', async () => {
      const kit = makeService(UserRole.SUPERADMIN, 'me', null, CLOSED);

      await kit.service.create({ ...BASE_DTO, pipeline: 'VIP' });

      expect(kit.dataOf().pipeline).toBe('VIP');
    });
  });

  describe('update', () => {
    it('refuses an agent’s edit of an assigned lead in a pipeline closed to them (B2)', async () => {
      const kit = makeService(UserRole.SALES_AGENT, 'agent-1', null, CLOSED);
      kit.findById.mockResolvedValue(VIP_ROW);

      await expect(
        kit.service.update('lead-1', { ...BASE_DTO, pipeline: 'VIP' }),
      ).rejects.toThrow(
        'This lead is in the "VIP" pipeline, which you don\'t have access to. You can view it, but not change it.',
      );
      expect(kit.update).not.toHaveBeenCalled();
    });

    it.each([
      UserRole.SALES_AGENT,
      UserRole.CUSTOMER_SERVICE_AGENT,
      UserRole.MARKETING_ANALYST,
    ])('refuses %s moving a lead to another pipeline (B5)', async (role) => {
      const kit = makeService(role, 'agent-1');
      kit.findById.mockResolvedValue(AGENT_OWN_ROW);

      await expect(
        kit.service.update('lead-1', {
          ...BASE_DTO,
          pipeline: 'Complaints',
          status: 'Intake',
        }),
      ).rejects.toThrow(
        'Only a manager or an administrator can move a lead to another pipeline.',
      );
      expect(kit.update).not.toHaveBeenCalled();
    });

    it('lets them save an edit that keeps the lead’s pipeline', async () => {
      const kit = makeService(UserRole.CUSTOMER_SERVICE_AGENT, 'cs-1');
      kit.findById.mockResolvedValue(AGENT_OWN_ROW);

      await kit.service.update('lead-1', {
        ...BASE_DTO,
        pipeline: 'Lead Pipeline',
        city: 'Dubai',
        assignedAgentIds: ['agent-1'],
      });

      expect(kit.update).toHaveBeenCalledTimes(1);
    });

    it('refuses a manager moving a lead into a pipeline closed to them', async () => {
      const kit = makeService(UserRole.SALES_MANAGER, 'mgr-1', 'Sales', CLOSED);
      kit.findById.mockResolvedValue(AGENT_OWN_ROW);

      await expect(
        kit.service.update('lead-1', {
          ...BASE_DTO,
          pipeline: 'VIP',
          status: 'New',
          assignedAgentIds: ['agent-1'],
        }),
      ).rejects.toThrow(`You don't have access to the "VIP" pipeline.`);
      expect(kit.pipelineFindUnique).not.toHaveBeenCalled();
      expect(kit.update).not.toHaveBeenCalled();
    });

    it('lets a manager move a lead into a pipeline open to them', async () => {
      const kit = makeService(UserRole.SALES_MANAGER, 'mgr-1', 'Sales', CLOSED);
      kit.findById.mockResolvedValue(AGENT_OWN_ROW);

      await kit.service.update('lead-1', {
        ...BASE_DTO,
        pipeline: 'Complaints',
        status: 'Intake',
        assignedAgentIds: ['agent-1'],
      });

      expect(kit.updateArgsOf().data.pipeline).toBe('Complaints');
    });

    it('lets the admin move a lead into any pipeline (B1)', async () => {
      const kit = makeService(UserRole.SUPERADMIN, 'me', null, CLOSED);
      kit.findById.mockResolvedValue(VIP_ROW);

      await kit.service.update('lead-1', {
        ...BASE_DTO,
        pipeline: 'Complaints',
        status: 'Intake',
        assignedAgentIds: ['agent-1'],
      });

      expect(kit.updateArgsOf().data.pipeline).toBe('Complaints');
    });
  });
});
