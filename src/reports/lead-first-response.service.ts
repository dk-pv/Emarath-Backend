import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../leads/export/leads-export.columns';
import { buildLeadFirstResponseWhere } from './lead-first-response-where';
import { LeadFirstResponseQueryDto } from './dto/lead-first-response-query.dto';
import {
  FIRST_RESPONSE_SELECT,
  LeadFirstResponseKpis,
  LeadFirstResponseListResponse,
  LeadFirstResponseRow,
  LeadFirstResponseSummaryResponse,
} from './dto/lead-first-response-response.dto';

const BATCH_SIZE = 1000;
const MAX_ROWS = 100_000;
const MINUTE_MS = 60_000;

/** Newest first: a first-response report is read from the most recent leads down. */
const ORDER_BY: Prisma.LeadOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

/** Records columns the database can order directly. */
const DB_SORTS: Record<
  string,
  (direction: Prisma.SortOrder) => Prisma.LeadOrderByWithRelationInput
> = {
  name: (direction) => ({ name: direction }),
  createdAt: (direction) => ({ createdAt: direction }),
  source: (direction) => ({ source: { sort: direction, nulls: 'last' } }),
};

/** The rest are computed per row, so they are ordered in app over the scoped set. */
const COMPUTED_SORTS: Record<
  string,
  (row: LeadFirstResponseRow) => number | string | null
> = {
  firstActivityAt: (row) =>
    row.firstActivityAt ? Date.parse(row.firstActivityAt) : null,
  firstResponseMinutes: (row) => row.firstResponseMinutes,
  activityType: (row) => row.activityType,
  followUpAt: (row) => (row.followUpAt ? Date.parse(row.followUpAt) : null),
};

const EXPORT_HEADERS = [
  'Lead Name',
  'Assigned User',
  'Lead Source',
  'Lead Created',
  'First Activity',
  'Activity Type',
  'First Response (minutes)',
  'Follow-up Date',
] as const;

type FirstResponseLead = Prisma.LeadGetPayload<{
  select: typeof FIRST_RESPONSE_SELECT;
}>;

/** One lead's first engagement: when it happened and what it was. */
type FirstTouch = { at: Date; type: string };

/**
 * The Lead First Response report (RPT-02.9).
 *
 * "First response" is the gap between a lead being created and the first time anyone
 * actually worked it — its earliest completed activity or logged call, the same
 * engagement signal the No Activity, Today Leads and Lead Aging reports read. A lead
 * with no engagement at all is untouched, and has no response time to average.
 *
 * Every read composes the one scoped `where`, so the cards, the tabs, the records and
 * the export always describe the same set of leads.
 */
