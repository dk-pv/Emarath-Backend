import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user';
import { recordAuditEvents, userActor } from '../audit/audit-events';
import { IntegrationResponse } from './dto/integration.dto';

const INTEGRATION_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  category: true,
  logo: true,
  enabled: true,
  detailUrl: true,
  position: true,
} satisfies Prisma.IntegrationSelect;

/**
 * The integration library registry (INT-01.1, ADR-0054) — the one place the library's
 * cards, their provider/category tags and the enabled count are read from, and the only
 * place enablement is written.
 *
 * App-global: the platform is single-tenant, so AC4's "per-organization enablement" is
 * the deployment itself. There is no tenant key to scope by, exactly as with the stage
 * and tag catalogues.
 *
 * Soft delete has no automatic filter yet (CLAUDE.md §11), so every query names
 * `deletedAt: null` — including the one behind the toggle, which must not resurrect a
 * retired integration.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /**
   * The whole library in grid order (INT-01.1 AC1–AC3).
   *
   * Deliberately unpaginated: the registry is a bounded reference set of ~18 rows that
   * the library renders as one grid, and INT-02.3's filter and search are client-side
   * over it. Paging a set this size would cost a round trip per filter change and buy
   * nothing.
   */
  list(): Promise<IntegrationResponse[]> {
    return this.prisma.integration.findMany({
      where: { deletedAt: null },
      select: INTEGRATION_SELECT,
      orderBy: { position: 'asc' },
    });
  }

  /**
   * Turns one integration on or off (INT-02.2 AC1–AC3).
   *
   * Read-then-write rather than a bare `update`: a soft-deleted row still satisfies the
   * primary key, so `update({ where: { id } })` would happily toggle a retired
   * integration back into a state no list ever shows. The explicit lookup makes that a
   * 404, and turns Prisma's P2025 into the same 404 rather than a 500.
   */
  async setEnabled(id: string, enabled: boolean): Promise<IntegrationResponse> {
    const found = await this.prisma.integration.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, enabled: true },
    });
    if (!found) {
      throw new NotFoundException('Integration not found.');
    }
    const actor = userActor(await this.currentUser.resolve());

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.integration.update({
        where: { id },
        data: { enabled },
        select: INTEGRATION_SELECT,
      });
      // A switch flipped to where it already is changes nothing, so it records nothing.
      if (found.enabled !== enabled) {
        await recordAuditEvents(tx, [
          {
            entityType: 'INTEGRATION',
            entityId: id,
            leadId: null,
            action: 'UPDATED',
            actor,
            source: 'integrations.toggle',
            before: { enabled: found.enabled },
            after: { enabled },
          },
        ]);
      }
      return row;
    });
  }
}
