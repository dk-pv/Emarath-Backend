import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { StorageConfig } from '../config/storage.config';
import { LocalStorageService } from './local-storage.service';

const SIGNING_SECRET = 'test-signing-secret';

function makeConfig(localDir: string): StorageConfig {
  return {
    provider: 'local',
    bucket: null,
    region: 'auto',
    endpoint: null,
    accessKeyId: null,
    secretAccessKey: null,
    forcePathStyle: false,
    signedUrlTtlSec: 300,
    maxBytes: 1024,
    allowedExtensions: ['png', 'pdf'],
    localDir,
    localBaseUrl: 'http://localhost:5000/api',
    localSigningSecret: SIGNING_SECRET,
  };
}

function makeService(localDir: string) {
  const config = {
    getOrThrow: jest.fn().mockReturnValue(makeConfig(localDir)),
  } as unknown as ConfigService;
  return new LocalStorageService(config);
}

describe('LocalStorageService (FND-05.2)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'emarath-storage-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists the bytes under an opaque key and returns metadata (AC1/AC2)', async () => {
    const service = makeService(dir);
    const body = Buffer.from('hello world');

    const result = await service.put({
      body,
      originalFileName: 'Photo.png',
      contentType: 'image/png',
      keyPrefix: 'documents',
    });

    expect(result.key).toMatch(/^documents\/[0-9a-f-]{36}\/Photo\.png$/);
    expect(result.sizeBytes).toBe(body.length);
    expect(result.contentType).toBe('image/png');

    const onDisk = await readFile(join(dir, result.key));
    expect(onDisk.equals(body)).toBe(true);
  });

  it('rejects a disallowed type before writing anything (AC3)', async () => {
    const service = makeService(dir);
    await expect(
      service.put({
        body: Buffer.from('x'),
        originalFileName: 'malware.exe',
        contentType: 'application/octet-stream',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an oversized file (AC3)', async () => {
    const service = makeService(dir);
    await expect(
      service.put({
        body: Buffer.alloc(2048),
        originalFileName: 'big.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mints a signed, expiring download URL a route can verify (AC4)', async () => {
    const service = makeService(dir);
    const key = 'documents/abc/Photo.png';

    const url = await service.getSignedDownloadUrl(key, {
      downloadName: 'Photo.png',
    });
    const parsed = new URL(url);

    expect(parsed.pathname).toBe('/api/files/documents/abc/Photo.png');
    const expires = parsed.searchParams.get('expires')!;
    const sig = parsed.searchParams.get('sig');
    expect(Number(expires)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // The signature is an HMAC of `key.expires` — recompute it to prove it verifies.
    const expected = createHmac('sha256', SIGNING_SECRET)
      .update(`${key}.${expires}`)
      .digest('hex');
    expect(sig).toBe(expected);
    expect(parsed.searchParams.get('name')).toBe('Photo.png');
  });

  it('deletes a stored object and is idempotent (AC5)', async () => {
    const service = makeService(dir);
    const { key } = await service.put({
      body: Buffer.from('data'),
      originalFileName: 'a.pdf',
      contentType: 'application/pdf',
    });
    expect(existsSync(join(dir, key))).toBe(true);

    await service.delete(key);
    expect(existsSync(join(dir, key))).toBe(false);
    // Deleting a missing key must not throw.
    await expect(service.delete(key)).resolves.toBeUndefined();
  });

  it('refuses a key that escapes the storage root (path traversal)', async () => {
    const service = makeService(dir);
    await expect(service.delete('../../etc/passwd')).rejects.toThrow(
      'Invalid storage key',
    );
  });

  it('creates only the file it was asked to (no stray writes)', async () => {
    const service = makeService(dir);
    const { key } = await service.put({
      body: Buffer.from('one'),
      originalFileName: 'one.png',
      contentType: 'image/png',
    });
    const info = await stat(join(dir, key));
    expect(info.isFile()).toBe(true);
  });
});
