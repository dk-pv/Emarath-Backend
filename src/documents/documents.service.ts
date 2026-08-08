import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { documentScopeWhere } from './document-scope';
import { CreateDocumentDto } from './dto/create-document.dto';
import {
  ListDocumentsQueryDto,
  type DocumentSortColumn,
} from './dto/list-documents-query.dto';
import {
  DOCUMENT_LIST_SELECT,
  DOCUMENT_SELECT,
  DocumentListResponse,
  DocumentResponse,
  toDocumentListItem,
  toDocumentResponse,
} from './dto/document-response.dto';

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
    const where = documentScopeWhere(user);

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
}
