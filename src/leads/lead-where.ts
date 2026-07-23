import { Prisma } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { leadScopeWhere } from './lead-scope';
import { leadSearchWhere } from './lead-search';
import { leadFilterWhere } from './lead-filter';

/**
 * The inputs the list and the export share: the archived flag (scope predicate),
 * free-text search, and the field/quick filters. A subset of `ListLeadsQueryDto`,
 * so that DTO is assignable to it and the export DTO — which extends it — is too.
 */
export interface LeadWhereQuery {
  archived?: boolean;
  search?: string;
  source?: string[];
  status?: string[];
  assignedAgent?: string[];
  tag?: string[];
  pipeline?: string;
  createdFrom?: string;
  createdTo?: string;
  unassigned?: boolean;
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
    }),
  );

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}
