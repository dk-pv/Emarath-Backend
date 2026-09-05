import { Injectable, Logger } from '@nestjs/common';
import {
  AssignmentApplyTo,
  AssignmentRuleStatus,
  AssignmentTarget,
  UserRole,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** The same three roles the New Lead form offers as assignees (LEAD-06.2). */
const ASSIGNABLE_ROLES: UserRole[] = [
  UserRole.SALES_AGENT,
  UserRole.SALES_MANAGER,
  UserRole.CUSTOMER_SERVICE_AGENT,
];

/**
 * Automatic lead assignment — the thing Settings → Assignment actually switches on.
 *
 * The engine deliberately does only what the reference's own vocabulary describes. Its
 * step 2 offers exactly one condition ("All Records") and one target ("All Users"), and
 * its step 1 offers exactly one algorithm (Round Robin), so that is the whole of the
 * logic: when automatic assigning is on and an active rule has a group applying to all
 * records and targeting all users, the next agent in rotation receives the lead. No other
 * condition is invented, because no capture shows one (CLAUDE.md §16.1).
 *
 * Round robin is derived rather than stored. "Next in rotation" is the eligible user whose
 * most recent assignment is oldest — a user who has never been assigned comes first. That
 * is the same sequence a stored cursor would produce, without a counter that can drift out
 * of step with the assignments actually in the table, and it self-corrects when agents are
 * added or removed.
 */
@Injectable()
export class LeadAssignmentEngine {
  private readonly logger = new Logger(LeadAssignmentEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The user a newly created lead should go to, or `null` when nothing applies.
   *
   * Never throws: a lead must still be created if the assignment configuration cannot be
   * read. A failure is logged and the lead is left unassigned, which is exactly the state
   * it would have had before this feature existed.
   */
  async pickAssignee(): Promise<string | null> {
    try {
      const config = await this.settings.getAssignmentGeneral();
      if (!config.automaticLeadAssigning) return null;

      const rule = await this.prisma.assignmentRule.findFirst({
        where: { deletedAt: null, status: AssignmentRuleStatus.ACTIVE },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          groups: {
            select: { applyTo: true, target: true },
            orderBy: { position: 'asc' },
          },
        },
      });
      if (!rule) return null;

      const applies = rule.groups.some(
        (group) =>
          group.applyTo === AssignmentApplyTo.ALL_RECORDS &&
          group.target === AssignmentTarget.ALL_USERS,
      );
      if (!applies) return null;

      return await this.nextInRotation(config.checkUserLoggedInBeforeAssigning);
    } catch (error) {
      this.logger.error(
        `Automatic assignment skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  /**
   * The eligible user whose most recent assignment is oldest.
   *
   * Inactive and deleted accounts are never eligible — a lead handed to a disabled account
   * is a lead nobody works. When the setting asks, accounts that have never signed in are
   * excluded too, which is what "Check if User has Logged in Before Assigning" means.
   */
  private async nextInRotation(requireLogin: boolean): Promise<string | null> {
    const candidates = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { in: ASSIGNABLE_ROLES },
        ...(requireLogin ? { lastLoginAt: { not: null } } : {}),
      },
      select: {
        id: true,
        name: true,
        assignments: {
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    if (candidates.length === 0) return null;

    // Never assigned wins outright; otherwise the oldest last-assignment. The name order
    // above breaks ties, so the rotation is stable rather than whatever the DB returns.
    const next = candidates.reduce((best, candidate) => {
      const bestAt = best.assignments[0]?.createdAt ?? null;
      const candidateAt = candidate.assignments[0]?.createdAt ?? null;
      if (bestAt === null) return best;
      if (candidateAt === null) return candidate;
      return candidateAt < bestAt ? candidate : best;
    });

    return next.id;
  }
}
