import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
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
}
