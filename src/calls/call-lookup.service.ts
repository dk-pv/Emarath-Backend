import { Injectable } from '@nestjs/common';
import { CallDirection, CallOutcome } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { leadScopeWhere } from '../leads/lead-scope';

/** The lead a number resolves to, trimmed to what a lookup surfaces (CALL-02.2). */
export type ContactMatch = {
  id: string;
  name: string;
  primaryPhone: string;
  status: string;
  pipeline: string;
};

/** One prior call for a contact (CALL-02.2 AC2). */
export type CallHistoryItem = {
  id: string;
  phone: string;
  startedAt: Date;
  direction: CallDirection;
  outcome: CallOutcome;
  duration: number;
};

/**
 * Contact lookup & call search (CALL-02.2): resolve a phone number to a lead and
 * surface that contact's prior calls. Two visibility modes, deliberately split:
 *
 * - `matchLeadIdByPhone` is **unscoped** — ingestion (CALL-02.1) runs as the
 *   system, and a call belongs to whichever live lead owns the number regardless
 *   of who is asking; a role scope here would silently drop calls (AC3).
 * - `findContact` / `getCallHistory` are **role-scoped** — they surface lead data
 *   to the caller, so they compose `leadScopeWhere` and an agent sees only their
 *   own contacts (AC5).
 *
 * Matching is an exact number match on the two lead phone fields — resolving a
 * specific caller id, not the log's substring search (that is CALL-05/06). An
 * unmatched number returns null / empty, never an error (AC4).
 */
@Injectable()
export class CallLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** Resolve a number to a lead id for ingestion — unscoped (AC1, AC3, AC4). */
  async matchLeadIdByPhone(phone: string): Promise<string | null> {
    const number = phone.trim();
    if (!number) return null;
    const lead = await this.prisma.lead.findFirst({
      where: {
        deletedAt: null,
        OR: [{ primaryPhone: number }, { secondaryPhone: number }],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return lead?.id ?? null;
  }

  /** Resolve a number to the caller's matching contact — scoped (AC1, AC4, AC5). */
  async findContact(phone: string): Promise<ContactMatch | null> {
    const number = phone.trim();
    if (!number) return null;
    const user = await this.currentUser.resolve();
    return this.prisma.lead.findFirst({
      where: {
        AND: [
          leadScopeWhere(user),
          { OR: [{ primaryPhone: number }, { secondaryPhone: number }] },
        ],
      },
      select: {
        id: true,
        name: true,
        primaryPhone: true,
        status: true,
        pipeline: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** A contact's prior calls, newest first — scoped (AC2, AC4, AC5). */
  async getCallHistory(phone: string): Promise<CallHistoryItem[]> {
    const contact = await this.findContact(phone);
    if (!contact) return [];
    return this.prisma.call.findMany({
      where: { deletedAt: null, leadId: contact.id },
      select: {
        id: true,
        phone: true,
        startedAt: true,
        direction: true,
        outcome: true,
        duration: true,
      },
      orderBy: { startedAt: 'desc' },
    });
  }
}
