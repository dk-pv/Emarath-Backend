import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import type { GpsConfig } from '../config/gps.config';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { RecordLocationPointDto } from './dto/record-location-point.dto';
import { GpsSummaryFilterDto } from './dto/gps-summary-filter.dto';
import { distanceInMeters } from './geo-distance';
import { resolveGpsBounds } from './gps-period';
import { activityScopeWhere } from '../activities/activity-scope';
import { gpsAgentWhere } from './gps-scope';

/** A field visit as returned by the API; coordinates are plain numbers. */
export type CheckInRecord = {
  id: string;
  agentId: string;
  checkInAt: Date;
  checkInLat: number;
  checkInLng: number;
  checkOutAt: Date | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  activityId: string | null;
};

const CHECK_IN_SELECT = {
  id: true,
  agentId: true,
  checkInAt: true,
  checkInLat: true,
  checkInLng: true,
  checkOutAt: true,
  checkOutLat: true,
  checkOutLng: true,
  activityId: true,
} satisfies Prisma.CheckInSelect;

type CheckInRow = Prisma.CheckInGetPayload<{ select: typeof CHECK_IN_SELECT }>;

function toRecord(row: CheckInRow): CheckInRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    checkInAt: row.checkInAt,
    checkInLat: row.checkInLat.toNumber(),
    checkInLng: row.checkInLng.toNumber(),
    checkOutAt: row.checkOutAt,
    checkOutLat: row.checkOutLat === null ? null : row.checkOutLat.toNumber(),
    checkOutLng: row.checkOutLng === null ? null : row.checkOutLng.toNumber(),
    activityId: row.activityId,
  };
}

export type LocationPointRecord = {
  id: string;
  agentId: string;
  recordedAt: Date;
  lat: number;
  lng: number;
};

/** GPS-04.1: The 5 KPI counters for the GPS dashboard. */
export type GpsSummaryRecord = {
  totalCheckIns: number;
  totalCheckOuts: number;
  locationCheckIns: number;
  automaticTracking: number;
  followUpCompletions: number;
};

/** GPS-05.1: Unified pin record for the map. */
export type GpsPinType =
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'LOCATION_CHECK_IN'
  | 'AUTOMATIC_TRACKING'
  | 'FOLLOW_UP_COMPLETION';

export type GpsPinRecord = {
  id: string;
  type: GpsPinType;
  lat: number;
  lng: number;
  timestamp: Date;
  agentId: string;
  /** The agent's display name, so the list view (GPS-06.1) can show User Name. */
  agentName: string;
};

// ponytail: per-source cap keeps the map query bounded at 15k+ rows. Cross-source
// recency isn't globally exact (each source capped independently) — swap for a
// cursor/window if the map ever needs a strict global top-N.
const PIN_QUERY_LIMIT = 500;

const LOCATION_POINT_SELECT = {
  id: true,
  agentId: true,
  recordedAt: true,
  lat: true,
  lng: true,
} satisfies Prisma.LocationPointSelect;

type LocationPointRow = Prisma.LocationPointGetPayload<{
  select: typeof LOCATION_POINT_SELECT;
}>;

function toLocationPointRecord(row: LocationPointRow): LocationPointRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    recordedAt: row.recordedAt,
    lat: row.lat.toNumber(),
    lng: row.lng.toNumber(),
  };
}

/**
 * Field check-in / check-out (GPS-02.1). Each event is attributed to the
 * authenticated caller (AC4) — the agent is never taken from the body. A
 * check-in may reference the follow-up it verifies (`activityId`), which is how
 * a valid check-in satisfies the ACT-10.1 completion gate (AC3) via
 * `hasValidCheckIn`. Injects PrismaService + CurrentUserService directly, like
 * the Calls services.
 */
/**
 * Why a location-tied completion was refused, or the check-in that satisfied it.
 * `meters` is the nearest candidate's distance, so the caller can be specific.
 */
export type CheckInVerification =
  | { ok: true; checkInId: string; meters: number }
  | { ok: false; reason: 'NO_LOCATION' | 'NO_CHECK_IN' }
  | {
      ok: false;
      reason: 'TOO_FAR';
      meters: number;
      radius: number;
      locationName: string;
    };

