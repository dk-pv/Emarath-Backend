import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IMPORT_JOB_SELECT } from './dto/import-response.dto';

/** Newest-first history is capped so a busy account never returns an unbounded set. */
const MAX_HISTORY = 100;
const DEFAULT_HISTORY = 50;

/**
 * Persistence for `ImportJob` — the record that lets an async import report
 * progress, survive the request, and appear in history. Module-agnostic in shape
 * (it never mentions Leads), so it moves to `common/import` unchanged the day a
 * second module imports.
 */
@Injectable()
export class ImportJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ImportJobCreateInput) {
    return this.prisma.importJob.create({ data, select: IMPORT_JOB_SELECT });
  }

  /** Progress/counter updates during processing; by id, not user-facing. */
  async update(id: string, data: Prisma.ImportJobUpdateInput): Promise<void> {
    await this.prisma.importJob.update({ where: { id }, data });
  }

  findScoped(id: string, scope: Prisma.ImportJobWhereInput) {
    return this.prisma.importJob.findFirst({
      where: { AND: [scope, { id }] },
      select: IMPORT_JOB_SELECT,
    });
  }

  /** The failed-row payload for one job, scoped — only `errors` is read. */
  findErrors(id: string, scope: Prisma.ImportJobWhereInput) {
    return this.prisma.importJob.findFirst({
      where: { AND: [scope, { id }] },
      select: { errors: true },
    });
  }

  history(scope: Prisma.ImportJobWhereInput, limit: number) {
    return this.prisma.importJob.findMany({
      where: scope,
      select: IMPORT_JOB_SELECT,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), MAX_HISTORY),
    });
  }
}

/** Clamps a caller-supplied history limit to a sane default/ceiling. */
export function resolveHistoryLimit(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_HISTORY;
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_HISTORY;
  return Math.min(parsed, MAX_HISTORY);
}
