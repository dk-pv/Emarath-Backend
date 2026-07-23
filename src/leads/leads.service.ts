import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { LeadsRepository } from './leads.repository';
import { leadScopeWhere } from './lead-scope';
import { buildLeadWhere } from './lead-where';
import {
  LeadListItem,
  LeadListResponse,
  toLeadListItem,
} from './dto/lead-response.dto';
import { LeadFilterOptions } from './dto/lead-filter-options.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';

/**
 * Lead reads (LEAD-02.1, LEAD-03.1, LEAD-03.2).
 *
 * The `where` is composed as an AND of independent fragments — scope, then
 * search, then each active field filter — so every concern stays isolated and
 * none can be forgotten or widen another. Sort and pagination are applied by the
 * repository over that same composed `where`, so they combine with search and
 * filters without any special case (AC4).
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly repository: LeadsRepository,
    private readonly currentUser: CurrentUserService,
  ) {}

  async list(query: ListLeadsQueryDto): Promise<LeadListResponse> {
    const user = await this.currentUser.resolve();

    const { rows, total } = await this.repository.findPage({
      where: this.buildWhere(user, query),
      sort: query.sort,
      direction: query.direction,
      skip: (query.page - 1) * query.size,
      take: query.size,
    });

    return { rows: rows.map(toLeadListItem), total };
  }

  /**
   * The values the filter panel offers for each field (LEAD-03.3), scoped to the
   * caller's leads. Source and Status are faceted from the data (they are
   * free-text, with no enum to enumerate). The agent list is the assignees the
   * caller may filter by: a sales agent can only ever filter by themselves — the
   * scope hides other agents' leads — so returning only self keeps a colleague's
   * name out of an agent's UI even when they share a lead.
   */
  async filterOptions(): Promise<LeadFilterOptions> {
    const user = await this.currentUser.resolve();
    const scope = leadScopeWhere(user);

    const [sources, statuses, agents, tags] = await Promise.all([
      this.repository.distinctSources(scope),
      this.repository.distinctStatuses(scope),
      this.agentOptions(user, scope),
      this.repository.distinctTags(scope),
    ]);

    return { sources, statuses, agents, tags };
  }

  private async agentOptions(
    user: CurrentUser,
    scope: Prisma.LeadWhereInput,
  ): Promise<{ id: string; name: string }[]> {
    if (user.role === UserRole.SALES_AGENT) {
      const self = await this.repository.findUserSummary(user.id);
      return self ? [self] : [];
    }
    return this.repository.assigneesOf(scope);
  }

  /** Users the New Lead form can assign a lead to (LEAD-06.2). */
  async assignableAgents(): Promise<{ id: string; name: string }[]> {
    return this.repository.assignableUsers([
      UserRole.SALES_AGENT,
      UserRole.SALES_MANAGER,
      UserRole.CUSTOMER_SERVICE_AGENT,
    ]);
  }

  /**
   * Creates a lead from the New Lead form (LEAD-06.1).
   *
   * Defaults are applied here, not in the DB, so an omitted value becomes the
   * Workpex default rather than null (AC3/AC4). A sales agent only sees leads
   * assigned to them, so a lead they create with no assignee would be invisible
   * to its own author — the creator is auto-added in that case. Assignments,
   * tags and the optional complaint are created in the same statement, so a
   * failure leaves no half-built lead.
   */
  async create(dto: CreateLeadDto): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();

    const assigneeIds = new Set(dto.assignedAgentIds ?? []);
    if (user.role === UserRole.SALES_AGENT) assigneeIds.add(user.id);

    const data: Prisma.LeadCreateInput = {
      name: dto.name,
      firstName: dto.firstName ?? null,
      primaryPhone: dto.primaryPhone,
      secondaryPhone: dto.secondaryPhone ?? null,
      language: dto.language,
      country: dto.country,
      source: dto.source ?? null,
      status: dto.status || 'New',
      pipeline: dto.pipeline || 'Lead Pipeline',
      product: dto.product,
      productQty: dto.productQty ?? null,
      product2: dto.product2 ?? null,
      product2Qty: dto.product2Qty ?? null,
      bookingDate: dto.bookingDate ? new Date(dto.bookingDate) : null,
      category: dto.category || 'Default',
      actualAmount: dto.actualAmount,
      forecastedAmount: dto.forecastedAmount ?? null,
      paymentMethod: dto.paymentMethod,
      state: dto.state ?? null,
      street: dto.street ?? null,
      city: dto.city ?? null,
      nationalCode: dto.nationalCode ?? null,
      callStatus: dto.callStatus,
      callAttempts: dto.callAttempts,
      whatsappAttempts: dto.msgAttempts ?? 0,
      assignments: assigneeIds.size
        ? {
            create: [...assigneeIds].map((userId) => ({
              user: { connect: { id: userId } },
            })),
          }
        : undefined,
      tags: dto.tagIds?.length
        ? {
            create: dto.tagIds.map((tagId) => ({
              tag: { connect: { id: tagId } },
            })),
          }
        : undefined,
      complaints: dto.complaintReason
        ? { create: [{ details: dto.complaintReason, status: 'Open' }] }
        : undefined,
    };

    try {
      const lead = await this.repository.create(data);
      return toLeadListItem(lead);
    } catch (error) {
      // A bad agent or tag id fails the foreign key; report it as a 400, not 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2025')
      ) {
        throw new BadRequestException(
          'One or more assigned agents or tags do not exist.',
        );
      }
      throw error;
    }
  }

  /**
   * The scoped, searched, filtered `where` for the list — the same builder the
   * export uses (`buildLeadWhere`), so a file and the on-screen list can never
   * disagree and neither can leak a lead outside the caller's scope.
   */
  private buildWhere(
    user: CurrentUser,
    query: ListLeadsQueryDto,
  ): Prisma.LeadWhereInput {
    return buildLeadWhere(user, query);
  }
}