@Injectable()
export class GpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly config: ConfigService,
  ) {}

  /** Record a check-in for the calling agent (AC1). */
  async checkIn(dto: CheckInDto): Promise<CheckInRecord> {
    const user = await this.currentUser.resolve();
    try {
      const row = await this.prisma.checkIn.create({
        data: {
          agentId: user.id,
          checkInAt: dto.at ? new Date(dto.at) : new Date(),
          checkInLat: dto.latitude,
          checkInLng: dto.longitude,
          activityId: dto.activityId ?? null,
        },
        select: CHECK_IN_SELECT,
      });
      return toRecord(row);
    } catch (error) {
      // A bad activityId FK is a client error, not a server fault.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException('That follow-up does not exist.');
      }
      throw error;
    }
  }

  /**
   * Record the matching check-out for one of the agent's open check-ins (AC2).
   * Only the caller's own, not-yet-closed check-in can be closed — anything else
   * is a 404 rather than a cross-agent write.
   */
  async checkOut(id: string, dto: CheckOutDto): Promise<CheckInRecord> {
    const user = await this.currentUser.resolve();
    const open = await this.prisma.checkIn.findFirst({
      where: { id, agentId: user.id, deletedAt: null, checkOutAt: null },
      select: { id: true },
    });
    if (!open) {
      throw new NotFoundException('No open check-in to check out from.');
    }
    const row = await this.prisma.checkIn.update({
      where: { id },
      data: {
        checkOutAt: dto.at ? new Date(dto.at) : new Date(),
        checkOutLat: dto.latitude,
        checkOutLng: dto.longitude,
      },
      select: CHECK_IN_SELECT,
    });
    return toRecord(row);
  }

  /**
   * Verifies that a location-tied follow-up may be completed (GPS-09.1).
   *
   * This is the whole gate. The Activities service calls it and throws on a
   * failure; the rule lives here, in the module that owns check-ins and
   * coordinates, so there is one implementation and the UI cannot go around it —
   * completion is a server operation and the check runs inside it.
   *
   * A check-in is valid when it is **the agent's own**, **linked to this
   * follow-up**, not soft-deleted, and **within the site's radius**. The first two
   * are expressed in the query, so another agent's check-in is not merely rejected
   * later — it is never a candidate. Distance is measured against the site the
   * follow-up is tied to, using the site's own `radiusMeters` when it sets one and
   * the configured default otherwise.
   *
   * Returns the nearest candidate's distance on failure so the caller can say how
   * far away the agent actually was, rather than a bare "not allowed".
   */
  async verifyLocationCheckIn(
    agentId: string,
    activityId: string,
  ): Promise<CheckInVerification> {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: {
        location: {
          select: {
            id: true,
            name: true,
            lat: true,
            lng: true,
            radiusMeters: true,
          },
        },
      },
    });

    // A follow-up whose `locationId` points at no site cannot be verified against
    // anything. Failing closed is the only safe answer for a gate.
    const site = activity?.location;
    if (!site) return { ok: false, reason: 'NO_LOCATION' };

    const candidates = await this.prisma.checkIn.findMany({
      where: { agentId, activityId, deletedAt: null },
      select: { id: true, checkInLat: true, checkInLng: true },
    });
    if (candidates.length === 0) return { ok: false, reason: 'NO_CHECK_IN' };

    const radius =
      site.radiusMeters ??
      this.config.getOrThrow<GpsConfig>('gps').checkInRadiusMeters;
    const centre = { lat: site.lat.toNumber(), lng: site.lng.toNumber() };

    let nearest: { id: string; meters: number } | null = null;
    for (const candidate of candidates) {
      const meters = distanceInMeters(centre, {
        lat: candidate.checkInLat.toNumber(),
        lng: candidate.checkInLng.toNumber(),
      });
      if (!nearest || meters < nearest.meters) {
        nearest = { id: candidate.id, meters };
      }
    }

    // `nearest` is non-null: `candidates` was checked for emptiness above.
    if (nearest!.meters <= radius) {
      return { ok: true, checkInId: nearest!.id, meters: nearest!.meters };
    }
    return {
      ok: false,
      reason: 'TOO_FAR',
      meters: nearest!.meters,
      radius,
      locationName: site.name,
    };
  }

  /**
   * Back-compat shim for the ACT-10.1 gate's boolean call site.
   * Prefer {@link verifyLocationCheckIn}, which carries the reason.
   */
  async hasValidCheckIn(agentId: string, activityId: string): Promise<boolean> {
    return (await this.verifyLocationCheckIn(agentId, activityId)).ok;
  }

  /**
   * Record a passive tracking point for the calling agent (GPS-03.1).
   * Append-only telemetry — no soft-delete, no activityId tie. The agent is
   * the authenticated caller (same attribution as checkIn). `at` defaults to
   * now unless the device supplies a captured timestamp.
   */
  async recordPoint(dto: RecordLocationPointDto): Promise<LocationPointRecord> {
    const user = await this.currentUser.resolve();
    const row = await this.prisma.locationPoint.create({
      data: {
        agentId: user.id,
        recordedAt: dto.at ? new Date(dto.at) : new Date(),
        lat: dto.latitude,
        lng: dto.longitude,
      },
      select: LOCATION_POINT_SELECT,
    });
    return toLocationPointRecord(row);
  }

  /**
   * Calculate field-activity summary counters for the selected period (GPS-04.1).
   * Figures are scoped to the requesting user's role.
   */
  async getSummary(dto: GpsSummaryFilterDto): Promise<GpsSummaryRecord> {
    const user = await this.currentUser.resolve();

    // 1. Scope by role (AUTH-02.1, ADR-0030 §6): agent → self, manager → team, admin/others
    // → all. The dashboard's userId filter is intersected with scope, never allowed to widen
    // it. `assigneeNarrow` applies the same optional userId narrowing to the activity count,
    // AND-ed with the team scope so it can never override it.
    const agentWhere = gpsAgentWhere(user, dto.userId);
    const assigneeNarrow: Prisma.ActivityWhereInput =
      dto.userId && user.role !== UserRole.SALES_AGENT
        ? { assignees: { some: { userId: dto.userId } } }
        : {};

    // 2. Build time bounds (validated: rejects an inverted or oversized window)
    const { from, to } = resolveGpsBounds(dto);

    // Build common where conditions
    const checkInTimeFilter = from || to ? { gte: from, lte: to } : undefined;
    const checkOutTimeFilter = from || to ? { gte: from, lte: to } : undefined;
    const recordedTimeFilter = from || to ? { gte: from, lte: to } : undefined;
    const completedTimeFilter = from || to ? { gte: from, lte: to } : undefined;

    // 3. Execute counts concurrently
    const [
      totalCheckIns,
      totalCheckOuts,
      locationCheckIns,
      automaticTracking,
      followUpCompletions,
    ] = await Promise.all([
      // Total Check-ins
      this.prisma.checkIn.count({
        where: {
          agent: agentWhere,
          deletedAt: null,
          checkInAt: checkInTimeFilter,
        },
      }),

      // Total Check-outs: only rows that were actually checked out. Without a
      // period the range filter is undefined, so fall back to "checked out at all"
      // rather than counting every (still-open) check-in.
      this.prisma.checkIn.count({
        where: {
          agent: agentWhere,
          deletedAt: null,
          checkOutAt: checkOutTimeFilter ?? { not: null },
        },
      }),

      // Location Check-Ins (tied to an activity)
      this.prisma.checkIn.count({
        where: {
          agent: agentWhere,
          deletedAt: null,
          checkInAt: checkInTimeFilter,
          activityId: { not: null },
        },
      }),

      // Automatic Tracking (location points)
      this.prisma.locationPoint.count({
        where: {
          agent: agentWhere,
          recordedAt: recordedTimeFilter,
        },
      }),

      // Follow-up Completions. AND-ed (not spread) so the optional userId narrowing
      // intersects the team scope from activityScopeWhere instead of overriding its
      // `assignees` predicate.
      this.prisma.activity.count({
        where: {
          AND: [
            activityScopeWhere(user),
            assigneeNarrow,
            {
              completedAt: completedTimeFilter
                ? completedTimeFilter
                : { not: null },
            },
          ],
        },
      }),
    ]);

    return {
      totalCheckIns,
      totalCheckOuts,
      locationCheckIns,
      automaticTracking,
      followUpCompletions,
    };
  }

  /**
   * GPS-05.1: Fetch coordinate pins for the map based on filters.
   * Returns a unified array of pins for all 5 KPI types.
   * Follow-up completions without check-ins are excluded since they lack coordinates.
   */
  async getLocations(dto: GpsSummaryFilterDto): Promise<GpsPinRecord[]> {
    const user = await this.currentUser.resolve();

    const agentWhere = gpsAgentWhere(user, dto.userId);
    const assigneeNarrow: Prisma.ActivityWhereInput =
      dto.userId && user.role !== UserRole.SALES_AGENT
        ? { assignees: { some: { userId: dto.userId } } }
        : {};

    const { from, to } = resolveGpsBounds(dto);

    const timeFilter = from || to ? { gte: from, lte: to } : undefined;

    const [checkIns, points, activities] = await Promise.all([
      // Fetch check-ins for CHECK_IN, LOCATION_CHECK_IN, and CHECK_OUT pins
      this.prisma.checkIn.findMany({
        where: {
          agent: agentWhere,
          deletedAt: null,
          OR: [{ checkInAt: timeFilter }, { checkOutAt: timeFilter }],
        },
        select: CHECK_IN_SELECT,
        orderBy: { checkInAt: 'desc' },
        take: PIN_QUERY_LIMIT,
      }),

      // Fetch automatic tracking points
      this.prisma.locationPoint.findMany({
        where: {
          agent: agentWhere,
          recordedAt: timeFilter,
        },
        select: LOCATION_POINT_SELECT,
        orderBy: { recordedAt: 'desc' },
        take: PIN_QUERY_LIMIT,
      }),

      // Fetch completed activities and their check-in coordinates. AND-ed so the userId
      // narrowing intersects (never overrides) the team scope from activityScopeWhere.
      this.prisma.activity.findMany({
        where: {
          AND: [
            activityScopeWhere(user),
            assigneeNarrow,
            { completedAt: timeFilter ? timeFilter : { not: null } },
          ],
        },
        select: {
          id: true,
          completedAt: true,
          checkIns: {
            // Scope to the visible agent(s) so a shared follow-up never pins a
            // co-assignee's coordinates to the caller.
            where: { deletedAt: null, agent: agentWhere },
            select: { checkInLat: true, checkInLng: true, agentId: true },
            take: 1, // Only need one set of coordinates to pin it
          },
        },
        orderBy: { completedAt: 'desc' },
        take: PIN_QUERY_LIMIT,
      }),
    ]);

    const pins: Omit<GpsPinRecord, 'agentName'>[] = [];

    for (const c of checkIns) {
      // Is check-in in range?
      const inRange =
        !timeFilter ||
        (c.checkInAt >= (timeFilter.gte ?? new Date(0)) &&
          c.checkInAt <= (timeFilter.lte ?? new Date(8640000000000000)));

      if (inRange) {
        pins.push({
          id: `in-${c.id}`,
          type: c.activityId ? 'LOCATION_CHECK_IN' : 'CHECK_IN',
          lat: c.checkInLat.toNumber(),
          lng: c.checkInLng.toNumber(),
          timestamp: c.checkInAt,
          agentId: c.agentId,
        });
      }

      // Is check-out in range?
      if (c.checkOutAt && c.checkOutLat && c.checkOutLng) {
        const outRange =
          !timeFilter ||
          (c.checkOutAt >= (timeFilter.gte ?? new Date(0)) &&
            c.checkOutAt <= (timeFilter.lte ?? new Date(8640000000000000)));

        if (outRange) {
          pins.push({
            id: `out-${c.id}`,
            type: 'CHECK_OUT',
            lat: c.checkOutLat.toNumber(),
            lng: c.checkOutLng.toNumber(),
            timestamp: c.checkOutAt,
            agentId: c.agentId,
          });
        }
      }
    }

    for (const p of points) {
      pins.push({
        id: `trk-${p.id}`,
        type: 'AUTOMATIC_TRACKING',
        lat: p.lat.toNumber(),
        lng: p.lng.toNumber(),
        timestamp: p.recordedAt,
        agentId: p.agentId,
      });
    }

    for (const act of activities) {
      if (act.completedAt && act.checkIns.length > 0) {
        pins.push({
          id: `act-${act.id}`,
          type: 'FOLLOW_UP_COMPLETION',
          lat: act.checkIns[0].checkInLat.toNumber(),
          lng: act.checkIns[0].checkInLng.toNumber(),
          timestamp: act.completedAt,
          agentId: act.checkIns[0].agentId,
        });
      }
    }

    // Resolve agent display names in one query (same pattern as the leaderboard)
    // so the list view (GPS-06.1) gets a User Name column without a new endpoint.
    const agentIds = [...new Set(pins.map((p) => p.agentId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true },
    });
    const nameByAgent = new Map(users.map((u) => [u.id, u.name]));

    // Sort by timestamp descending
    pins.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return pins.map((p) => ({
      ...p,
      agentName: nameByAgent.get(p.agentId) ?? 'Unknown',
    }));
  }
}
