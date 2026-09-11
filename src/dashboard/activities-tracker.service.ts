import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import {
  activityBucketWhere,
  type DayBoundaries,
} from '../activities/activity-buckets';
import {
  activityDateWindowWhere,
  type ActivityWindowEdges,
} from '../activities/activity-date-windows';
import { resolveOverdueRule } from '../activities/activity-overdue-rule';
import { activityScopeWhere } from '../activities/activity-scope';
import {
  ACTIVITY_LIST_SELECT,
  type ActivityListItem,
  toActivityListItem,
} from '../activities/dto/activity-response.dto';
import { avatarUrlsByUser } from './dashboard-agents';
import { ActivitiesTrackerQueryDto } from './dto/activities-tracker-query.dto';

/**
 * The four cards on the Dashboard's Activities tracker, in the reference's order
 * (dashboard-quick-add-plus-menu-open.png).
 *
 * Deliberately NOT `ACTIVITY_BUCKETS`: the Activities page's five tabs are
 * Overdue/Today/Tomorrow/Completed/All, while this widget shows
 * Overdue/Today/Tomorrow/This Month. Three names overlap and mean the same thing —
 * they resolve through the same predicate — but the sets differ, which is why this
 * has its own list rather than widening the worklist's.
 */
export const ACTIVITY_TRACKER_GROUPS = [
  'overdue',
  'today',
  'tomorrow',
  'thisMonth',
] as const;

export type ActivityTrackerGroup = (typeof ACTIVITY_TRACKER_GROUPS)[number];

export interface ActivitiesTrackerResponse {
  counts: Record<ActivityTrackerGroup, number>;
  /**
   * The worklist row shape, unchanged. The Dashboard table renders a five-column
   * subset of it and reuses the Activities row actions, both of which read this
   * exact type — a narrower Dashboard-only row would fork them.
   */
  rows: ActivityListItem[];
  /**
   * Signed avatar URLs for the assignees on this page, keyed by user id.
   *
   * Carried beside the rows rather than inside them: `ActivityListItem` is the
   * worklist's shape, shared with the Activities page and its row actions, and
   * widening it for one Dashboard column would fork that contract. A user with no
   * photo maps to null, which the reference draws as the grey silhouette.
   */
  avatars: Record<string, string | null>;
  /** Rows in the SELECTED group, role-scoped — the pager's denominator. */
  total: number;
}

/**
 * The Dashboard's Activities tracker (DASH-09.2).
 *
 * **Not one new business rule.** Overdue/Today/Tomorrow are `activityBucketWhere`,
 * the Activities worklist's own tab predicates, applied under the same configured
 * overdue rule (`resolveOverdueRule`) — so a card here and the tab badge on the
 * Activities page count the same rows. "This Month" is `activityDateWindowWhere`,
 * the filter popup's own quick-date window, which is a pure due-date range: it
 * counts everything due this month, open or completed, exactly as that checkbox
 * does.
 *
 * Role scope arrives inside `activityScopeWhere`, at the query, so an agent's cards
 * and table can only ever hold their own follow-ups.
 */
@Injectable()
export class ActivitiesTrackerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  async getActivities(
    query: ActivitiesTrackerQueryDto,
  ): Promise<ActivitiesTrackerResponse> {
    const user = await this.currentUser.resolve();

    const boundaries: DayBoundaries = {
      todayStart: new Date(query.todayStart),
      todayEnd: new Date(query.todayEnd),
      tomorrowEnd: new Date(query.tomorrowEnd),
    };
    const edges: ActivityWindowEdges = {
      ...boundaries,
      monthStart: new Date(query.monthStart),
      monthEnd: new Date(query.monthEnd),
    };

    const rule = await resolveOverdueRule(this.settings);
    const scope = activityScopeWhere(user);

    const groupWhere = (
      group: ActivityTrackerGroup,
    ): Prisma.ActivityWhereInput => {
      if (group !== 'thisMonth') {
        return { AND: [scope, activityBucketWhere(group, boundaries, rule)] };
      }
      // The DTO requires both month edges, so this window is always a predicate;
      // it is pushed the same way the worklist pushes its own windows.
      const window = activityDateWindowWhere(['thisMonth'], edges);
      return { AND: window ? [scope, window] : [scope] };
    };

    const selected = groupWhere(query.group);

    // All four counts plus the selected page and its total in ONE transaction: the
    // cards and the table read the same snapshot, so a card can never disagree with
    // the list it opens (the Leads findPage rule).
    const [overdue, today, tomorrow, thisMonth, rows, total] =
      await this.prisma.$transaction([
        this.prisma.activity.count({ where: groupWhere('overdue') }),
        this.prisma.activity.count({ where: groupWhere('today') }),
        this.prisma.activity.count({ where: groupWhere('tomorrow') }),
        this.prisma.activity.count({ where: groupWhere('thisMonth') }),
        this.prisma.activity.findMany({
          where: selected,
          select: ACTIVITY_LIST_SELECT,
          // The worklist's own order, so the two screens list a bucket alike; `id`
          // breaks ties so a row never repeats or vanishes between pages.
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        this.prisma.activity.count({ where: selected }),
      ]);

    const avatars = await avatarUrlsByUser(this.prisma, this.storage, [
      ...new Set(
        rows.flatMap((row) => row.assignees.map(({ user }) => user.id)),
      ),
    ]);

    return {
      counts: { overdue, today, tomorrow, thisMonth },
      rows: rows.map(toActivityListItem),
      avatars: Object.fromEntries(avatars),
      total,
    };
  }
}
