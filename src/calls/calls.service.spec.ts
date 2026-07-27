import { CallDirection, CallOutcome, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from './calls.service';
import { CallLookupService } from './call-lookup.service';
import { IngestCallEventDto } from './dto/ingest-call-event.dto';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const CALL_ID = '44444444-4444-4444-4444-444444444444';

function makeEvent(
  overrides: Partial<IngestCallEventDto> = {},
): IngestCallEventDto {
  return {
    externalId: '3cx-1001',
    leadId: LEAD_ID,
    agentId: AGENT_ID,
    phone: '+971500000000',
    startedAt: '2026-07-27T09:00:00.000Z',
    direction: CallDirection.OUTBOUND,
    outcome: CallOutcome.ANSWERED,
    duration: 42,
    ...overrides,
  };
}

function makeService() {
  const callFindUnique = jest.fn();
  const callCreate = jest.fn();
  const matchLeadIdByPhone = jest.fn();

  const prisma = {
    call: { findUnique: callFindUnique, create: callCreate },
  } as unknown as PrismaService;
  const lookup = { matchLeadIdByPhone } as unknown as CallLookupService;

  const service = new CallsService(prisma, lookup);
  return { service, callFindUnique, callCreate, matchLeadIdByPhone };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('CallsService.ingest', () => {
  it('stores a new matched event as a call record', async () => {
    const { service, callFindUnique, callCreate } = makeService();
    callFindUnique.mockResolvedValue(null);
    callCreate.mockResolvedValue({ id: CALL_ID });

    const result = await service.ingest(makeEvent());

    expect(result).toEqual({ id: CALL_ID, status: 'created' });
    const data = (callCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.data).toMatchObject({
      externalId: '3cx-1001',
      leadId: LEAD_ID,
      agentId: AGENT_ID,
      startedAt: new Date('2026-07-27T09:00:00.000Z'),
    });
  });

  it('is idempotent — a replayed event returns the existing record, no create (AC5)', async () => {
    const { service, callFindUnique, callCreate } = makeService();
    callFindUnique.mockResolvedValue({ id: CALL_ID });

    const result = await service.ingest(makeEvent());

    expect(result).toEqual({ id: CALL_ID, status: 'duplicate' });
    expect(callCreate).not.toHaveBeenCalled();
  });

  it('delegates to the CALL-02.2 lookup when no leadId is supplied (AC3)', async () => {
    const { service, callFindUnique, callCreate, matchLeadIdByPhone } =
      makeService();
    callFindUnique.mockResolvedValue(null);
    matchLeadIdByPhone.mockResolvedValue(LEAD_ID);
    callCreate.mockResolvedValue({ id: CALL_ID });

    const result = await service.ingest(makeEvent({ leadId: undefined }));

    expect(result).toEqual({ id: CALL_ID, status: 'created' });
    expect(matchLeadIdByPhone).toHaveBeenCalledWith('+971500000000');
    const data = (callCreate.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.data).toMatchObject({ leadId: LEAD_ID });
  });

  it('skips an unmatched event without storing it', async () => {
    const { service, callFindUnique, callCreate, matchLeadIdByPhone } =
      makeService();
    callFindUnique.mockResolvedValue(null);
    matchLeadIdByPhone.mockResolvedValue(null);

    const result = await service.ingest(makeEvent({ leadId: undefined }));

    expect(result).toEqual({ id: null, status: 'unmatched' });
    expect(callCreate).not.toHaveBeenCalled();
  });

  it('treats a concurrent unique-constraint race as a duplicate (AC5)', async () => {
    const { service, callFindUnique, callCreate } = makeService();
    // First lookup finds nothing; the create loses the race; the re-lookup finds it.
    callFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: CALL_ID });
    callCreate.mockRejectedValue(p2002());

    const result = await service.ingest(makeEvent());

    expect(result).toEqual({ id: CALL_ID, status: 'duplicate' });
  });

  it('rethrows a genuine failure after alerting', async () => {
    const { service, callFindUnique, callCreate } = makeService();
    callFindUnique.mockResolvedValue(null);
    callCreate.mockRejectedValue(new Error('db down'));

    await expect(service.ingest(makeEvent())).rejects.toThrow('db down');
  });
});
