import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { type DayBoundaries } from '../activities/activity-buckets';
import { leadScopeWhere } from './lead-scope';
import { leadSearchWhere } from './lead-search';
import { leadFilterWhere } from './lead-filter';
import { leadConditionWhere, parseLeadConditions } from './lead-conditions';

/**
 * The inputs the list and the export share: the archived flag (scope predicate),
 * free-text search, and the field/quick filters. A subset of `ListLeadsQueryDto`,
 * so that DTO is assignable to it and the export DTO — which extends it — is too.
 */
export interface LeadWhereQuery {
  archived?: boolean;
  search?: string;
  /** The advanced filter builder's JSON conditions (ADR-0039), parsed here. */
  conditions?: string;
  source?: string[];
  status?: string[];
  assignedAgent?: string[];
  tag?: string[];
  pipeline?: string;
  createdFrom?: string;
  createdTo?: string;
  unassigned?: boolean;
  /** LEAD-04.1 activity presets and the client's day boundaries (ISO instants). */
  todaysFollowUps?: boolean;
  overdue?: boolean;
  noActivity?: boolean;
  todayStart?: string;
  todayEnd?: string;
  tomorrowEnd?: string;
}

/**
 * The one scoped `where` every lead read composes (LEAD-02.1/03.x): role scope
 * (plus the archived predicate), then search, then each active filter — ANDed so
 * no fragment can widen another's reach.
 *
 * Extracted so the list and the export (LEAD-08.1) build the identical query from
 * one place: an export must return exactly the rows the on-screen list would, and
 * must never leak a lead outside the caller's scope (AC1/AC2). Drift between two
 * copies is precisely the bug this prevents.
 */
export function buildLeadWhere(
  user: CurrentUser,
  query: LeadWhereQuery,
): Prisma.LeadWhereInput {
  const conditions: Prisma.LeadWhereInput[] = [
    leadScopeWhere(user, query.archived),
  ];

  const search = leadSearchWhere(query.search);
  if (search) conditions.push(search);

  // Advanced filter builder (ADR-0039) — each parsed, whitelisted condition becomes
  // one scoped fragment, ANDed with scope/search like the simple filters below.
  conditions.push(...leadConditionWhere(parseLeadConditions(query.conditions)));

  // The client's timezone day boundaries (LEAD-04.1 activity presets), present only
  // when a Today's-Follow-Ups / Overdue preset is active; passed to the reused
  // `activityBucketWhere` as the exact instants the Activities worklist compares to.
  const dayBoundaries: DayBoundaries | undefined =
    query.todayStart && query.todayEnd && query.tomorrowEnd
      ? {
          todayStart: new Date(query.todayStart),
          todayEnd: new Date(query.todayEnd),
          tomorrowEnd: new Date(query.tomorrowEnd),
        }
      : undefined;

  conditions.push(
    ...leadFilterWhere({
      source: query.source,
      status: query.status,
      assignedAgent: query.assignedAgent,
      tag: query.tag,
      pipeline: query.pipeline,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
      unassigned: query.unassigned,
      todaysFollowUps: query.todaysFollowUps,
      overdue: query.overdue,
      noActivity: query.noActivity,
      dayBoundaries,
    }),
  );

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