@Injectable()
export class LeadFirstResponseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** The metric cards and the records tabs' counts. */
  async summary(
    query: LeadFirstResponseQueryDto,
  ): Promise<LeadFirstResponseSummaryResponse> {
    const user = await this.currentUser.resolve();
    const changedIds = await this.changedLeadIds(query.activityType);
    // The cards describe the whole filtered set, so they ignore which tab is active —
    // otherwise "Untouched 10" would change the moment you clicked it.
    const where = buildLeadFirstResponseWhere(user, {
      ...query,
      contact: 'all',
      changedIds,
    });

    const firstTouch = await this.firstTouchByLead(where);
    const lateMs = query.lateHours * 3_600_000;

    let totalLeads = 0;
    let contacted = 0;
    let respondedLate = 0;
    let responseTotal = 0;
    let skip = 0;

    // ponytail: the response mean is a computed span Prisma cannot aggregate, so the
    // scoped leads are walked in batches over a tiny projection, capped by MAX_ROWS —
    // the same trade the sibling reports make.
    while (skip < MAX_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: { id: true, createdAt: true },
        orderBy: ORDER_BY,
        skip,
        take: BATCH_SIZE,
      });
      if (leads.length === 0) break;

      for (const lead of leads) {
        totalLeads += 1;
        const touch = firstTouch.get(lead.id);
        if (!touch) continue;
        contacted += 1;
        const elapsed = Math.max(
          0,
          touch.at.getTime() - lead.createdAt.getTime(),
        );
        responseTotal += elapsed;
        if (elapsed > lateMs) respondedLate += 1;
      }

      if (leads.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }

    const untouched = totalLeads - contacted;
    const rate = (part: number, whole: number): number =>
      whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

    const kpis: LeadFirstResponseKpis = {
      totalLeads,
      contacted,
      contactRate: rate(contacted, totalLeads),
      avgFirstResponseMinutes:
        contacted === 0
          ? null
          : Math.round(responseTotal / contacted / MINUTE_MS),
      untouched,
      untouchedRate: rate(untouched, totalLeads),
      respondedLate,
      lateRate: rate(respondedLate, contacted),
    };

    return {
      kpis,
      tabs: { all: totalLeads, contacted, untouched },
    };
  }

  /** One scoped page of the Lead Records table. */
  async listDetailed(
    query: LeadFirstResponseQueryDto,
  ): Promise<LeadFirstResponseListResponse> {
    const user = await this.currentUser.resolve();
    const changedIds = await this.changedLeadIds(query.activityType);
    const where = buildLeadFirstResponseWhere(user, {
      ...query,
      changedIds,
    });
    const direction: Prisma.SortOrder =
      query.direction === 'desc' ? 'desc' : 'asc';
    const computed = query.sort ? COMPUTED_SORTS[query.sort] : undefined;

    // A computed column has no column to order by, so the whole scoped set is built and
    // ordered here before the page is cut — otherwise the sort would only reshuffle the
    // rows already on screen. Bounded by MAX_ROWS, like the sibling reports.
    if (computed) {
      const all = await this.allRows(where);
      const sign = direction === 'asc' ? 1 : -1;
      all.sort((a, b) => {
        const left = computed(a);
        const right = computed(b);
        // Untouched leads have nothing to compare — park them last in both directions.
        if (left === null || right === null) {
          return left === right ? 0 : left === null ? 1 : -1;
        }
        const order =
          typeof left === 'string' && typeof right === 'string'
            ? left.localeCompare(right)
            : Number(left) - Number(right);
        return order * sign || a.name.localeCompare(b.name);
      });
      const start = (query.page - 1) * query.size;
      return { rows: all.slice(start, start + query.size), total: all.length };
    }

    const orderBy =
      query.sort && DB_SORTS[query.sort]
        ? [DB_SORTS[query.sort](direction), { id: 'asc' as const }]
        : ORDER_BY;

    const [leads, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: FIRST_RESPONSE_SELECT,
        orderBy,
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.lead.count({ where }),
    ]);

    const ids = leads.map((lead) => lead.id);
    const [firstTouch, followUps] = await Promise.all([
      this.firstTouchByLead({ id: { in: ids } }),
      this.nextFollowUpByLead(ids),
    ]);

    return {
      rows: leads.map((lead) =>
        toRow(
          lead,
          firstTouch.get(lead.id) ?? null,
          followUps.get(lead.id) ?? null,
        ),
      ),
      total,
    };
  }

  /** Streams the scoped records to a CSV download; the same `where` the tables compose. */
  async exportCsv(
    query: LeadFirstResponseQueryDto,
    res: Response,
  ): Promise<void> {
    const user = await this.currentUser.resolve();
    const changedIds = await this.changedLeadIds(query.activityType);
    const where = buildLeadFirstResponseWhere(user, {
      ...query,
      changedIds,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename()}"`,
    );
    res.write('﻿');
    res.write(
      EXPORT_HEADERS.map((header) => csvCell(header)).join(',') + '\r\n',
    );

    for (const row of await this.allRows(where)) {
      res.write(
        [
          csvCell(row.name),
          csvCell(row.assignedTo.map((agent) => agent.name).join('; ')),
          csvCell(row.source ?? ''),
          csvCell(row.createdAt),
          csvCell(row.firstActivityAt ?? ''),
          csvCell(row.activityType ?? 'No Activity'),
          csvCell(
            row.firstResponseMinutes === null
              ? ''
              : String(row.firstResponseMinutes),
          ),
          csvCell(row.followUpAt ?? ''),
        ].join(',') + '\r\n',
      );
    }
    res.end();
  }

  /**
   * The leads whose status or record has changed since creation. Prisma cannot compare two
   * columns in a `where`, so this is the one place the report drops to SQL — a
   * parameterised id lookup the caller ANDs in.
   *
   * ponytail: capped at MAX_ROWS, the bound the batched walks already use; give the two
   * kinds their own indexed column if the tracked set ever outgrows an id list.
   */
  private async changedLeadIds(
    types: string[] | undefined,
  ): Promise<string[] | undefined> {
    const wantsStatus = types?.includes('STATUS_CHANGED') ?? false;
    const wantsEdited = types?.includes('LEAD_EDITED') ?? false;
    if (!wantsStatus && !wantsEdited) return undefined;

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM leads
      WHERE deleted_at IS NULL
        AND (
          (${wantsStatus}::boolean AND status_changed_at <> created_at)
          OR (${wantsEdited}::boolean AND updated_at <> created_at)
        )
      LIMIT ${MAX_ROWS}
    `;
    return rows.map((row) => row.id);
  }

  /** Every scoped lead as a records row — the computed-sort and export path's input. */
  private async allRows(
    where: Prisma.LeadWhereInput,
  ): Promise<LeadFirstResponseRow[]> {
    const firstTouch = await this.firstTouchByLead(where);
    const rows: LeadFirstResponseRow[] = [];
    let skip = 0;

    while (skip < MAX_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: FIRST_RESPONSE_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: BATCH_SIZE,
      });
      if (leads.length === 0) break;

      const followUps = await this.nextFollowUpByLead(
        leads.map((lead) => lead.id),
      );
      for (const lead of leads) {
        rows.push(
          toRow(
            lead,
            firstTouch.get(lead.id) ?? null,
            followUps.get(lead.id) ?? null,
          ),
        );
      }

      if (leads.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }
    return rows;
  }

  /**
   * Each lead's first engagement — the earlier of its first completed activity and its
   * first logged call — in two `groupBy`s, never a query per lead. A logged call reports
   * as `CALL`, the same word the activity kind uses.
   */
  private async firstTouchByLead(
    lead: Prisma.LeadWhereInput,
  ): Promise<Map<string, FirstTouch>> {
    const [activities, calls] = await Promise.all([
      this.prisma.activity.groupBy({
        by: ['leadId'],
        where: { lead, deletedAt: null, completedAt: { not: null } },
        _min: { completedAt: true },
      }),
      this.prisma.call.groupBy({
        by: ['leadId'],
        where: { lead, deletedAt: null },
        _min: { startedAt: true },
      }),
    ]);

    const first = new Map<string, FirstTouch>();
    const note = (leadId: string, at: Date | null, type: string) => {
      if (!at) return;
      const current = first.get(leadId);
      if (!current || at < current.at) first.set(leadId, { at, type });
    };
    // The activity's own kind needs a second read, but only for leads whose earliest
    // engagement is an activity — resolved below against the minima we just found.
    for (const group of activities) {
      note(group.leadId, group._min.completedAt, 'ACTIVITY');
    }
    for (const group of calls) note(group.leadId, group._min.startedAt, 'CALL');

    const activityFirst = [...first.entries()].filter(
      ([, touch]) => touch.type === 'ACTIVITY',
    );
    if (activityFirst.length > 0) {
      const kinds = await this.prisma.activity.findMany({
        where: {
          deletedAt: null,
          OR: activityFirst.map(([leadId, touch]) => ({
            leadId,
            completedAt: touch.at,
          })),
        },
        select: { leadId: true, type: true },
      });
      for (const kind of kinds) {
        const touch = first.get(kind.leadId);
        if (touch && touch.type === 'ACTIVITY') {
          first.set(kind.leadId, { at: touch.at, type: kind.type });
        }
      }
    }
    return first;
  }

  /**
   * The soonest outstanding follow-up per lead — the earliest incomplete, non-deleted
   * activity, the same derivation the Call Log and Today Leads use.
   */
  private async nextFollowUpByLead(ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const grouped = await this.prisma.activity.groupBy({
      by: ['leadId'],
      where: { leadId: { in: ids }, completedAt: null, deletedAt: null },
      _min: { dueAt: true },
    });
    return new Map(
      grouped
        .filter((group) => group._min.dueAt)
        .map((group) => [group.leadId, group._min.dueAt as Date]),
    );
  }
}

function toRow(
  lead: FirstResponseLead,
  touch: FirstTouch | null,
  followUp: Date | null,
): LeadFirstResponseRow {
  return {
    id: lead.id,
    name: lead.name,
    assignedTo: lead.assignments.map((assignment) => ({
      id: assignment.user.id,
      name: assignment.user.name,
    })),
    source: lead.source,
    createdAt: lead.createdAt.toISOString(),
    firstActivityAt: touch ? touch.at.toISOString() : null,
    activityType: touch ? touch.type : null,
    firstResponseMinutes: touch
      ? Math.max(
          0,
          Math.round(
            (touch.at.getTime() - lead.createdAt.getTime()) / MINUTE_MS,
          ),
        )
      : null,
    followUpAt: followUp ? followUp.toISOString() : null,
  };
}

/** A timestamped, download-safe name: `lead-first-response-YYYYMMDD-HHmmss.csv`. */
function exportFilename(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `lead-first-response-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
}
