import { Injectable, NotFoundException } from '@nestjs/common';
import { MessageTemplateStatus, Prisma } from '../generated/prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user';
import {
  AuditActor,
  AuditState,
  RENAME,
  recordAuditEvents,
  recordStateChange,
  userActor,
} from '../audit/audit-events';
import {
  CreateMessageTemplateDto,
  DEFAULT_TEMPLATE_PAGE_SIZE,
  ListMessageTemplatesQueryDto,
  MessageTemplateList,
  MessageTemplateRow,
  UpdateMessageTemplateDto,
} from './dto/message-template.dto';

/** What every read selects — the list columns plus the content the form reopens. */
const SELECT = {
  id: true,
  name: true,
  type: true,
  content: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.MessageTemplateSelect;

type Selected = Prisma.MessageTemplateGetPayload<{ select: typeof SELECT }>;

function toRow(row: Selected): MessageTemplateRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    content: row.content,
    status: row.status,
    // No attachment store is wired to templates yet (ADR-0068).
    attachments: null,
    createdByName: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A template as its audit events describe it (AUD-04). The body itself never enters the log — a
 * customer-facing message is not history the log needs to hold — so a content change shows as
 * a new fingerprint: the first 16 hex digits of the body's SHA-256. The key avoids "hash", which
 * the Audit Log's redaction would blank.
 */
function templateState(
  row: Pick<Selected, 'name' | 'type' | 'status' | 'content'>,
): AuditState {
  return {
    name: row.name,
    type: row.type,
    status: row.status,
    contentFingerprint: createHash('sha256')
      .update(row.content)
      .digest('hex')
      .slice(0, 16),
  };
}

const templateEvent = (id: string, actor: AuditActor, source: string) => ({
  entityType: 'MESSAGE_TEMPLATE' as const,
  entityId: id,
  leadId: null,
  actor,
  source,
});

/** The switch is boolean; the column is the enum the list draws. */
function statusFor(isActive: boolean): MessageTemplateStatus {
  return isActive
    ? MessageTemplateStatus.ACTIVE
    : MessageTemplateStatus.VERIFICATION_PENDING;
}

/**
 * Settings → Communication → Templates.
 *
 * Search, type filter and paging are all resolved in the query, never in the client: the
 * screen must stay correct once a tenant has more templates than one page, and the table
 * carries indexes on `(deleted_at, type)`, `(deleted_at, status)` and `(deleted_at, name)`
 * for exactly these predicates.
 *
 * Deletes are soft (CLAUDE.md §11) and every query names `deletedAt` explicitly, because
 * no automatic filter exists yet.
 */
@Injectable()
export class MessageTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async list(
    query: ListMessageTemplatesQueryDto,
  ): Promise<MessageTemplateList> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_TEMPLATE_PAGE_SIZE;

    const where: Prisma.MessageTemplateWhereInput = {
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      // The reference's search sits over the Template Name column.
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.messageTemplate.findMany({
        where,
        select: SELECT,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.messageTemplate.count({ where }),
    ]);

    return { rows: rows.map(toRow), total };
  }

  async create(
    dto: CreateMessageTemplateDto,
    actorId: string,
  ): Promise<MessageTemplateRow> {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.messageTemplate.create({
        data: {
          name: dto.name,
          type: dto.type,
          content: dto.content,
          status: statusFor(dto.isActive),
          createdById: actorId,
        },
        select: SELECT,
      });
      await recordAuditEvents(tx, [
        {
          ...templateEvent(
            row.id,
            userActor({ id: actorId }),
            'message-templates.create',
          ),
          action: 'CREATED',
          after: templateState(row),
        },
      ]);
      return row;
    });
    return toRow(created);
  }

  /**
   * Updates the row in place — an edit must never leave a second copy behind, so the id
   * is matched and only the fields the modal sent are written. Recorded in the same
   * transaction, compared under a lock on the row (AUD-04): a new name is a RENAMED; a new
   * type, status or body is one UPDATED; a save that changes nothing records nothing.
   */
  async update(
    id: string,
    dto: UpdateMessageTemplateDto,
  ): Promise<MessageTemplateRow> {
    await this.requireLive(id);

    const actor = userActor(await this.currentUser.resolve());
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM message_templates WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.messageTemplate.findUniqueOrThrow({
        where: { id },
        select: SELECT,
      });
      const row = await tx.messageTemplate.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.type === undefined ? {} : { type: dto.type }),
          ...(dto.content === undefined ? {} : { content: dto.content }),
          ...(dto.isActive === undefined
            ? {}
            : { status: statusFor(dto.isActive) }),
        },
        select: SELECT,
      });
      await recordStateChange(
        tx,
        templateEvent(id, actor, 'message-templates.update'),
        templateState(before),
        templateState(row),
        [RENAME],
      );
      return row;
    });
    return toRow(updated);
  }

  /** Soft delete: the row leaves every list but the record is not destroyed. */
  async remove(id: string): Promise<{ id: string }> {
    await this.requireLive(id);

    const actor = userActor(await this.currentUser.resolve());
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM message_templates WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.messageTemplate.findUniqueOrThrow({
        where: { id },
        select: SELECT,
      });
      await tx.messageTemplate.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: { id: true },
      });
      await recordAuditEvents(tx, [
        {
          ...templateEvent(id, actor, 'message-templates.delete'),
          action: 'DELETED',
          before: templateState(before),
        },
      ]);
    });
    return { id };
  }

  /** A already-deleted row is as absent as one that never existed. */
  private async requireLive(id: string): Promise<void> {
    const existing = await this.prisma.messageTemplate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException('That template no longer exists.');
  }
}
