import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ColumnLayout, isViewKey } from './dto/view-preference.dto';

/**
 * Per-user table layouts — the Manage Columns result (LEAD-05.1 AC3).
 *
 * Scoped to the caller through the same `CurrentUserService` seam the leads list
 * uses, so a saved layout is only ever the requester's own — no user can read or
 * overwrite another's view. Injects `PrismaService` directly rather than adding a
 * repository: the store is two statements over one table, and a repository here
 * would be the speculative abstraction the standards forbid.
 */
@Injectable()
export class ViewPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The caller's saved layout for a view, or `null` to fall back to the default. */
  async get(viewKey: string): Promise<{ layout: ColumnLayout | null }> {
    assertViewKey(viewKey);
    const user = await this.currentUser.resolve();

    const row = await this.prisma.userViewPreference.findUnique({
      where: { userId_viewKey: { userId: user.id, viewKey } },
      select: { layout: true },
    });

    return { layout: row ? toColumnLayout(row.layout) : null };
  }

  /** Upserts the caller's layout for a view; one row per user per view. */
  async save(
    viewKey: string,
    layout: ColumnLayout,
  ): Promise<{ layout: ColumnLayout }> {
    assertViewKey(viewKey);
    const user = await this.currentUser.resolve();

    const data: ColumnLayout = { order: layout.order, hidden: layout.hidden };
    // A typed interface lacks the index signature Prisma's JSON input requires;
    // the write is the object above, the cast only satisfies that column type.
    const layoutInput = data as unknown as Prisma.InputJsonValue;

    await this.prisma.userViewPreference.upsert({
      where: { userId_viewKey: { userId: user.id, viewKey } },
      create: {
        user: { connect: { id: user.id } },
        viewKey,
        layout: layoutInput,
      },
      update: { layout: layoutInput },
    });

    return { layout: data };
  }
}

function assertViewKey(viewKey: string): void {
  if (!isViewKey(viewKey)) {
    throw new BadRequestException('Invalid view key.');
  }
}

/**
 * Reads the stored JSON back into a `ColumnLayout`, defending against a row that
 * predates or drifts from the current shape: anything not `{ order[], hidden[] }`
 * of strings reads as "no saved layout", so the default view returns rather than a
 * malformed one reaching the client.
 */
function toColumnLayout(value: Prisma.JsonValue): ColumnLayout | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const order = asStringArray(value['order']);
  const hidden = asStringArray(value['hidden']);
  return order && hidden ? { order, hidden } : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === 'string') ? value : null;
}
