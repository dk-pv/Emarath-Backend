import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client';
import { CurrentUser, CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { documentScopeWhere, documentDeletableWhere } from './document-scope';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import {
  BulkDeleteDocumentsDto,
  BulkActionResponse,
  documentBulkResponse,
} from './dto/bulk-delete-documents.dto';
import {
  ListDocumentsQueryDto,
  type DocumentSortColumn,
  type DocumentTypeFilter,
} from './dto/list-documents-query.dto';
import {
  DOCUMENT_LIST_SELECT,
  DOCUMENT_SELECT,
  DocumentListResponse,
  DocumentResponse,
  toDocumentListItem,
  toDocumentResponse,
} from './dto/document-response.dto';

const DOCUMENT_OUT_OF_SCOPE =
  'That document does not exist or is not in your scope.';

/**
 * Maps a validated sort column to a Prisma `orderBy`. `uploadedBy` orders by the
 * uploader's name through the relation; every other column is a direct field. A
 * stable `id` tiebreak is appended so a row can't swap pages between two equal keys.
 */
function documentOrderBy(
  sort: DocumentSortColumn,
  direction: 'asc' | 'desc',
): Prisma.DocumentOrderByWithRelationInput[] {
  const primary: Prisma.DocumentOrderByWithRelationInput =
    sort === 'uploadedBy'
      ? { uploader: { name: direction } }
      : { [sort]: direction };
  return [primary, { id: 'asc' }];
}

/**
 * The "All Documents" file-type filter as a query fragment (DOC-06.1). Matches on the
 * file's own extension — the value the "Type" column displays — case-insensitively, so
 * the filter and the column always agree (the stored MIME is un-normalised browser
 * input and would disagree for octet-stream office files). `jpg` covers both `.jpg`
 * and `.jpeg`, mirroring the single "JPG" option the reference dropdown shows.
 */
function documentTypeWhere(
  type: DocumentTypeFilter,
): Prisma.DocumentWhereInput {
  const extensions = type === 'jpg' ? ['.jpg', '.jpeg'] : [`.${type}`];
  return {
    OR: extensions.map((extension) => ({
      fileName: { endsWith: extension, mode: 'insensitive' as const },
    })),
  };
}

/**
 * Escapes the characters LIKE treats as wildcards so a search term matches literally
 * (mirrors `escapeLike` in Leads). Prisma's `contains` parameterises the value — no
 * injection — but does not escape `%`/`_`, so "50%" would otherwise match "5…". The
 * backslash is escaped first, before the escapes it introduces.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * The rows matching a free-text name search, as a query fragment (DOC-07.1).
 *
 * Scope is the backlog's "by name": the document's `title` — the value the "File Name"
 * column shows — and nothing else (the actual `fileName`/attachment is excluded until a
 * reference proves it, the same discipline Leads applies). `contains` is an unanchored,
 * case-insensitive substring (AC1/AC4). Returns `undefined` for an empty or
 * whitespace-only term, so the caller adds no condition and the filtered list is
 * returned unchanged (AC5).
 */
function documentSearchWhere(
  term: string | undefined,
): Prisma.DocumentWhereInput | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;
  return { title: { contains: escapeLike(trimmed), mode: 'insensitive' } };
}

