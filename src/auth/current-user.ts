import { UserRole } from '../generated/prisma/client';

/**
 * The identity every request is authorised against.
 *
 * Deliberately smaller than the User record: scoping needs who is asking and
 * what they may see, not their profile. Keeping it narrow stops feature code
 * reaching for fields that a token will not carry.
 *
 * `team` is the caller's team label (AUTH-02.1 / ADR-0030 §4) — the manager
 * team-scoping rule's one consumer. It travels as a signed access-token claim,
 * which the guard checks against the account on each request (SEC-04); `null`
 * when the user has no team. Optional
 * so the many `{ id, role }` literals in tests still type-check — production
 * requests always set it (value or null) via the guard.
 *
 * `deniedPipelines` are the pipelines closed to the caller (ADR-0093). Unlike `team` they are
 * never a token claim: `CurrentUserService.resolve()` reads them from the grants on each
 * request. Absent means none is closed, which is true of the admin and of every caller while
 * all pipelines are All users, so code that builds a CurrentUser for anyone else (a follow-up
 * assignee) must attach them with `withPipelineAccess`.
 */
export interface CurrentUser {
  id: string;
  role: UserRole;
  team?: string | null;
  deniedPipelines?: readonly string[];
}

/**
 * Resolves the caller for the request in flight.
 *
 * An abstract class rather than an interface so it can be a Nest injection
 * token: feature modules depend on this type, and AUTH-01.3 swaps in a
 * JWT-backed implementation by rebinding the provider. No Leads code changes.
 */
export abstract class CurrentUserService {
  abstract resolve(): Promise<CurrentUser>;
}
