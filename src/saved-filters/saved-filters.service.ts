import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LeadCondition, parseLeadConditions } from '../leads/lead-conditions';
import { SavedFilterResponse } from './dto/saved-filter.dto';

/** The row shape every read selects — never the raw record, so nothing leaks by accident. */
const SELECT = {
  id: true,
  name: true,
  conditions: true,
  createdAt: true,
  updatedAt: true,
} as const;

type SavedFilterRow = {
  id: string;
  name: string;
  conditions: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * A user's saved filter presets (ADR-0052) — the checkbox row above the condition
 * builder, on both the Leads list and the Kanban board.
 *
 * Every query is keyed by the caller's id, so a preset belonging to someone else is
 * simply not found rather than being hidden in the UI — the same query-level scoping
 * rule the leads list follows. Conditions are validated with the filter engine's own
 * whitelist (`parseLeadConditions`) before they are written, so a stored preset can
 * never carry a field or operator the live builder would reject.
 */
@Injectable()
export class SavedFiltersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The caller's presets, oldest first — the order the checkbox row renders in. */
  async list(): Promise<SavedFilterResponse[]> {
    const user = await this.currentUser.resolve();
    const rows = await this.prisma.savedFilter.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: SELECT,
    });
    return rows.map(toResponse);
  }

  async create(name: string, conditions: string): Promise<SavedFilterResponse> {
    const user = await this.currentUser.resolve();
    const parsed = validateConditions(conditions);

    await this.assertNameFree(user.id, name);

    const row = await this.prisma.savedFilter.create({
      data: {
        user: { connect: { id: user.id } },
        name,
        conditions: parsed as unknown as Prisma.InputJsonValue,
      },
      select: SELECT,
    });
    return toResponse(row);
  }

  /**
   * Updates the caller's own preset in place — the "Update & Filter" path, which must
   * overwrite the selected preset rather than add a second one of the same name.
   */
  async update(
    id: string,
    changes: { name?: string; conditions?: string },
  ): Promise<SavedFilterResponse> {
    const user = await this.currentUser.resolve();
    const existing = await this.prisma.savedFilter.findFirst({
      where: { id, userId: user.id },
      select: { id: true, name: true },
    });
    if (!existing) throw new NotFoundException('Saved filter not found.');

    if (changes.name !== undefined && changes.name !== existing.name) {
      await this.assertNameFree(user.id, changes.name);
    }

    const row = await this.prisma.savedFilter.update({
      where: { id: existing.id },
      data: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.conditions === undefined
          ? {}
          : {
              conditions: validateConditions(
                changes.conditions,
              ) as unknown as Prisma.InputJsonValue,
            }),
      },
      select: SELECT,
    });
    return toResponse(row);
  }

  /** Deletes the caller's own preset; another user's id is a 404, never a delete. */
  async remove(id: string): Promise<{ id: string }> {
    const user = await this.currentUser.resolve();
    const deleted = await this.prisma.savedFilter.deleteMany({
      where: { id, userId: user.id },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Saved filter not found.');
    }
    return { id };
  }

  /** Names are the row's only label, so a duplicate would be indistinguishable. */
  private async assertNameFree(userId: string, name: string): Promise<void> {
    const clash = await this.prisma.savedFilter.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(`A filter named “${name}” already exists.`);
    }
  }
}

/**
 * Validates the payload through the filter engine's whitelist and returns the parsed
 * conditions. An unknown field, a wrong operator for the kind, or a value-count
 * mismatch is a 400 here — at save time — rather than a broken preset discovered later.
 */
function validateConditions(conditions: string): LeadCondition[] {
  return parseLeadConditions(conditions);
}

/** Stored JSON back to the string form the query param takes. */
function toResponse(row: SavedFilterRow): SavedFilterResponse {
  return {
    id: row.id,
    name: row.name,
    conditions: JSON.stringify(row.conditions ?? []),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
