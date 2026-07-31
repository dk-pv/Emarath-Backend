import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';

/** Metadata key carrying the roles allowed to reach a route (or controller). */
export const ROLES_KEY = 'auth:roles';

/**
 * Restricts a route or controller to the listed roles (AUTH-02.2). Read by RolesGuard,
 * which runs after JwtAuthGuard so the caller is already known. A route with no @Roles()
 * is reachable by any authenticated user — role gates are added only where a verb must be
 * denied by role (e.g. lead reassignment: managers and admins only), so hiding an action
 * in the UI is backed by a real server-side block (AC4).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