/**
 * Document writes (DOC-02.1). Injects the shared `StorageService` — the single upload
 * implementation every future module reuses — plus `PrismaService`; no repository, for the
 * same reason Activities has none (one put plus one nested create).
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /**
   * One scoped page of documents plus the total (DOC-03.1).
   *
   * The scope is applied in the `where` (AC4), so pagination, sorting and the count
   * all run over the same restricted set — a caller can never page, sort or count
   * past the documents they may access. The page and its total run in one
   * transaction (the Leads findPage rule) so a concurrent upload can't make the
   * count disagree with the page. Each row carries a fresh short-lived signed link
   * minted from `storageKey` (AC2); the key itself is never returned.
   */
  async list(query: ListDocumentsQueryDto): Promise<DocumentListResponse> {
    const user = await this.currentUser.resolve();
    const scope = documentScopeWhere(user);
    // Type filter (DOC-06.1) and name search (DOC-07.1) each AND into the scoped where,
    // so they can only ever narrow what the caller may already see (DOC-06.1 AC2 /
    // DOC-07.1 AC2) — never widen it — and combine with each other (AC3). No filter and
    // no search leaves the DOC-03.1 query unchanged (bare scope).
    const filters: Prisma.DocumentWhereInput[] = [];
    if (query.type) filters.push(documentTypeWhere(query.type));
    const search = documentSearchWhere(query.search);
    if (search) filters.push(search);
    const where: Prisma.DocumentWhereInput =
      filters.length > 0 ? { AND: [scope, ...filters] } : scope;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        select: DOCUMENT_LIST_SELECT,
        orderBy: documentOrderBy(query.sort, query.direction),
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.document.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (row) =>
        toDocumentListItem(
          row,
          await this.storage.getSignedDownloadUrl(row.storageKey, {
            downloadName: row.fileName,
          }),
        ),
      ),
    );

    return { rows: items, total };
  }

  /**
   * Uploads a document (DOC-02.1).
   *
   * The bytes go through `StorageService.put`, which is the sole type/size gate (AC3) and
   * owns the opaque key, then the metadata and its access whitelist are one nested create
   * (atomic — a bad user id leaves no half-built row). Because the file is stored before
   * the row exists, a failed metadata write is compensated by deleting the object, so a
   * rejected create never orphans stored bytes (AC5). The response carries a short-lived
   * signed link (AC1). The uploader is always the owner (AC4); an empty `userIds` is the
   * default owner-only access.
   */
  async create(
    file: Express.Multer.File | undefined,
    dto: CreateDocumentDto,
  ): Promise<DocumentResponse> {
    if (!file) throw new BadRequestException('A file is required.');
    const user = await this.currentUser.resolve();

    const stored = await this.storage.put({
      body: file.buffer,
      originalFileName: file.originalname,
      contentType: file.mimetype,
      keyPrefix: 'documents',
    });

    const userIds = [...new Set(dto.userIds ?? [])];
    let row: Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;
    try {
      row = await this.prisma.document.create({
        data: {
          title: dto.title,
          fileName: file.originalname,
          storageKey: stored.key,
          sizeBytes: stored.sizeBytes,
          contentType: stored.contentType,
          category: dto.category ?? null,
          uploader: { connect: { id: user.id } },
          access: {
            create: userIds.map((userId) => ({
              user: { connect: { id: userId } },
            })),
          },
        },
        select: DOCUMENT_SELECT,
      });
    } catch (error) {
      // The bytes are already stored; a failed metadata write would orphan them.
      // delete is idempotent, so this is safe even if the object never landed.
      await this.storage.delete(stored.key);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2025')
      ) {
        throw new BadRequestException(
          'One or more selected users do not exist.',
        );
      }
      throw error;
    }

    const downloadUrl = await this.storage.getSignedDownloadUrl(
      row.storageKey,
      {
        downloadName: row.fileName,
      },
    );
    return toDocumentResponse(row, downloadUrl);
  }

  /**
   * One scoped document with its access list, for the Edit drawer to load current
   * values (DOC-04.1). Scoped like the list, so an out-of-scope, unknown or
   * soft-deleted id is a 404 — never a cross-scope read.
   */
  async findById(id: string): Promise<DocumentResponse> {
    const user = await this.currentUser.resolve();
    const row = await this.prisma.document.findFirst({
      where: { AND: [documentScopeWhere(user), { id }] },
      select: DOCUMENT_SELECT,
    });
    if (!row) throw new NotFoundException(DOCUMENT_OUT_OF_SCOPE);
    return this.signedResponse(row);
  }

  /**
   * Renames a document and/or replaces its access whitelist (DOC-04.1).
   *
   * Authorization is two-layered and server-side: the row is first read through the
   * caller's scope, so a document they cannot see is a 404 (no existence leak; this
   * also excludes soft-deleted rows). Then editing is gated to the owner or a
   * SUPERADMIN — a user merely granted view access gets a 403, never a silent
   * write. Knowing the id is never enough.
   *
   * The whitelist is replaced wholesale in one nested write (`deleteMany` then
   * `create`), which Prisma runs atomically, so metadata and access can't land in
   * an inconsistent state and the resulting grants are exactly the set sent — no
   * unrelated user is kept or added. Ids are de-duplicated to respect the
   * (document, user) uniqueness; a non-existent user fails the foreign key and is a
   * clear 400, not a 500. The file bytes (fileName/storageKey) are never touched.
   */
  async update(id: string, dto: UpdateDocumentDto): Promise<DocumentResponse> {
    const user = await this.currentUser.resolve();

    const existing = await this.prisma.document.findFirst({
      where: { AND: [documentScopeWhere(user), { id }] },
      select: { id: true, uploaderId: true },
    });
    if (!existing) throw new NotFoundException(DOCUMENT_OUT_OF_SCOPE);
    this.assertCanEdit(user, existing.uploaderId);

    const data: Prisma.DocumentUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.userIds !== undefined) {
      const userIds = [...new Set(dto.userIds)];
      data.access = {
        deleteMany: {},
        create: userIds.map((userId) => ({
          user: { connect: { id: userId } },
        })),
      };
    }

    try {
      const row = await this.prisma.document.update({
        where: { id },
        data,
        select: DOCUMENT_SELECT,
      });
      return this.signedResponse(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2025')
      ) {
        throw new BadRequestException(
          'One or more selected users do not exist.',
        );
      }
      throw error;
    }
  }

  /**
   * Permanently deletes a document — the row and its stored file (DOC-05.1).
   *
   * Authorized exactly like {@link update}: read through the caller's scope (an
   * unseen, foreign or already-deleted id is a 404), then gated to the owner or a
   * SUPERADMIN (a view grant gets a 403). The stored object is removed first, then
   * the row (its `DocumentAccess` grants cascade at the database). Storage-first is
   * deliberate: `StorageService.delete` is idempotent, so a failure after the row
   * is gone would strand the object forever (the key lives on the row); doing
   * storage first keeps the whole delete retryable until the bytes are actually
   * removed (AC3). This is a hard delete per the backlog (AC3/AC4), not the
   * `deletedAt` soft-delete convention.
   */
  async remove(id: string): Promise<{ id: string }> {
    const user = await this.currentUser.resolve();

    const existing = await this.prisma.document.findFirst({
      where: { AND: [documentScopeWhere(user), { id }] },
      select: { id: true, uploaderId: true, storageKey: true },
    });
    if (!existing) throw new NotFoundException(DOCUMENT_OUT_OF_SCOPE);
    this.assertCanEdit(user, existing.uploaderId);

    await this.storage.delete(existing.storageKey);
    await this.prisma.document.delete({ where: { id } });
    return { id };
  }

  /**
   * Permanently deletes the caller's selected documents — rows and stored files (DOC-08.1).
   *
   * The browser's id set is never trusted: the actionable subset is the requested ids that
   * are both deletable by the caller (owner or SUPERADMIN, via {@link documentDeletableWhere})
   * and present — computed in one scoped query. Every id outside that set (a view-only grant,
   * another user's document, an arbitrary or already-deleted id) is reported `failed` and left
   * untouched, never deleted (AC4). The actionable objects are removed from storage first
   * (idempotent, so a failure leaves the delete retryable), then their rows go in one
   * `deleteMany` (DocumentAccess cascades). Hard delete, matching the single delete (DOC-05.1).
   */
  async bulkDelete(dto: BulkDeleteDocumentsDto): Promise<BulkActionResponse> {
    const user = await this.currentUser.resolve();
    const ids = [...new Set(dto.ids)];

    const actionable = await this.prisma.document.findMany({
      where: { AND: [documentDeletableWhere(user), { id: { in: ids } }] },
      select: { id: true, storageKey: true },
    });

    await Promise.all(
      actionable.map((row) => this.storage.delete(row.storageKey)),
    );
    if (actionable.length > 0) {
      await this.prisma.document.deleteMany({
        where: { id: { in: actionable.map((row) => row.id) } },
      });
    }

    return documentBulkResponse(ids, new Set(actionable.map((row) => row.id)));
  }

  /** Only the uploader (owner) or a SUPERADMIN may edit; a view grant is not enough. */
  private assertCanEdit(user: CurrentUser, uploaderId: string): void {
    if (user.role === UserRole.SUPERADMIN || uploaderId === user.id) return;
    throw new ForbiddenException(
      'You do not have permission to edit this document.',
    );
  }

  /** Maps a full document row to the response with a fresh short-lived signed link. */
  private async signedResponse(
    row: Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>,
  ): Promise<DocumentResponse> {
    const downloadUrl = await this.storage.getSignedDownloadUrl(
      row.storageKey,
      {
        downloadName: row.fileName,
      },
    );
    return toDocumentResponse(row, downloadUrl);
  }
}
