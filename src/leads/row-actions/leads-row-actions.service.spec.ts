import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { MailerService } from '../../auth/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadsBulkService } from '../bulk/leads-bulk.service';
import { BulkActionResponse } from '../bulk/dto/bulk-actions.dto';
import { CreateLeadNoteDto } from './dto/row-actions.dto';
import { LeadRowActionsService } from './leads-row-actions.service';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';

/** A row shaped like LEAD_LIST_SELECT — enough for toLeadListItem to run. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    name: 'Copy',
    firstName: null,
    primaryPhone: '900',
    secondaryPhone: null,
    email: null,
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
    updatedAt: new Date('2026-07-21T00:00:00.000Z'),
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
    ...overrides,
  };
}

function makeService(role: UserRole = UserRole.SUPERADMIN) {
  const leadFindFirst = jest.fn();
  const leadFindUnique = jest.fn();
  const leadCreate = jest.fn();
  const leadUpdate = jest.fn();
  const leadNoteCreate = jest.fn();

  const prisma = {
    lead: {
      findFirst: leadFindFirst,
      findUnique: leadFindUnique,
      create: leadCreate,
      update: leadUpdate,
    },
    leadNote: {
      create: leadNoteCreate,
    },
  } as unknown as PrismaService;

  const currentUser = {
    resolve: jest.fn().mockResolvedValue({ id: 'u1', role }),
  } as unknown as CurrentUserService;

  const bulkReassign = jest.fn();
  const bulkDelete = jest.fn();
  const bulk = {
    reassign: bulkReassign,
    delete: bulkDelete,
  } as unknown as LeadsBulkService;

  const sendMail = jest.fn().mockResolvedValue(undefined);
  const mailer = { sendMail } as unknown as MailerService;

  const service = new LeadRowActionsService(prisma, currentUser, bulk, mailer);
  return {
    service,
    leadFindFirst,
    leadFindUnique,
    leadCreate,
    leadUpdate,
    leadNoteCreate,
    bulkReassign,
    bulkDelete,
    sendMail,
  };
}

const oneResult = (status: 'success' | 'failed'): BulkActionResponse => ({
  results: [
    status === 'success'
      ? { id: LEAD_ID, status }
      : { id: LEAD_ID, status, reason: 'x' },
  ],
  summary: {
    total: 1,
    success: status === 'success' ? 1 : 0,
    failed: status === 'success' ? 0 : 1,
  },
});

describe('LeadRowActionsService.duplicate', () => {
  it('copies fields, assignments and tags into a new record', async () => {
    const { service, leadFindFirst, leadCreate } = makeService();
    leadFindFirst.mockResolvedValue({
      name: 'Acme',
      firstName: null,
      primaryPhone: '900',
      secondaryPhone: null,
      language: 'English',
      country: 'UAE',
      source: null,
      status: 'HOT',
      pipeline: 'Lead Pipeline',
      product: 'Widget',
      productQty: null,
      product2: null,
      product2Qty: null,
      bookingDate: null,
      category: 'Default',
      actualAmount: null,
      forecastedAmount: null,
      paymentMethod: 'Cash',
      state: null,
      street: null,
      city: null,
      nationalCode: null,
      callStatus: null,
      callAttempts: 0,
      whatsappAttempts: 0,
      assignments: [{ userId: AGENT_ID }],
      tags: [{ tagId: 'tag-1' }],
    });
    leadCreate.mockResolvedValue(listRow({ id: 'new-id', name: 'Acme' }));

    const item = await service.duplicate(LEAD_ID);

    expect(item.id).toBe('new-id');
    const data = (leadCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    // scalars carried over, id/timestamps not
    expect(data.data.name).toBe('Acme');
    expect(data.data.status).toBe('HOT');
    expect(data.data).not.toHaveProperty('id');
    // assignments + tags cloned as nested creates
    expect(data.data.assignments).toEqual({
      create: [{ user: { connect: { id: AGENT_ID } } }],
    });
    expect(data.data.tags).toEqual({
      create: [{ tag: { connect: { id: 'tag-1' } } }],
    });
  });

  it('404s when the source is outside the caller scope', async () => {
    const { service, leadFindFirst, leadCreate } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(service.duplicate(LEAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(leadCreate).not.toHaveBeenCalled();
  });
});

describe('LeadRowActionsService.setStatus', () => {
  it('updates the status of an in-scope lead', async () => {
    const { service, leadFindFirst, leadUpdate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadUpdate.mockResolvedValue(listRow({ status: 'WON' }));

    const item = await service.setStatus(LEAD_ID, { status: 'WON' });

    expect(item.status).toBe('WON');
    const args = (leadUpdate.mock.calls as unknown[][])[0][0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(args.where.id).toBe(LEAD_ID);
    expect(args.data.status).toBe('WON');
  });

  it('404s (and never updates) an out-of-scope lead', async () => {
    const { service, leadFindFirst, leadUpdate } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(
      service.setStatus(LEAD_ID, { status: 'WON' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leadUpdate).not.toHaveBeenCalled();
  });
});

describe('LeadRowActionsService.reassign', () => {
  it('delegates to the bulk reassign and returns the updated lead', async () => {
    const { service, bulkReassign, leadFindUnique } = makeService();
    bulkReassign.mockResolvedValue(oneResult('success'));
    leadFindUnique.mockResolvedValue(listRow());

    const item = await service.reassign(LEAD_ID, { agentId: AGENT_ID });

    expect(item.id).toBe(LEAD_ID);
    expect(bulkReassign).toHaveBeenCalledWith({
      ids: [LEAD_ID],
      agentId: AGENT_ID,
    });
  });

  it('404s when the lead is not actionable', async () => {
    const { service, bulkReassign, leadFindUnique } = makeService();
    bulkReassign.mockResolvedValue(oneResult('failed'));

    await expect(
      service.reassign(LEAD_ID, { agentId: AGENT_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leadFindUnique).not.toHaveBeenCalled();
  });
});

describe('LeadRowActionsService.sendEmail', () => {
  const payload = {
    to: ['someone@example.com'],
    cc: ['cc@example.com'],
    subject: 'Hi',
    message: 'Body',
  };

  it('sends via the mailer for an in-scope lead and reports sent', async () => {
    const { service, leadFindFirst, sendMail } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });

    const res = await service.sendEmail(LEAD_ID, payload);

    expect(res).toEqual({ sent: true });
    expect(sendMail).toHaveBeenCalledWith({
      to: payload.to,
      cc: payload.cc,
      bcc: undefined,
      subject: 'Hi',
      text: 'Body',
    });
  });

  it('404s (and never sends) for an out-of-scope lead', async () => {
    const { service, leadFindFirst, sendMail } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(service.sendEmail(LEAD_ID, payload)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('surfaces a provider failure as a 500 so the composer can retry', async () => {
    const { service, leadFindFirst, sendMail } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    sendMail.mockRejectedValue(new Error('provider down'));

    await expect(service.sendEmail(LEAD_ID, payload)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe('LeadRowActionsService.addNote', () => {
  const NOTE_ID = '33333333-3333-3333-3333-333333333333';

  it('persists a note authored by the current user for an in-scope lead', async () => {
    const { service, leadFindFirst, leadNoteCreate } = makeService();
    leadFindFirst.mockResolvedValue({ id: LEAD_ID });
    leadNoteCreate.mockResolvedValue({ id: NOTE_ID });

    const res = await service.addNote(LEAD_ID, {
      body: 'Called, will follow up',
    });

    expect(res).toEqual({ id: NOTE_ID });
    const args = (leadNoteCreate.mock.calls as unknown[][])[0][0] as {
      data: { leadId: string; authorId: string; body: string };
    };
    // Scoped to the lead, authored by the resolved caller (never client-supplied).
    expect(args.data.leadId).toBe(LEAD_ID);
    expect(args.data.authorId).toBe('u1');
    expect(args.data.body).toBe('Called, will follow up');
  });

  it('404s (and never writes) for an out-of-scope lead', async () => {
    const { service, leadFindFirst, leadNoteCreate } = makeService();
    leadFindFirst.mockResolvedValue(null);

    await expect(
      service.addNote(LEAD_ID, { body: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leadNoteCreate).not.toHaveBeenCalled();
  });
});

describe('CreateLeadNoteDto validation', () => {
  const bodyErrors = async (raw: unknown): Promise<string[]> => {
    const dto = plainToInstance(CreateLeadNoteDto, { body: raw });
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  };

  it('accepts a non-empty body', async () => {
    expect(await bodyErrors('Follow up next week')).toEqual([]);
  });

  it('rejects an empty or whitespace-only body (trimmed first)', async () => {
    expect((await bodyErrors('')).length).toBeGreaterThan(0);
    expect((await bodyErrors('   ')).length).toBeGreaterThan(0);
  });

  it('rejects a body over the length cap', async () => {
    expect((await bodyErrors('a'.repeat(20001))).length).toBeGreaterThan(0);
  });
});

describe('LeadRowActionsService.delete', () => {
  it('delegates to the bulk hard-delete and confirms the id', async () => {
    const { service, bulkDelete } = makeService();
    bulkDelete.mockResolvedValue(oneResult('success'));

    const res = await service.delete(LEAD_ID);

    expect(res).toEqual({ id: LEAD_ID });
    expect(bulkDelete).toHaveBeenCalledWith({ ids: [LEAD_ID] });
  });

  it('404s when the lead is not actionable', async () => {
    const { service, bulkDelete } = makeService();
    bulkDelete.mockResolvedValue(oneResult('failed'));

    await expect(service.delete(LEAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
