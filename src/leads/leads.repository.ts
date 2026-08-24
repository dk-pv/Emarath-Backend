import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LEAD_EDIT_SELECT, LEAD_LIST_SELECT } from './dto/lead-response.dto';
import { LeadSortColumn } from './dto/list-leads-query.dto';
import { pinnedPageSlice } from './pinned-page';

export interface FindLeadsArgs {
  where: Prisma.LeadWhereInput;
  sort: LeadSortColumn;
  direction: 'asc' | 'desc';
  skip: number;
  take: number;
  /**
   * The caller's pinned lead ids that match this `where` (ADR-0031). The page is
   * ordered pinned-first: these ids form the first block, everyone else the
   * second. Empty when nothing is pinned, which reduces to the plain list.
   */
  pinnedIds: string[];
}

/**
 * Every lead read goes through here.
 *
 * The data layer takes a `where` it does not build. Scoping is decided by
 * `leadScopeWhere` and passed in, so this class can never be the place a scope
 * is forgotten — it has no notion of who is asking.
 */
@Injectable()
export class LeadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page plus the total for that same filter.
   *
   * Both halves run in a single transaction: on separate connections a lead
   * created between them makes the count disagree with the page, which shows up
   * as a phantom last page the user cannot open.
   */
  /** Creates a lead and its nested assignments/tags/complaint in one statement. */
  async create(data: Prisma.LeadCreateInput) {
    return this.prisma.lead.create({ data, select: LEAD_LIST_SELECT });
  }

  /**
   * One lead by the caller-supplied scoped `where`, or null. Same projection as
   * the list, so the Lead Detail read can never surface a field the list hides.
   */
  async findById(where: Prisma.LeadWhereInput) {
    return this.prisma.lead.findFirst({ where, select: LEAD_LIST_SELECT });
  }

  /**
   * One lead by the caller-supplied scoped `where`, projected wide enough to
   * prefill the Edit Lead form (LEAD_EDIT_SELECT). Same scoped-`where` contract as
   * findById — the service passes the scope, so this can never widen it.
   */
  async findEditById(where: Prisma.LeadWhereInput) {
    return this.prisma.lead.findFirst({ where, select: LEAD_EDIT_SELECT });
  }

  /**
   * Updates a lead's scalar fields and replaces its assignments/tags in one
   * transaction (Edit Lead). Assignments and tags are full-replaced — deleteMany
   * then create — so removing one in the form removes the row; the whole thing is
   * atomic, so a bad id leaves the lead untouched. The single COMPLAINTS field
   * reconciles the latest open complaint: its text is updated in place, or one is
   * created if none exists; an empty value leaves existing complaints alone (their
   * lifecycle is LEAD-13.1, not this form's to delete). Returns the list projection
   * so the row can adopt the result. Scope is enforced by the caller before this.
   */
  async update(
    id: string,
    {
      data,
      assigneeIds,
      tagIds,
      complaintReason,
      customFieldValues,
    }: {
      data: Prisma.LeadUpdateInput;
      assigneeIds: string[];
      tagIds: string[];
      complaintReason: string | null;
      customFieldValues: { customFieldId: string; value: string }[];
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id },
        data: {
          ...data,
          assignments: {
            deleteMany: {},
            create: assigneeIds.map((userId) => ({
              user: { connect: { id: userId } },
            })),
          },
          tags: {
            deleteMany: {},
            create: tagIds.map((tagId) => ({
              tag: { connect: { id: tagId } },
            })),
          },
          // Full-replace (like assignments/tags): a value the form emptied is dropped,
          // a changed one rewritten, all atomic (LEAD-05.1, ADR-0051).
          customFieldValues: {
            deleteMany: {},
            create: customFieldValues.map((v) => ({
              customField: { connect: { id: v.customFieldId } },
              value: v.value,
            })),
          },
        },
        select: LEAD_LIST_SELECT,
      });

      if (complaintReason) {
        const existing = await tx.complaint.findFirst({
          where: { leadId: id, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (existing) {
          await tx.complaint.update({
            where: { id: existing.id },
            data: { details: complaintReason },
          });
        } else {
          await tx.complaint.create({
            data: {
              lead: { connect: { id } },
              details: complaintReason,
              status: 'Open',
            },
          });
        }
      }

      return lead;
    });
  }

  async findPage({
    where,
    sort,
    direction,
    skip,
    take,
    pinnedIds,
  }: FindLeadsArgs) {
    // id breaks ties: without it, rows sharing a sort value can swap between
    // pages and a lead is shown twice while another is never shown at all.
    const orderBy: Prisma.LeadOrderByWithRelationInput[] = [
      { [sort]: direction },
      { id: 'asc' },
    ];

    // Pinned leads sort ahead of the rest (ADR-0031). Prisma cannot orderBy a
    // per-user relation, so the page is two ordered blocks — pinned ids `in`,
    // then `notIn` — and `pinnedPageSlice` works out each block's window. The
    // total is the whole set, so pagination is unchanged. All in one transaction
    // so a lead created mid-read cannot make the two pages and the count disagree.
    const { pinnedSkip, pinnedTake, unpinnedSkip, unpinnedTake } =
      pinnedPageSlice(skip, take, pinnedIds.length);

    const [pinnedRows, unpinnedRows, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where: { AND: [where, { id: { in: pinnedIds } }] },
        select: LEAD_LIST_SELECT,
        orderBy,
        skip: pinnedSkip,
        take: pinnedTake,
      }),
      this.prisma.lead.findMany({
        where: { AND: [where, { id: { notIn: pinnedIds } }] },
        select: LEAD_LIST_SELECT,
        orderBy,
        skip: unpinnedSkip,
        take: unpinnedTake,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { pinnedRows, unpinnedRows, total };
  }

  /**
   * The caller's pinned lead ids that fall within a scoped, filtered `where`
   * (ADR-0031). `lead: where` reuses the exact list predicate, so a pinned lead
   * that a search or filter excludes is not counted — the pinned block and the
   * page stay in step. Ordering is applied by `findPage`, not here.
   */
  async pinnedLeadIds(
    userId: string,
    where: Prisma.LeadWhereInput,
  ): Promise<string[]> {
    const rows = await this.prisma.leadPin.findMany({
      where: { userId, lead: where },
      select: { leadId: true },
    });
    return rows.map((row) => row.leadId);
  }

  /** Pins a lead for one user (ADR-0031). Idempotent — re-pinning is a no-op. */
  async pin(userId: string, leadId: string): Promise<void> {
    await this.prisma.leadPin.upsert({
      where: { leadId_userId: { leadId, userId } },
      update: {},
      create: { leadId, userId },
    });
  }

  /** Unpins a lead for one user. Idempotent — unpinning what is not pinned is a no-op. */
  async unpin(userId: string, leadId: string): Promise<void> {
    await this.prisma.leadPin.deleteMany({ where: { userId, leadId } });
  }

  /**
   * The distinct Source values present in a scoped set of leads (LEAD-03.3).
   *
   * The `where` carries scope, so the options never reveal a source that only
   * appears on leads the caller cannot see. Null sources are excluded — "no
   * source" is not a filter choice — and the result is ordered for a stable menu.
   */
  async distinctSources(where: Prisma.LeadWhereInput): Promise<string[]> {
    const rows = await this.prisma.lead.findMany({
      where: { AND: [where, { source: { not: null } }] },
      select: { source: true },
      distinct: ['source'],
      orderBy: { source: 'asc' },
    });
    return rows
      .map((row) => row.source)
      .filter((source): source is string => source !== null);
  }

  /** The distinct Status values in a scoped set of leads (LEAD-03.3). */
  async distinctStatuses(where: Prisma.LeadWhereInput): Promise<string[]> {
    const rows = await this.prisma.lead.findMany({
      where,
      select: { status: true },
      distinct: ['status'],
      orderBy: { status: 'asc' },
    });
    return rows.map((row) => row.status);
  }

  /**
   * The distinct agents assigned to a scoped set of leads (LEAD-03.3).
   *
   * `lead` filters the assignments by the same scope as the list, so the option
   * list only ever contains agents who appear on leads the caller may open.
   */
  async assigneesOf(
    where: Prisma.LeadWhereInput,
  ): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.leadAssignment.findMany({
      where: { lead: where },
      select: { user: { select: { id: true, name: true } } },
      distinct: ['userId'],
    });
    return rows
      .map((row) => row.user)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The distinct tags applied to a scoped set of leads (LEAD-12.1 AC4).
   *
   * `lead` filters the tag links by the same scope as the list, so the option
   * list only ever contains tags that appear on a lead the caller may open — the
   * same privacy rule the source/status/agent facets follow.
   */
  async distinctTags(
    where: Prisma.LeadWhereInput,
  ): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.leadTag.findMany({
      where: { lead: where },
      select: { tag: { select: { id: true, name: true } } },
      distinct: ['tagId'],
    });
    return rows
      .map((row) => row.tag)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * A lead's assignment rows for its detail timeline: who it is assigned to and
   * when (the row's createdAt doubles as Workpex's "Assigned Date"). The caller
   * scope-checks the lead first, so this reads by leadId only.
   */
  async assignmentsForTimeline(leadId: string) {
    return this.prisma.leadAssignment.findMany({
      where: { leadId },
      select: { id: true, createdAt: true, user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A lead's notes for its detail timeline (LEAD-10.2, ADR-0035): author, body and
   * when, newest first, excluding soft-deleted. Scope is verified by the caller.
   */
  async notesForTimeline(leadId: string) {
    return this.prisma.leadNote.findMany({
      where: { leadId, deletedAt: null },
      select: {
        id: true,
        createdAt: true,
        body: true,
        author: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A lead's follow-ups for the Lead Detail drawer (ACT-03.2 / ACT-04.1): type,
   * description, schedule, completion and assignees, excluding soft-deleted, earliest
   * due first. Scope is verified by the caller (leadId only here), matching the
   * timeline reads. Feeds both the "Next Follow-up" card and the timeline entries.
   */
  async activitiesForLead(leadId: string) {
    return this.prisma.activity.findMany({
      where: { leadId, deletedAt: null },
      select: {
        id: true,
        type: true,
        description: true,
        dueAt: true,
        endAt: true,
        completedAt: true,
        createdAt: true,
        assignees: {
          select: { user: { select: { id: true, name: true } } },
        },
      },
      orderBy: { dueAt: 'asc' },
    });
  }

  /** One user's id and name, for the agent's own single filter option. */
  async findUserSummary(
    id: string,
  ): Promise<{ id: string; name: string } | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
  }

  /**
   * Active users a lead can be assigned to (LEAD-06.2). Returns id and name only —
   * never email, role or team — so the assignment directory carries no profile
   * data. Scoped to the lead-handling roles, not the whole user table.
   */
  async assignableUsers(
    roles: UserRole[],
  ): Promise<{ id: string; name: string }[]> {
    return this.prisma.user.findMany({
      where: { deletedAt: null, role: { in: roles } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
