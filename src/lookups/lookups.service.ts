import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PIPELINE } from '../stages/stage.constants';
import {
  LOOKUP_DATA,
  LOOKUP_TYPES,
  LookupOption,
  LookupType,
} from './lookups.data';

/**
 * Serves the New Lead form's dropdown options (ADR-0005, Phase 1).
 *
 * Most lists are config-backed (`lookups.data.ts`). Three are read from the database
 * so the form always reflects live, user-managed data: `tags` from the `Tag` table
 * (LEAD-12.1), `categories` from the `Category` catalogue, and `leadStatus` from the `Stage` catalogue (KAN-05.1) — the same
 * canonical source the board and list badges read, so the status dropdown can no
 * longer drift from the stages — and `teams` from `User.team`, for the Team filters. All three return the same `{ value, label }` shape,
 * so the frontend treats every lookup identically.
 */
@Injectable()
export class LookupsService {
  constructor(private readonly prisma: PrismaService) {}

  async byType(type: string): Promise<LookupOption[]> {
    if (type === 'tags') return this.tags();
    if (type === 'leadStatus') return this.stages();
    if (type === 'categories') return this.categories();
    if (type === 'teams') return this.teams();
    if (isConfigLookup(type)) return [...LOOKUP_DATA[type]];
    throw new NotFoundException(`Unknown lookup type: ${type}`);
  }

  /** Tags carry an id as their value (create takes tag ids), unlike config lists. */
  private async tags(): Promise<LookupOption[]> {
    const tags = await this.prisma.tag.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return tags.map((tag) => ({ value: tag.id, label: tag.name }));
  }

  /**
   * Lead statuses ARE the pipeline stages (KAN-05.1) — read from the canonical
   * catalogue in display order, so the form offers exactly the board's stages. The
   * default pipeline until the New Lead form becomes pipeline-aware (a later task).
   */
  private async stages(): Promise<LookupOption[]> {
    const stages = await this.prisma.stage.findMany({
      where: { pipeline: DEFAULT_PIPELINE },
      select: { name: true },
      orderBy: { position: 'asc' },
    });
    return stages.map((stage) => ({ value: stage.name, label: stage.name }));
  }

  /**
   * Enquiry categories, read from the `Category` catalogue the Settings screen manages.
   * Only active ones are offered — an inactive category stays on existing leads but is
   * not something new ones should be filed under. In tree order, as the settings screen
   * lists them; the value IS the name, which is what `Lead.category` stores.
   */
  private async categories(): Promise<LookupOption[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => ({ value: row.name, label: row.name }));
  }

  /** The teams users belong to — distinct `User.team`, the value the Team filters match on. */
  private async teams(): Promise<LookupOption[]> {
    const rows = await this.prisma.user.findMany({
      where: { team: { not: null }, deletedAt: null },
      select: { team: true },
      distinct: ['team'],
      orderBy: { team: 'asc' },
    });
    return rows
      .map((row) => row.team)
      .filter((team): team is string => team !== null)
      .map((team) => ({ value: team, label: team }));
  }
}

function isConfigLookup(type: string): type is LookupType {
  return (LOOKUP_TYPES as string[]).includes(type);
}
