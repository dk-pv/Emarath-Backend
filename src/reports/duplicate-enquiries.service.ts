import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { buildDuplicateEnquiriesWhere } from './duplicate-enquiries-where';
import { DuplicateEnquiriesQueryDto } from './dto/duplicate-enquiries-query.dto';
import {
  DUPLICATE_ENQUIRIES_SELECT,
  DUPLICATE_THRESHOLDS,
  DuplicateEnquiriesListResponse,
  DuplicateEnquiriesSummaryResponse,
  DuplicateEnquiryRow,
} from './dto/duplicate-enquiries-response.dto';

const BATCH_SIZE = 1000;
const MAX_ROWS = 100_000;

/** Newest enquiry first: a duplicate is read from the most recent attempt back. */
const ORDER_BY: Prisma.LeadOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

type DuplicateLead = Prisma.LeadGetPayload<{
  select: typeof DUPLICATE_ENQUIRIES_SELECT;
}>;

/**
 * The Duplicate Enquiries report (RPT-02.10).
 *
 * A duplicate enquiry is a lead whose primary phone another lead also holds — the exact
 * rule the Leads list's "Duplicate Lead" search scope already uses
 * (`LeadsRepository.duplicatePhones`), so the report and that search can never disagree
 * about what counts as a duplicate.
 *
 * Duplicates are judged *within* the filtered population: narrowing by date, assignee or
 * source changes which enquiries are compared, so the cards and the table always describe
 * the same set the toolbar is showing.
 */
@Injectable()
export class DuplicateEnquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** One page of duplicate groups, newest enquiry first. */
  async list(
    query: DuplicateEnquiriesQueryDto,
  ): Promise<DuplicateEnquiriesListResponse> {
    const groups = await this.groups(query);
    const start = (query.page - 1) * query.size;
    return {
      rows: groups.slice(start, start + query.size),
      total: groups.length,
    };
  }

  /** The five threshold cards, over the same groups the table lists. */
  async summary(
    query: DuplicateEnquiriesQueryDto,
  ): Promise<DuplicateEnquiriesSummaryResponse> {
    const groups = await this.groups(query);

    // A group of k enquiries gives each of its members k - 1 duplicates, so a card's
    // count is the number of LEADS sitting in a group large enough to clear its bar.
    const leadsWithAtLeast: Record<string, number> = {};
    for (const threshold of DUPLICATE_THRESHOLDS) {
      leadsWithAtLeast[String(threshold)] = groups
        .filter((group) => group.duplicateCount - 1 >= threshold)
        .reduce((sum, group) => sum + group.duplicateCount, 0);
    }
    return { kpis: { leadsWithAtLeast } };
  }

  /**
   * Every duplicate group the filters leave, newest first.
   *
   * ponytail: the scoped leads are grouped in app because a row needs each group's
   * contacts, assignees and sources — fields Prisma cannot carry through a `groupBy`.
   * The projection is small and capped at MAX_ROWS, the bound the sibling reports use;
   * swap in a scoped raw query if the lead table ever outgrows it.
   */
  private async groups(
    query: DuplicateEnquiriesQueryDto,
  ): Promise<DuplicateEnquiryRow[]> {
    const user = await this.currentUser.resolve();
    const where = buildDuplicateEnquiriesWhere(user, query);

    const byPhone = new Map<string, DuplicateLead[]>();
    let skip = 0;
    while (skip < MAX_ROWS) {
      const leads = await this.prisma.lead.findMany({
        where,
        select: DUPLICATE_ENQUIRIES_SELECT,
        orderBy: ORDER_BY,
        skip,
        take: BATCH_SIZE,
      });
      if (leads.length === 0) break;
      for (const lead of leads) {
        const phone = lead.primaryPhone.trim();
        if (phone === '') continue;
        const bucket = byPhone.get(phone);
        if (bucket) bucket.push(lead);
        else byPhone.set(phone, [lead]);
      }
      if (leads.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }

    return [...byPhone.entries()]
      .filter(([, leads]) => leads.length > 1)
      .map(([phone, leads]) => toRow(phone, leads))
      .sort(
        (a, b) =>
          Date.parse(b.latestEnquiryAt) - Date.parse(a.latestEnquiryAt) ||
          a.name.localeCompare(b.name),
      );
  }
}

/** A group of leads sharing a phone, as one row led by its most recent enquiry. */
function toRow(phone: string, leads: DuplicateLead[]): DuplicateEnquiryRow {
  // The batches arrive newest-first, so the first entry is the latest enquiry.
  const latest = leads.reduce((newest, lead) =>
    lead.createdAt > newest.createdAt ? lead : newest,
  );

  const agents = new Map<string, string>();
  const sources = new Set<string>();
  for (const lead of leads) {
    for (const assignment of lead.assignments) {
      agents.set(assignment.user.id, assignment.user.name);
    }
    if (lead.source) sources.add(lead.source);
  }

  return {
    id: phone,
    name: latest.name,
    primaryPhone: phone,
    secondaryPhone: latest.secondaryPhone,
    primaryEmail: latest.email,
    // `Lead` carries one email address, so there is no second one to show. Kept as a
    // column because the reference has it; it reads as empty until the model grows one.
    secondaryEmail: null,
    duplicateCount: leads.length,
    latestEnquiryAt: latest.createdAt.toISOString(),
    assignedTo: [...agents].map(([id, name]) => ({ id, name })),
    sources: [...sources].sort((a, b) => a.localeCompare(b)),
  };
}
