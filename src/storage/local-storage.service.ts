import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { StorageConfig } from '../config/storage.config';
import {
  StorageService,
  type PutObjectInput,
  type SignedDownloadOptions,
  type StoredObject,
} from './storage.service';
import { assertUploadAllowed, buildObjectKey } from './storage-policy';

/**
 * Development/test transport: persists uploads under a local (git-ignored) directory instead
 * of a cloud bucket, so the storage layer is fully usable with no account, credentials or
 * network — the LogMailerService analogue.
 *
 * `getSignedDownloadUrl` returns an HMAC-signed, expiring link to a dev file route
 * (`<baseUrl>/files/<key>?expires=…&sig=…`), matching the presigned-URL contract of the S3
 * adapter; the route that verifies the signature and streams the file is wired by the
 * download-serving layer, not this storage foundation.
 */
@Injectable()
export class LocalStorageService extends StorageService {
  private readonly config: StorageConfig;
  private readonly root: string;

  constructor(config: ConfigService) {
    super();
    this.config = config.getOrThrow<StorageConfig>('storage');
    this.root = resolve(this.config.localDir);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    assertUploadAllowed(
      {
        originalFileName: input.originalFileName,
        sizeBytes: input.body.length,
      },
      {
        allowedExtensions: this.config.allowedExtensions,
        maxBytes: this.config.maxBytes,
      },
    );

    const key = buildObjectKey(input.originalFileName, input.keyPrefix);
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);

    return {
      key,
      sizeBytes: input.body.length,
      contentType: input.contentType,
    };
  }

  getSignedDownloadUrl(
    key: string,
    options?: SignedDownloadOptions,
  ): Promise<string> {
    const ttl = options?.expiresInSec ?? this.config.signedUrlTtlSec;
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const signature = this.sign(key, expires);

    const params = new URLSearchParams({
      expires: String(expires),
      sig: signature,
    });
    if (options?.downloadName) {
      params.set('name', options.downloadName);
    }
    const base = this.config.localBaseUrl.replace(/\/+$/, '');
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return Promise.resolve(`${base}/files/${encodedKey}?${params.toString()}`);
  }

  async delete(key: string): Promise<void> {
    // force: true makes a missing file a no-op, so delete stays idempotent.
    await rm(this.resolveKey(key), { force: true });
  }

  /** HMAC of `key.expires`, so the future serving route can verify the link (FND-05.2 AC4). */
  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.config.localSigningSecret)
      .update(`${key}.${expires}`)
      .digest('hex');
  }

  /** Resolve a key under the storage root, refusing any path that escapes it (traversal). */
  private resolveKey(key: string): string {
    const path = resolve(join(this.root, key));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error('Invalid storage key.');
    }
    return path;
  }
}
