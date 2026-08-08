import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';

const file = (): Express.Multer.File =>
  ({
    buffer: Buffer.from('bytes'),
    originalname: 'combo.png',
    mimetype: 'image/png',
    size: 5,
  }) as Express.Multer.File;

const dto = (over: Partial<CreateDocumentDto> = {}): CreateDocumentDto => ({
  title: 'Product Images',
  ...over,
});

const storedRow = {
  id: 'doc-1',
  title: 'Product Images',
  fileName: 'combo.png',
  storageKey: 'documents/uuid/combo.png',
  sizeBytes: 5,
  contentType: 'image/png',
  category: null,
  createdAt: new Date('2026-06-12T11:56:24.000Z'),
  uploader: { id: 'user-1', name: 'Ahamed Emarath' },
  access: [{ user: { id: 'user-2', name: 'Agent Two' } }],
};

/** A row as DOCUMENT_LIST_SELECT projects it (no `access`, keeps `storageKey`). */
const listRow = {
  id: 'doc-1',
  title: 'Product Images',
  fileName: 'combo.png',
  storageKey: 'documents/uuid/combo.png',
  sizeBytes: 5,
  contentType: 'image/png',
  createdAt: new Date('2026-06-12T11:56:24.000Z'),
  uploader: { id: 'user-1', name: 'Ahamed Emarath' },
};

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: {
    document: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let storage: {
    put: jest.Mock;
    getSignedDownloadUrl: jest.Mock;
    delete: jest.Mock;
  };
  let currentUser: { resolve: jest.Mock };

  beforeEach(() => {
    prisma = {
      document: {
        create: jest.fn().mockResolvedValue(storedRow),
        findMany: jest.fn().mockReturnValue('findMany-op'),
        count: jest.fn().mockReturnValue('count-op'),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'doc-1', uploaderId: 'user-1' }),
        update: jest.fn().mockResolvedValue(storedRow),
      },
      // The service composes [findMany, count] and awaits them together; the mock
      // resolves the tuple so the two ops need no real client.
      $transaction: jest.fn().mockResolvedValue([[listRow], 1]),
    };
    storage = {
      put: jest.fn().mockResolvedValue({
        key: 'documents/uuid/combo.png',
        sizeBytes: 5,
        contentType: 'image/png',
      }),
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed/link'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    currentUser = {
      resolve: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', role: 'SALES_MANAGER' }),
    };
    service = new DocumentsService(
      prisma as unknown as PrismaService,
      storage,
      currentUser,
    );
  });

  /** The Document.create data arg, in the house `mock.calls` narrowing style. */
  const createData = (): Record<string, unknown> =>
    (
      (prisma.document.create.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  it('stores the file through StorageService and persists metadata + access', async () => {
    const result = await service.create(file(), dto({ userIds: ['user-2'] }));

    const put = (storage.put.mock.calls as unknown[][])[0][0] as {
      body: Buffer;
      originalFileName: string;
      contentType: string;
      keyPrefix: string;
    };
    expect(put.keyPrefix).toBe('documents');
    expect(put.originalFileName).toBe('combo.png');
    expect(put.contentType).toBe('image/png');
    expect(Buffer.isBuffer(put.body)).toBe(true);

    const data = createData();
    expect(data.storageKey).toBe('documents/uuid/combo.png');
    expect(data.uploader).toEqual({ connect: { id: 'user-1' } });
    expect(data.access).toEqual({
      create: [{ user: { connect: { id: 'user-2' } } }],
    });
    expect(result.downloadUrl).toBe('https://signed/link');
    expect(result.uploadedBy).toEqual({ id: 'user-1', name: 'Ahamed Emarath' });
    expect(result.access).toEqual([{ id: 'user-2', name: 'Agent Two' }]);
  });

  it('defaults to owner-only access when no users are selected', async () => {
    await service.create(file(), dto());
    expect(createData().access).toEqual({ create: [] });
  });

  it('rejects a request with no file and never touches storage', async () => {
    await expect(service.create(undefined, dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('removes the stored object and returns a clear error when the write fails', async () => {
    prisma.document.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'x',
      }),
    );

    await expect(
      service.create(file(), dto({ userIds: ['ghost'] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.delete).toHaveBeenCalledWith('documents/uuid/combo.png');
  });

  /** The `where` passed to the mocked findMany, for scope/order assertions. */
  const findManyArg = (): {
    where: Record<string, unknown>;
    orderBy: unknown;
    skip: number;
    take: number;
  } =>
    (prisma.document.findMany.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
      skip: number;
      take: number;
    };

  const listQuery = (
    over: Partial<ListDocumentsQueryDto> = {},
  ): ListDocumentsQueryDto => ({
    page: 1,
    size: 25,
    sort: 'createdAt',
    direction: 'desc',
    ...over,
  });

  it('lists a scoped page with a signed link per row and the total', async () => {
    const result = await service.list(listQuery());

    expect(result.total).toBe(1);
    expect(result.rows).toEqual([
      {
        id: 'doc-1',
        title: 'Product Images',
        fileName: 'combo.png',
        sizeBytes: 5,
        contentType: 'image/png',
        createdAt: '2026-06-12T11:56:24.000Z',
        uploadedBy: { id: 'user-1', name: 'Ahamed Emarath' },
        downloadUrl: 'https://signed/link',
      },
    ]);
    // The link is minted from the storage key; the key itself is never in the row.
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
      'documents/uuid/combo.png',
      { downloadName: 'combo.png' },
    );
    const arg = findManyArg();
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(25);
  });

  it('scopes the query so a caller only loads documents they may access', async () => {
    await service.list(listQuery());

    // SALES_MANAGER (user-1): owner-or-granted, never the whole table.
    expect(findManyArg().where).toEqual({
      deletedAt: null,
      OR: [
        { uploaderId: 'user-1' },
        { access: { some: { userId: 'user-1' } } },
      ],
    });
    // The count runs over the same scoped where (page and total cannot disagree).
    const countArg = (
      prisma.document.count.mock.calls as unknown[][]
    )[0][0] as {
      where: Record<string, unknown>;
    };
    expect(countArg.where).toEqual(findManyArg().where);
  });

  it('orders by the uploader relation when sorting by uploadedBy', async () => {
    await service.list(listQuery({ sort: 'uploadedBy', direction: 'asc' }));
    expect(findManyArg().orderBy).toEqual([
      { uploader: { name: 'asc' } },
      { id: 'asc' },
    ]);
  });

  // --- DOC-04.1 edit (rename + access) ---

  const updateArg = (): { where: unknown; data: Record<string, unknown> } =>
    (prisma.document.update.mock.calls as unknown[][])[0][0] as {
      where: unknown;
      data: Record<string, unknown>;
    };

  const asOwner = () =>
    currentUser.resolve.mockResolvedValue({
      id: 'user-1',
      role: 'SALES_MANAGER',
    });

  it('lets the owner rename and replace access, deduping ids', async () => {
    asOwner();
    prisma.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      uploaderId: 'user-1',
    });

    await service.update('doc-1', {
      title: 'Renamed',
      userIds: ['u2', 'u2', 'u3'],
    });

    expect(updateArg().where).toEqual({ id: 'doc-1' });
    expect(updateArg().data).toEqual({
      title: 'Renamed',
      access: {
        deleteMany: {},
        create: [
          { user: { connect: { id: 'u2' } } },
          { user: { connect: { id: 'u3' } } },
        ],
      },
    });
    // The scope predicate must gate the read (excludes deleted + cross-scope rows).
    expect((prisma.document.findFirst.mock.calls as unknown[][])[0][0]).toEqual(
      {
        where: {
          AND: [
            {
              deletedAt: null,
              OR: [
                { uploaderId: 'user-1' },
                { access: { some: { userId: 'user-1' } } },
              ],
            },
            { id: 'doc-1' },
          ],
        },
        select: { id: true, uploaderId: true },
      },
    );
  });

  it('touches access only when userIds is provided (title-only edit)', async () => {
    asOwner();
    await service.update('doc-1', { title: 'Just a rename' });
    expect(updateArg().data).toEqual({ title: 'Just a rename' });
  });

  it('forbids a view-only grantee (not the owner) from editing', async () => {
    asOwner(); // caller is user-1…
    prisma.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      uploaderId: 'someone-else', // …but not the owner
    });

    await expect(
      service.update('doc-1', { title: 'Hijack' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('404s (never edits) a document the caller cannot see, incl. deleted or foreign', async () => {
    asOwner();
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(
      service.update('doc-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('lets a SUPERADMIN edit any document they can see', async () => {
    currentUser.resolve.mockResolvedValue({ id: 'admin', role: 'SUPERADMIN' });
    prisma.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      uploaderId: 'someone-else',
    });

    await service.update('doc-1', { title: 'Admin edit' });
    expect(prisma.document.update).toHaveBeenCalled();
  });

  it('rejects a non-existent user in the access set with a clear 400', async () => {
    asOwner();
    prisma.document.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'x',
      }),
    );

    await expect(
      service.update('doc-1', { userIds: ['ghost'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findById scopes the read and 404s an out-of-scope id', async () => {
    asOwner();
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.findById('doc-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
