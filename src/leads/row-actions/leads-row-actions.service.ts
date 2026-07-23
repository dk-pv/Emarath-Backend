import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { leadScopeWhere } from '../lead-scope';
import {
  LeadListItem,
  LEAD_LIST_SELECT,
  toLeadListItem,
} from '../dto/lead-response.dto';
import { LeadsBulkService } from '../bulk/leads-bulk.service';
import { OUT_OF_SCOPE_REASON } from '../bulk/dto/bulk-actions.dto';
import {
  ReassignLeadDto,
  RowDeleteResponse,
  SetLeadStatusDto,
} from './dto/row-actions.dto';

/**
 * The scalar and relation fields a duplicate copies (LEAD-10.1 AC2, decided
 * "fields + assignments + tags"). id/timestamps are deliberately absent — the
 * copy is a new record with its own identity. Assignments carry over so the copy
 * stays inside the same agents' scope as its source; tags carry over as chips.
 */
const LEAD_COPY_SELECT = {
  name: true,
  firstName: true,
  primaryPhone: true,
  secondaryPhone: true,
  language: true,
  country: true,
  source: true,
  status: true,
  pipeline: true,
  product: true,
  productQty: true,
  product2: true,
  product2Qty: true,
  bookingDate: true,
  category: true,
  actualAmount: true,
  forecastedAmount: true,
  paymentMethod: true,
  state: true,
  street: true,
  city: true,
  nationalCode: true,
  callStatus: true,
  callAttempts: true,
  whatsappAttempts: true,
  assignments: { select: { userId: true } },
  tags: { select: { tagId: true } },
} satisfies Prisma.LeadSelect;

/**
 * Per-lead row quick actions (LEAD-10.1): duplicate, reassign, set-status and
 * delete a single lead straight from the list.
 *
 * Every action is scoped through `leadScopeWhere` — the same predicate the list,
 * export and bulk actions use — so a caller can only ever act on a lead they can
 * see; anything else is a 404, never a cross-scope mutation. Reassign and delete
 * delegate to `LeadsBulkService` with a single id rather than re-implementing the
 * scoped, transactional logic (no duplication — the bulk path is the one place
 * those two effects live). WhatsApp and email are absent by decision: they are
 * client-side deep-links (wa.me / mailto) resolved in LEAD-10.2, and real
 * sending belongs to the Integrations module, so there is no server action here.
 */
@Injectable()
export class LeadRowActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly bulk: LeadsBulkService,
  ) {}

  /**
   * Duplicates one lead into a new record (AC2). The source is loaded through the
   * caller's scope, so a lead they cannot see cannot be copied. Fields,
   * assignments and tags are cloned in a single create; a sales agent who can see
   * the source is necessarily one of its assignees, so the copy carries their
   * assignment and stays visible to them without a special case.
   */
  async duplicate(id: string): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();

    const source = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: LEAD_COPY_SELECT,
    });
    if (!source) throw new NotFoundException(OUT_OF_SCOPE_REASON);

    const { assignments, tags, ...scalars } = source;
    const data: Prisma.LeadCreateInput = {
      ...scalars,
      assignments: assignments.length
        ? {
            create: assignments.map((a) => ({
              user: { connect: { id: a.userId } },
            })),
          }
        : undefined,
      tags: tags.length
        ? {
            create: tags.map((t) => ({ tag: { connect: { id: t.tagId } } })),
          }
        : undefined,
    };

    const created = await this.prisma.lead.create({
      data,
      select: LEAD_LIST_SELECT,
    });
    return toLeadListItem(created);
  }

  /**
   * Reassigns one lead to `agentId` (AC3). Delegates to the bulk reassign so the
   * agent-validation and the delete+create-in-one-transaction live in a single
   * place; a lead outside scope comes back as a per-item failure, surfaced here
   * as a 404. The updated lead is returned so the row can reflect its new owner.
   */
  async reassign(id: string, dto: ReassignLeadDto): Promise<LeadListItem> {
    const result = await this.bulk.reassign({
      ids: [id],
      agentId: dto.agentId,
    });
    if (result.results[0]?.status !== 'success') {
      throw new NotFoundException(OUT_OF_SCOPE_REASON);
    }
    return this.loadById(id);
  }

  /**
   * Sets one lead's status to a caller-provided value (AC4). Scoped through the
   * same predicate before the update, so an out-of-scope id never mutates. Not a
   * toggle: the value is whatever the UI sends (see the DTO).
   */
  async setStatus(id: string, dto: SetLeadStatusDto): Promise<LeadListItem> {
    const user = await this.currentUser.resolve();

    const target = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id }] },
      select: { id: true },
    });
    if (!target) throw new NotFoundException(OUT_OF_SCOPE_REASON);

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { status: dto.status },
      select: LEAD_LIST_SELECT,
    });
    return toLeadListItem(updated);
  }

  /**
   * Permanently removes one lead (AC5, hard delete — matching the approved bulk
   * decision). Delegates to the bulk delete so the scope check and the cascading
   * hard delete are not written twice; an out-of-scope id is a 404.
   */
  async delete(id: string): Promise<RowDeleteResponse> {
    const result = await this.bulk.delete({ ids: [id] });
    if (result.results[0]?.status !== 'success') {
      throw new NotFoundException(OUT_OF_SCOPE_REASON);
    }
    return { id };
  }

  /** The lead by id after a successful action (it exists), as a list item. */
  private async loadById(id: string): Promise<LeadListItem> {
    const row = await this.prisma.lead.findUnique({
      where: { id },
      select: LEAD_LIST_SELECT,
    });
    if (!row) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    return toLeadListItem(row);
  }
}
