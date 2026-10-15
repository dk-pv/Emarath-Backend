import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { userActor } from '../../audit/audit-events';
import { TagAccessService } from '../../tag-access/tag-access.service';
import { auditLeadChanges } from '../lead-audit';
import { leadScopeWhere } from '../lead-scope';
import { assertMayChangeLead } from '../../pipelines/pipeline-access';
import {
  LeadListItem,
  LEAD_LIST_SELECT,
  toLeadListItem,
} from '../dto/lead-response.dto';
import { OUT_OF_SCOPE_REASON } from '../bulk/dto/bulk-actions.dto';
import { AddLeadTagDto } from './dto/lead-tag.dto';

/**
 * Per-lead tag mutations (LEAD-12.1): apply an existing tag to a lead (AC1) and
 * remove one from it (AC2), straight from the list's Tags cell.
 *
 * Both scope through `leadScopeWhere` first — the same predicate the list, export
 * and every other row action use — so a caller can only tag a lead they can
 * already see; an out-of-scope id is a 404, never a cross-scope write. The lead
 * is returned as a list item so the row can refresh its chips in place (AC3).
 *
 * Tags are applied, not created: the picker offers only existing tags, and
 * creating tags is FND-04.2's reference-data concern. A tag id that does not
 * exist fails the foreign key and is reported as a 400, not a 500.
 *
 * Tag Permissions (ADR-0091) are checked after the scope gate and before any write: a
 * caller who may see the lead but may not select that tag gets a 403, for adding and for
 * removing alike — a tag the Admin keeps out of someone's hands is not theirs to strip off.
 */
@Injectable()
export class LeadTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
    private readonly access: TagAccessService,
  ) {}

  /**
   * Applies one existing tag to an in-scope lead (AC1). The `@@unique([leadId,
   * tagId])` constraint makes a repeat a 409 rather than a duplicate row, so the
   * same tag can never sit on a lead twice (AC5).
   */
  async add(leadId: string, dto: AddLeadTagDto): Promise<LeadListItem> {
    const user = await this.assertInScope(leadId);
    await this.access.assertMayHandle(user, [dto.tagId]);

    try {
      await auditLeadChanges(
        this.prisma,
        [leadId],
        { actor: userActor(user), source: 'leads.tags' },
        (tx) =>
          tx.leadTag.create({
            data: {
              lead: { connect: { id: leadId } },
              tag: { connect: { id: dto.tagId } },
            },
          }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // The same tag is already on the lead — the unique index (AC5).
        if (error.code === 'P2002') {
          throw new ConflictException('That tag is already on this lead.');
        }
        // The tag id does not exist — the connect fails the foreign key.
        if (error.code === 'P2003' || error.code === 'P2025') {
          throw new BadRequestException('That tag does not exist.');
        }
      }
      throw error;
    }

    return this.loadById(leadId);
  }

  /**
   * Removes one tag from an in-scope lead (AC2). Idempotent: deleting a link that
   * is not there is a no-op, so a double-click or a stale row never errors — the
   * lead simply comes back without the tag.
   */
  async remove(leadId: string, tagId: string): Promise<LeadListItem> {
    const user = await this.assertInScope(leadId);
    await this.access.assertMayHandle(user, [tagId]);
    await auditLeadChanges(
      this.prisma,
      [leadId],
      { actor: userActor(user), source: 'leads.tags' },
      (tx) => tx.leadTag.deleteMany({ where: { leadId, tagId } }),
    );
    return this.loadById(leadId);
  }

  /**
   * 404s unless the caller may see this lead — the write's scope gate — and 403s when they
   * may only see it, in a pipeline closed to them (ADR-0093 B2).
   */
  private async assertInScope(leadId: string): Promise<CurrentUser> {
    const user = await this.currentUser.resolve();
    const lead = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere(user), { id: leadId }] },
      select: { id: true, pipeline: true },
    });
    if (!lead) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    assertMayChangeLead(user, lead);
    return user;
  }

  /** The lead by id after a successful mutation, as a list item. */
  private async loadById(id: string): Promise<LeadListItem> {
    const row = await this.prisma.lead.findUnique({
      where: { id },
      select: LEAD_LIST_SELECT,
    });
    if (!row) throw new NotFoundException(OUT_OF_SCOPE_REASON);
    return toLeadListItem(row);
  }
}
