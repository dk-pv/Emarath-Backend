import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  ColumnLayout,
  isViewKey,
  KanbanPins,
  AgingThresholds,
} from './dto/view-preference.dto';

/** The fixed view key that holds a user's Kanban stage pins (one row per user). */
const KANBAN_PINS_KEY = 'kanban-pins';

const AGING_THRESHOLDS_KEY = 'lead-aging-thresholds';

/** The report's shipped defaults, used until the caller saves their own. */
const DEFAULT_AGING_THRESHOLDS: AgingThresholds = { green: 13, amber: 29 };

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

  /**
   * The caller's Kanban stage pins (KAN-05.2): a per-pipeline map of the one pinned
   * stage. Scoped to the caller like every other preference here — one user's pins
   * never affect another's board.
   */
  async getKanbanPins(): Promise<KanbanPins> {
    const user = await this.currentUser.resolve();

    const row = await this.prisma.userViewPreference.findUnique({
      where: { userId_viewKey: { userId: user.id, viewKey: KANBAN_PINS_KEY } },
      select: { layout: true },
    });

    return { pins: toPinsMap(row?.layout) };
  }

  /**
   * Pins `stage` in `pipeline` for the caller, or unpins the pipeline when `stage` is
   * null/empty. One pin per pipeline: pinning a new stage replaces the previous one.
   * Upserts the single per-user pins row; returns the updated map.
   */
  async setKanbanPin(
    pipeline: string,
    stage: string | null,
  ): Promise<KanbanPins> {
    const user = await this.currentUser.resolve();

    const current = (await this.getKanbanPins()).pins;
    const pins = { ...current };
    if (stage) pins[pipeline] = stage;
    else delete pins[pipeline];

    // A typed interface lacks the index signature Prisma's JSON input requires; the
    // write is the object above, the cast only satisfies that column type.
    const layoutInput = { pins } as unknown as Prisma.InputJsonValue;

    await this.prisma.userViewPreference.upsert({
      where: { userId_viewKey: { userId: user.id, viewKey: KANBAN_PINS_KEY } },
      create: {
        user: { connect: { id: user.id } },
        viewKey: KANBAN_PINS_KEY,
        layout: layoutInput,
      },
      update: { layout: layoutInput },
    });

    return { pins };
  }

  /** The caller's aging thresholds, falling back to the report's defaults. */
  async getAgingThresholds(): Promise<AgingThresholds> {
    const user = await this.currentUser.resolve();
    const row = await this.prisma.userViewPreference.findUnique({
      where: {
        userId_viewKey: { userId: user.id, viewKey: AGING_THRESHOLDS_KEY },
      },
      select: { layout: true },
    });
    return toThresholds(row?.layout);
  }

  /** Upserts the caller's aging thresholds; one row per user, as the pins are. */
  async saveAgingThresholds(
    thresholds: AgingThresholds,
  ): Promise<AgingThresholds> {
    // Cross-field, so the DTO's per-field rules cannot express it: the bands must not
    // overlap, or the report would have an empty amber range.
    if (thresholds.amber <= thresholds.green) {
      throw new BadRequestException('amber must be greater than green.');
    }
    const user = await this.currentUser.resolve();
    // A typed interface lacks the index signature Prisma's JSON input requires.
    const layout = thresholds as unknown as Prisma.InputJsonValue;

    await this.prisma.userViewPreference.upsert({
      where: {
        userId_viewKey: { userId: user.id, viewKey: AGING_THRESHOLDS_KEY },
      },
      create: {
        user: { connect: { id: user.id } },
        viewKey: AGING_THRESHOLDS_KEY,
        layout,
      },
      update: { layout },
    });
    return thresholds;
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

/**
 * Reads the stored pins JSON back into a `pipeline -> stage` map, defending against a
 * row that predates or drifts from the shape: anything not `{ pins: { string: string } }`
 * reads as "no pins", so a malformed row never reaches the client as pins.
 */
function toPinsMap(
  value: Prisma.JsonValue | undefined,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = (value as Record<string, unknown>)['pins'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const pins: Record<string, string> = {};
  for (const [pipeline, stage] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof stage === 'string') pins[pipeline] = stage;
  }
  return pins;
}

/**
 * A stored row back into thresholds. Anything unreadable — a row written before the
 * shape existed, or a partial payload — falls back to the defaults rather than throwing
 * a saved preference at the report.
 */
function toThresholds(value: Prisma.JsonValue | undefined): AgingThresholds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_AGING_THRESHOLDS;
  }
  const { green, amber } = value as Record<string, unknown>;
  if (
    typeof green !== 'number' ||
    typeof amber !== 'number' ||
    !Number.isInteger(green) ||
    !Number.isInteger(amber) ||
    green < 1 ||
    amber <= green
  ) {
    return DEFAULT_AGING_THRESHOLDS;
  }
  return { green, amber };
}
