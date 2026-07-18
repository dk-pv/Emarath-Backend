import { Injectable } from '@nestjs/common';
import { CurrentUserService } from '../auth/current-user';
import { LeadsRepository } from './leads.repository';
import { leadScopeWhere } from './lead-scope';
import { LeadListResponse, toLeadListItem } from './dto/lead-response.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';

/**
 * Lead reads (LEAD-02.1).
 *
 * Search and field filtering are absent on purpose — LEAD-03.1 and LEAD-03.2.
 * They compose onto the same scoped `where` this builds.
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
      where: leadScopeWhere(user),
      sort: query.sort,
      direction: query.direction,
      skip: (query.page - 1) * query.size,
      take: query.size,
    });

    return { rows: rows.map(toLeadListItem), total };
  }
}
