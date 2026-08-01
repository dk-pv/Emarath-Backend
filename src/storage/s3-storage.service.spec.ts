import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { StorageConfig } from '../config/storage.config';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
  DeleteObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/download'),
}));

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3StorageService } from './s3-storage.service';

const S3_CONFIG: StorageConfig = {
  provider: 's3',
  bucket: 'emarath-documents',
  region: 'auto',
  endpoint: 'https://acc.r2.cloudflarestorage.com',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  forcePathStyle: false,
  signedUrlTtlSec: 300,
  maxBytes: 1024,
  allowedExtensions: ['png', 'pdf'],
  localDir: '.storage',
  localBaseUrl: 'http://localhost:5000/api',
  localSigningSecret: 'x',
};

function makeService(config: StorageConfig = S3_CONFIG) {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(config),
  } as unknown as ConfigService;
  return new S3StorageService(configService);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('S3StorageService (FND-05.2)', () => {
  it('builds the client from the configured endpoint/region/credentials (R2/S3/MinIO)', () => {
    makeService();
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'auto',
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        forcePathStyle: false,
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      }),
    );
  });

  it('puts an object under a server-generated key and returns metadata (AC1/AC2)', async () => {
    mockSend.mockResolvedValue({ ETag: '"abc123"' });
    const service = makeService();
    const body = Buffer.from('image-bytes');

    const result = await service.put({
      body,
      originalFileName: 'Photo.png',
      contentType: 'image/png',
      keyPrefix: 'documents',
    });

    const putArg = (
      (PutObjectCommand as unknown as jest.Mock).mock.calls as unknown[][]
    )[0][0] as {
      Bucket: string;
      Key: string;
      Body: Buffer;
      ContentType: string;
    };
    expect(putArg.Bucket).toBe('emarath-documents');
    expect(putArg.Key).toMatch(/^documents\/[0-9a-f-]{36}\/Photo\.png$/);
    expect(putArg.Body).toBe(body);
    expect(putArg.ContentType).toBe('image/png');

    expect(result.key).toBe(putArg.Key);
    expect(result.sizeBytes).toBe(body.length);
    expect(result.etag).toBe('"abc123"');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('enforces the upload policy before calling S3 (AC3)', async () => {
    const service = makeService();
    await expect(
      service.put({
        body: Buffer.from('x'),
        originalFileName: 'malware.exe',
        contentType: 'application/octet-stream',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('mints a presigned download URL with the configured TTL (AC4)', async () => {
    const service = makeService();
    const url = await service.getSignedDownloadUrl('documents/abc/Photo.png', {
      downloadName: 'Photo.png',
    });

    expect(url).toBe('https://signed.example/download');
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: 300 },
    );
  });

  it('deletes an object by key (AC5)', async () => {
    mockSend.mockResolvedValue({});
    const service = makeService();
    await service.delete('documents/abc/Photo.png');

    const delArg = (
      (DeleteObjectCommand as unknown as jest.Mock).mock.calls as unknown[][]
    )[0][0] as { Bucket: string; Key: string };
    expect(delArg).toEqual({
      Bucket: 'emarath-documents',
      Key: 'documents/abc/Photo.png',
    });
  });

  it('refuses to construct without a bucket + credentials (fail closed)', () => {
    expect(() => makeService({ ...S3_CONFIG, bucket: null })).toThrow(
      'S3 storage requires a bucket and credentials.',
    );
  });
});
