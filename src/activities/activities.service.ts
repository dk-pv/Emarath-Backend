import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { GpsService, type CheckInVerification } from '../gps/gps.service';
import { leadScopeWhere } from '../leads/lead-scope';
import { activityScopeWhere } from './activity-scope';
import { activityBucketWhere, DayBoundaries } from './activity-buckets';
import { activityFilterWhere, activitySearchWhere } from './activity-filters';
import {
  activityDateWindowWhere,
  activityDueRangeWhere,
  type ActivityWindowEdges,
} from './activity-date-windows';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { ListActivitiesQueryDto } from './dto/list-activities-query.dto';
import {
  ACTIVITY_LIST_SELECT,
  ACTIVITY_SELECT,
  ActivityItem,
  ActivityListResponse,
  toActivityItem,
  toActivityListItem,
} from './dto/activity-response.dto';

const LEAD_OUT_OF_SCOPE = 'That lead does not exist or is not in your scope.';
const ACTIVITY_OUT_OF_SCOPE =
  'That activity does not exist or is not in your scope.';
/**
 * ACT-10.1: the message surfaced when a location-tied activity is completed
 * without a valid GPS check-in. Exported so the spec can assert against the
 * exact string without duplicating it.
 */
export const LOCATION_GATE_MESSAGE =
  'Check in on site to complete this activity.';

/**
 * The reason a location-tied completion was refused, phrased for the user (GPS-09.1
 * AC2). Distances are rounded to whole metres — a GPS fix is not precise enough for
 * decimals to mean anything, and "182 m" reads as a fact where "182.37 m" reads as a
 * machine talking.
 */
export function locationGateMessage(
  verdict: Extract<CheckInVerification, { ok: false }>,
): string {
  if (verdict.reason === 'TOO_FAR') {
    return `Your check-in was ${Math.round(verdict.meters)} m from ${verdict.locationName}, outside the ${verdict.radius} m required to complete this activity.`;
  }
  if (verdict.reason === 'NO_LOCATION') {
    return 'This activity is tied to a location that no longer exists. Ask an administrator to fix its location before completing it.';
  }
  return LOCATION_GATE_MESSAGE;
}

