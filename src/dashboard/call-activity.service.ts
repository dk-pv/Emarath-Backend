import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CallLeaderboardService } from '../calls/call-leaderboard.service';
import { avatarUrlsByUser } from './dashboard-agents';
import {
  CallActivityQueryDto,
  DEFAULT_PAGE_SIZE,
} from './dto/call-activity-query.dto';

/** One row of the Dashboard's Call Activity Board (DASH-05.1). */
export interface CallActivityRow {
  agentId: string;
  agentName: string;
  avatarUrl: string | null;
  totalCalls: number;
  uniqueCalls: number;
  answeredCalls: number;
  callMinutes: number;
  averageCallTime: number;
}

/** One page of the board plus the role-scoped agent count (DASH-05.2). */
export interface CallActivityPage {
  rows: CallActivityRow[];
  total: number;
}

/**
 * The Dashboard's Call Activity Board (DASH-05.1 / DASH-05.2).
 *
 * Deliberately thin: every figure comes from `CallLeaderboardService`, the Call
 * Dashboard's own aggregation, so this board **cannot** report a different number
 * from the dedicated Call Dashboard for the same agent and period (AC3/AC4). Role
 * scoping and the period window are applied inside that service, at the query.
 *
 * All this adds is the member photo the Workpex board shows beside each name, the
 * projection down to the five columns the board actually has, and the page.
 *
 * **Paging is applied to the grouped result, not pushed into the query.** That is a
 * deliberate trade, and it is safe here for two reasons that do not hold for a
 * lead-sized list:
 *
 *   • The aggregation is one row per agent with activity in the period — roster
 *     sized. `CallLeaderboardService` builds it from four `groupBy` calls and
 *     assembles the per-agent metrics in memory, so LIMIT/OFFSET has nothing to
 *     attach to without a second, SQL-level copy of the Connect %, Call Minutes and
 *     AVG Call Time rules — which is exactly what AC3 forbids.
 *   • `total` is the length of that same scoped result, read from the same call that
 *     produced the rows, so the count can never describe a different snapshot than
 *     the page (what the Leads `findPage` transaction buys a two-query list). It is
 *     role-scoped for free, because the scope lives in the aggregation.
 *
 * What the browser receives is still one page: only the page's agents are looked up
 * and only their avatar links are signed.
 */
@Injectable()
export class CallActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly callLeaderboard: CallLeaderboardService,
  ) {}

  async getCallActivity(
    query: CallActivityQueryDto,
  ): Promise<CallActivityPage> {
    const entries = await this.callLeaderboard.getLeaderboard({
      from: query.from,
      to: query.to,
    });

    const size = query.size ?? DEFAULT_PAGE_SIZE;
    const start = ((query.page ?? 1) - 1) * size;
    const page = entries.slice(start, start + size);
    if (page.length === 0) return { rows: [], total: entries.length };

    const avatars = await avatarUrlsByUser(
      this.prisma,
      this.storage,
      page.map((entry) => entry.agentId),
    );

    return {
      rows: page.map((entry) => ({
        agentId: entry.agentId,
        agentName: entry.agentName,
        avatarUrl: avatars.get(entry.agentId) ?? null,
        totalCalls: entry.totalCalls,
        uniqueCalls: entry.uniqueCalls,
        answeredCalls: entry.answeredCalls,
        callMinutes: entry.callMinutes,
        averageCallTime: entry.averageCallTime,
      })),
      total: entries.length,
    };
  }
}
