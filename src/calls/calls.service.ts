import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CallLookupService } from './call-lookup.service';
import { IngestCallEventDto } from './dto/ingest-call-event.dto';

/** What one ingest attempt did — the transport reports/alerts on this. */
export type CallIngestResult = {
  /** The stored call's id, or null when the event matched no lead and was skipped. */
  id: string | null;
  status: 'created' | 'duplicate' | 'unmatched';
};

/**
 * Turns 3CX call events into call records (CALL-02.1) — the source of all Call
 * Dashboard data. Injects PrismaService directly, like the Activities writes:
 * ingestion is one dedup lookup, one optional lead match, one create.
 *
 * Ingestion runs as the system (from the PBX, on behalf of every agent), so it
 * carries no user scope — unlike the read APIs. Deferred here and reported:
 * the live 3CX transport + its payload adapter, the extension→user agent map,
 * the robust phone→lead lookup (CALL-02.2), and the real alerts service
 * (FND-05.1 / INFRA-02.1) — failures below log an error as the alert seam.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lookup: CallLookupService,
  ) {}

  /**
   * Store one call event, idempotently (AC1, AC5). A replayed event (same
   * `externalId`) returns the existing record rather than duplicating it. A
   * matched lead is used as-is; otherwise a best-effort exact phone match runs
   * (AC3). An event that matches no lead is skipped with a warning — the schema
   * requires a lead (CALL-01.1 `lead_id` NOT NULL), so unmatched storage is a
   * reported gap, not silent data loss.
   */
  async ingest(event: IngestCallEventDto): Promise<CallIngestResult> {
    try {
      const existing = await this.prisma.call.findUnique({
        where: { externalId: event.externalId },
        select: { id: true },
      });
      if (existing) return { id: existing.id, status: 'duplicate' };

      const leadId = await this.resolveLead(event);
      if (!leadId) {
        this.logger.warn(
          `Call ${event.externalId} matched no lead (phone ${event.phone}); skipped — lead_id is NOT NULL (CALL-01.1).`,
        );
        return { id: null, status: 'unmatched' };
      }

      const call = await this.prisma.call.create({
        data: {
          externalId: event.externalId,
          leadId,
          agentId: event.agentId,
          phone: event.phone,
          startedAt: new Date(event.startedAt),
          direction: event.direction,
          outcome: event.outcome,
          duration: event.duration,
          leadNotes: event.leadNotes ?? null,
          callNotes: event.callNotes ?? null,
        },
        select: { id: true },
      });
      return { id: call.id, status: 'created' };
    } catch (error) {
      // A concurrent ingest of the same event loses the unique race — treat it
      // as the duplicate it is (AC5) rather than an error.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.call.findUnique({
          where: { externalId: event.externalId },
          select: { id: true },
        });
        if (existing) return { id: existing.id, status: 'duplicate' };
      }
      // AC4: surface the failure instead of losing data silently. The alerts
      // service (FND-05.1 / INFRA-02.1) replaces this log once approved.
      this.logger.error(
        `Call ingestion failed for event ${event.externalId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /**
   * The lead a call belongs to: the pre-resolved `leadId` when the caller
   * supplied one, else the CALL-02.2 phone lookup — unscoped, since ingestion
   * matches on behalf of the system (AC3).
   */
  private async resolveLead(event: IngestCallEventDto): Promise<string | null> {
    return event.leadId ?? this.lookup.matchLeadIdByPhone(event.phone);
  }
}