/**
 * Activity writes (ACT-03.1). Injects `PrismaService` directly — like the row
 * actions and view preferences — rather than a repository: create is one scoped
 * lookup plus one nested create, and a repository here would be the speculative
 * abstraction the standards forbid. Reads (ACT-02.1) can add one if they earn it.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly gps: GpsService,
  ) {}

  /**
   * The scoped worklist page for one tab (ACT-02.1).
   *
   * `where` = the caller's activity scope AND the tab's bucket predicate. The
   * page and its total run in one transaction (the Leads findPage rule) so a
   * concurrently-created activity can't make the count disagree with the page.
   * Every row carries its linked lead's list columns (the lead-joined
   * projection), and the response includes the five per-bucket counts for the
   * tab badges. Ordered by due date — Activities has no Sort control (ADR-0028).
   */
  async list(query: ListActivitiesQueryDto): Promise<ActivityListResponse> {
    const user = await this.currentUser.resolve();
    const boundaries: DayBoundaries = {
      todayStart: new Date(query.todayStart),
      todayEnd: new Date(query.todayEnd),
      tomorrowEnd: new Date(query.tomorrowEnd),
    };

    // Everything except the tab predicate — scope AND search AND field filters
    // (ACT-07.1). Shared by the page query and the tab counts, so a badge always
    // counts what the active search + filters would actually show (AC5).
    const base: Prisma.ActivityWhereInput[] = [activityScopeWhere(user)];
    const search = activitySearchWhere(query.search);
    if (search) base.push(search);
    base.push(
      ...activityFilterWhere({
        assignedAgent: query.assignedAgent,
        status: query.status,
        pipeline: query.pipeline,
        type: query.type,
      }),
    );

    // The filter popup's quick-date checkboxes and its explicit From/To range.
    // Both sit in `base`, so they narrow the tab counts too — a badge keeps
    // counting exactly what its tab would show under the active filters (AC5).
    const optional = (value: string | undefined) =>
      value === undefined ? undefined : new Date(value);
    const edges: ActivityWindowEdges = {
      ...boundaries,
      yesterdayStart: optional(query.yesterdayStart),
      weekStart: optional(query.weekStart),
      weekEnd: optional(query.weekEnd),
      monthStart: optional(query.monthStart),
      monthEnd: optional(query.monthEnd),
    };
    const windows = activityDateWindowWhere(query.dateWindow, edges);
    if (windows) base.push(windows);
    const dueRange = activityDueRangeWhere(
      optional(query.dueFrom),
      optional(query.dueTo),
    );
    if (dueRange) base.push(dueRange);

    const where: Prisma.ActivityWhereInput = {
      AND: [...base, activityBucketWhere(query.bucket, boundaries)],
    };

    const bucketCount = (bucket: Parameters<typeof activityBucketWhere>[0]) =>
      this.prisma.activity.count({
        where: { AND: [...base, activityBucketWhere(bucket, boundaries)] },
      });

    // One transaction, not two: the page, its total and the five tab counts all
    // read the same snapshot, and the request acquires a pooled connection once.
    // Splitting the counts into a second transaction doubled the acquisitions per
    // page load, which is what pushed concurrent callers past Prisma's transaction
    // maxWait and returned a 500 on a perfectly valid request.
    const [rows, total, overdue, today, tomorrow, completed, all] =
      await this.prisma.$transaction([
        this.prisma.activity.findMany({
          where,
          select: ACTIVITY_LIST_SELECT,
          // id breaks ties so a row can't swap pages between two same-due rows.
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        this.prisma.activity.count({ where }),
        bucketCount('overdue'),
        bucketCount('today'),
        bucketCount('tomorrow'),
        bucketCount('completed'),
        bucketCount('all'),
      ]);

    return {
      rows: rows.map(toActivityListItem),
      total,
      counts: { overdue, today, tomorrow, completed, all },
    };
  }

  /**
   * Marks a follow-up complete (ACT-04.1).
   *
   * Scoped first, so a caller can only complete an activity they can see — an
   * out-of-scope or missing id is a 404, never a cross-scope write. Idempotent:
   * an already-completed activity keeps its original `completedAt` (re-completing
   * is a no-op in outcome).
   *
   * ponytail: the location-tied completion gate (a 409 until a valid on-site GPS
   * check-in exists) is ACT-10.1 — it needs the GPS module, which isn't built.
   * The architecture ships non-location completion now and adds the gate when GPS
   * lands; building it now would permanently block location-tied activities with
   * no way to satisfy it.
   */
  async complete(id: string): Promise<ActivityItem> {
    const user = await this.currentUser.resolve();

    const activity = await this.prisma.activity.findFirst({
      where: { AND: [activityScopeWhere(user), { id }] },
      select: {
        id: true,
        completedAt: true,
        locationId: true,
        lead: { select: { name: true } },
      },
    });
    if (!activity) throw new NotFoundException(ACTIVITY_OUT_OF_SCOPE);

    /**
     * ACT-10.1 location gate (ADR-0027 dec 6, blueprint §1.8, §10).
     *
     * A location-tied activity (`locationId != null`) requires an on-site GPS
     * check-in before it can be marked complete. GPS-02.1 wires the real test:
     * the agent must have a check-in verifying this follow-up. When `locationId`
     * is null the branch is skipped and completion proceeds normally.
     *
     * GPS-09.1 completes the rule: `GpsService.verifyLocationCheckIn` measures the
     * agent's own check-in against the site's coordinates and returns the reason it
     * failed, which becomes the 409's message so the user is told whether they never
     * checked in or were too far away.
     */
    if (activity.locationId !== null) {
      const verdict = await this.gps.verifyLocationCheckIn(
        user.id,
        activity.id,
      );
      if (!verdict.ok)
        throw new ConflictException(locationGateMessage(verdict));
    }

    const updated = await this.prisma.activity.update({
      where: { id },
      data: { completedAt: activity.completedAt ?? new Date() },
      select: ACTIVITY_SELECT,
    });
    return toActivityItem(updated, activity.lead.name);
  }

  /**
   * Edits a follow-up (ACT-05.1). Scoped like complete — an out-of-scope id is a
   * 404, never a cross-scope write. The lead link is fixed (not editable). The
   * assignee set is replaced wholesale in the same update (`deleteMany` then
   * `create`), so the write is atomic and the desired set is exactly what the
   * form sent; a sales agent stays on their own activity (mirrors create).
   */
  async update(id: string, dto: UpdateActivityDto): Promise<ActivityItem> {
    const user = await this.currentUser.resolve();

    const dueAt = new Date(dto.dueAt);
    const endAt = dto.endAt ? new Date(dto.endAt) : null;
    this.assertTypeShape(dto.type, dueAt, endAt, dto.locationId);

    const activity = await this.prisma.activity.findFirst({
      where: { AND: [activityScopeWhere(user), { id }] },
      select: { id: true, lead: { select: { name: true } } },
    });
    if (!activity) throw new NotFoundException(ACTIVITY_OUT_OF_SCOPE);

    const assigneeIds = new Set(dto.assigneeIds);
    if (user.role === UserRole.SALES_AGENT) assigneeIds.add(user.id);

    try {
      const updated = await this.prisma.activity.update({
        where: { id },
        data: {
          type: dto.type,
          description: dto.description,
          dueAt,
          endAt,
          // `disconnect`, not `undefined`: an edit that drops the location must clear
          // it, which is what `locationId: null` did before the relation existed.
          location: dto.locationId
            ? { connect: { id: dto.locationId } }
            : { disconnect: true },
          assignees: {
            deleteMany: {},
            create: [...assigneeIds].map((userId) => ({
              user: { connect: { id: userId } },
            })),
          },
        },
        select: ACTIVITY_SELECT,
      });
      return toActivityItem(updated, activity.lead.name);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2025')
      ) {
        throw new BadRequestException('One or more assignees do not exist.');
      }
      throw error;
    }
  }

  /**
   * Soft-deletes a follow-up (ACT-06.1). Scoped like complete/update — an
   * out-of-scope or unknown id is a 404, never a cross-scope delete. Soft delete
   * only: the row is stamped `deletedAt` and retained (CLAUDE.md §11), so nothing
   * is destroyed. Idempotent — the include-deleted scope still finds a row this
   * caller already deleted, and a second delete keeps the original `deletedAt`
   * (a no-op in outcome), matching complete.
   */
  async delete(id: string): Promise<{ id: string }> {
    const user = await this.currentUser.resolve();

    const activity = await this.prisma.activity.findFirst({
      where: {
        AND: [activityScopeWhere(user, { includeDeleted: true }), { id }],
      },
      select: { id: true, deletedAt: true },
    });
    if (!activity) throw new NotFoundException(ACTIVITY_OUT_OF_SCOPE);

    if (!activity.deletedAt) {
      await this.prisma.activity.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    }
    return { id };
  }

  /**
   * Duplicates a follow-up (ACT-08.1 AC2). Scoped like the other row actions — an
   * out-of-scope or unknown id is a 404, never a cross-scope read. The copy is a
   * fresh, incomplete follow-up: every field is carried over (type, lead,
   * description, times, location, the assignee set) except completion, which
   * starts clear. Reuses the create nested-write shape; the source assignees came
   * from a row already in scope, so no foreign key can be invalid.
   */
  async duplicate(id: string): Promise<ActivityItem> {
    const user = await this.currentUser.resolve();

    const source = await this.prisma.activity.findFirst({
      where: { AND: [activityScopeWhere(user), { id }] },
      select: {
        type: true,
        description: true,
        dueAt: true,
        endAt: true,
        locationId: true,
        lead: { select: { id: true, name: true } },
        assignees: { select: { userId: true } },
      },
    });
    if (!source) throw new NotFoundException(ACTIVITY_OUT_OF_SCOPE);

    const created = await this.prisma.activity.create({
      data: {
        type: source.type,
        lead: { connect: { id: source.lead.id } },
        description: source.description,
        dueAt: source.dueAt,
        endAt: source.endAt,
        location: source.locationId
          ? { connect: { id: source.locationId } }
          : undefined,
        assignees: {
          create: source.assignees.map((a) => ({
            user: { connect: { id: a.userId } },
          })),
        },
      },
      select: ACTIVITY_SELECT,
    });
    return toActivityItem(created, source.lead.name);
  }

  /**
   * The type-conditional shape shared by create and edit (video / blueprint §9):
   * a Call carries neither an End Time nor a Location; an End Time must not
   * precede the Start Time.
   */
  private assertTypeShape(
    type: ActivityType,
    dueAt: Date,
    endAt: Date | null,
    locationId?: string,
  ): void {
    if (type === ActivityType.CALL) {
      if (endAt) throw new BadRequestException('A Call has no end time.');
      if (locationId) throw new BadRequestException('A Call has no location.');
    }
    if (endAt && endAt < dueAt) {
      throw new BadRequestException(
        'End time must be on or after the start time.',
      );
    }
  }

  /**
   * Creates a follow-up on a lead (ACT-03.1).
   *
   * The lead is read through the caller's scope first, so a follow-up can only
   * attach to a lead they can see (ADR-0028 §4) — its name is reused to derive
   * the title, so there is no second query. A sales agent only sees activities
   * they are assigned to, so the creator is auto-added when they would otherwise
   * be left off — mirroring the Leads create. The activity and its assignees are
   * one nested create (atomic), so a bad assignee leaves no half-built row.
   */
  async create(dto: CreateActivityDto): Promise<ActivityItem> {
    const user = await this.currentUser.resolve();

    const dueAt = new Date(dto.dueAt);
    const endAt = dto.endAt ? new Date(dto.endAt) : null;
    this.assertTypeShape(dto.type, dueAt, endAt, dto.locationId);

    const lead = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id: dto.leadId }] },
      select: { id: true, name: true },
    });
    if (!lead) throw new NotFoundException(LEAD_OUT_OF_SCOPE);

    const assigneeIds = new Set(dto.assigneeIds);
    if (user.role === UserRole.SALES_AGENT) assigneeIds.add(user.id);

    try {
      const activity = await this.prisma.activity.create({
        data: {
          type: dto.type,
          lead: { connect: { id: lead.id } },
          description: dto.description,
          dueAt,
          endAt,
          location: dto.locationId
            ? { connect: { id: dto.locationId } }
            : undefined,
          assignees: {
            create: [...assigneeIds].map((userId) => ({
              user: { connect: { id: userId } },
            })),
          },
        },
        select: ACTIVITY_SELECT,
      });
      return toActivityItem(activity, lead.name);
    } catch (error) {
      // A non-existent assignee fails the foreign key; report a 400, not a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2025')
      ) {
        throw new BadRequestException('One or more assignees do not exist.');
      }
      throw error;
    }
  }
}
