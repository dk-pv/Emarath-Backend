import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  activityAgentWhere,
  allCallsWhere,
  callAgentWhere,
  hotLeadsWhere,
  inboundCallsWhere,
  KPI_KEYS,
  leadAgentWhere,
  lostLeadsWhere,
  outboundCallsWhere,
  overdueFollowUpsWhere,
  QUALIFIED_LEADS_PENDING,
  todaysFollowUpsWhere,
  todaysLeadsWhere,
  wonLeadsWhere,
  type KpiCounter,
  type KpiKey,
  type KpiPeriod,
} from './dashboard-kpis';
import { DashboardKpisQueryDto } from './dto/dashboard-kpis-query.dto';

/** Only the counters that were asked for; every counter when none were named (AC1). */
export type DashboardKpis = Partial<Record<KpiKey, KpiCounter>>;

const ok = (value: number): KpiCounter => ({ value, status: 'ok' });

/**
 * The top-of-dashboard counters (DASH-02.1).
 *
 * Every figure is a `count` over the scoped query fragments in `dashboard-kpis.ts`
 * — which are themselves composed from the Leads, Activities and Calls modules'
 * own helpers, so no business rule is restated here and the dashboard can never
 * drift from the module it is counting. Role scoping is applied inside those
 * fragments, at the query, so an agent's counters can only ever include their own
 * rows (AC3). A period with no matching rows counts 0 (AC5); nothing here can
 * throw on an empty result.
 */
@Injectable()
export class DashboardKpisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async getKpis(query: DashboardKpisQueryDto): Promise<DashboardKpis> {
    const user = await this.currentUser.resolve();
    const period = this.resolvePeriod(query);
    const wanted = query.counters?.length ? query.counters : [...KPI_KEYS];

    // Only the requested counters are computed, and they run concurrently — six
    // independently-filtered cards each ask for one, rather than six full sweeps.
    const entries = await Promise.all(
      wanted.map(async (key): Promise<[KpiKey, KpiCounter]> => [
        key,
        await this.count(key, user, period, query.agent),
      ]),
    );

    return Object.fromEntries(entries);
  }

  private async count(
    key: KpiKey,
    user: CurrentUser,
    period: KpiPeriod,
    agents: string[] | undefined,
  ): Promise<KpiCounter> {
    // The Sales Agent selection, ANDed onto each already-scoped fragment: it narrows, never widens.
    const leads = (where: Prisma.LeadWhereInput) =>
      this.prisma.lead.count({
        where: agents?.length
          ? { AND: [where, leadAgentWhere(agents)] }
          : where,
      });
    const activities = (where: Prisma.ActivityWhereInput) =>
      this.prisma.activity.count({
        where: agents?.length
          ? { AND: [where, activityAgentWhere(agents)] }
          : where,
      });
    const calls = (where: Prisma.CallWhereInput) =>
      this.prisma.call.count({
        where: agents?.length
          ? { AND: [where, callAgentWhere(agents)] }
          : where,
      });

    switch (key) {
      case 'overdueFollowUps':
        return ok(await activities(overdueFollowUpsWhere(user, period)));
      case 'todaysFollowUps':
        return ok(await activities(todaysFollowUpsWhere(user, period)));
      case 'todaysLeads':
        return ok(await leads(todaysLeadsWhere(user, period)));
      case 'hotLeads':
        return ok(await leads(hotLeadsWhere(user, period)));
      case 'wonLeads':
        return ok(await leads(wonLeadsWhere(user, period)));
      case 'lostLeads':
        return ok(await leads(lostLeadsWhere(user, period)));
      case 'outboundCalls':
        return ok(await calls(outboundCallsWhere(user, period)));
      case 'inboundCalls':
        return ok(await calls(inboundCallsWhere(user, period)));
      case 'callsToday':
        return ok(await calls(allCallsWhere(user, period)));
      // Never counted, never guessed — see QUALIFIED_LEADS_PENDING.
      case 'qualifiedLeads':
        return QUALIFIED_LEADS_PENDING;
    }
  }

  /**
   * The one place `from`/`to` become a window, so an inverted range is rejected
   * here rather than silently counting zero in five different queries.
   */
  private resolvePeriod(query: DashboardKpisQueryDto): KpiPeriod {
    if (
      query.from &&
      query.to &&
      new Date(query.to).getTime() < new Date(query.from).getTime()
    ) {
      throw new BadRequestException('to must be on or after from');
    }
    return { todayStart: query.todayStart, from: query.from, to: query.to };
  }
}
