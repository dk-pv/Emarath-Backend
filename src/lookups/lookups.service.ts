import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LOOKUP_DATA,
  LOOKUP_TYPES,
  LookupOption,
  LookupType,
} from './lookups.data';

/**
 * Serves the New Lead form's dropdown options (ADR-0005, Phase 1).
 *
 * Most lists are config-backed (`lookups.data.ts`); `tags` is the one exception,
 * read from the `Tag` table because tags are a real, user-managed entity joined
 * to leads (LEAD-12.1). Both are returned in the same `{ value, label }` shape so
 * the frontend treats every lookup identically — and so moving a config list into
 * a table later is invisible to the client.
 */
@Injectable()
export class LookupsService {
  constructor(private readonly prisma: PrismaService) {}

  async byType(type: string): Promise<LookupOption[]> {
    if (type === 'tags') return this.tags();
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
}

function isConfigLookup(type: string): type is LookupType {
  return (LOOKUP_TYPES as string[]).includes(type);
}
