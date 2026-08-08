import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';

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

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: { document: { create: jest.Mock } };
  let storage: {
    put: jest.Mock;
    getSignedDownloadUrl: jest.Mock;
    delete: jest.Mock;
  };
  let currentUser: { resolve: jest.Mock };

  beforeEach(() => {
    prisma = { document: { create: jest.fn().mockResolvedValue(storedRow) } };
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
});
