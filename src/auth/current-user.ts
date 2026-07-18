import { UserRole } from '../generated/prisma/client';

/**
 * The identity every request is authorised against.
 *
 * Deliberately smaller than the User record: scoping needs who is asking and
 * what they may see, not their profile. Keeping it narrow stops feature code
 * reaching for fields that a token will not carry.
 *
 * `team` is absent on purpose. Users have one (AUTH-01.1), but no rule reads it
 * yet — team-based narrowing for managers is explicitly deferred — and a field
 * nothing consumes invites scoping code to be written against a value that has
 * never been populated or tested. It arrives with the rule that needs it.
 */
export interface CurrentUser {
  id: string;
  role: UserRole;
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
