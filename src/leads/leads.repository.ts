import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LEAD_LIST_SELECT } from './dto/lead-response.dto';
import { LeadSortColumn } from './dto/list-leads-query.dto';

export interface FindLeadsArgs {
  where: Prisma.LeadWhereInput;
  sort: LeadSortColumn;
  direction: 'asc' | 'desc';
  skip: number;
  take: number;
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

  async findPage({ where, sort, direction, skip, take }: FindLeadsArgs) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: LEAD_LIST_SELECT,
        // id breaks ties: without it, rows sharing a sort value can swap between
        // pages and a lead is shown twice while another is never shown at all.
        orderBy: [{ [sort]: direction }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { rows, total };
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
