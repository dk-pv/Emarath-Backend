import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig } from '../config/storage.config';
import {
  StorageService,
  type PutObjectInput,
  type SignedDownloadOptions,
  type StoredObject,
} from './storage.service';
import { assertUploadAllowed, buildObjectKey } from './storage-policy';

/**
 * Staging/production transport (FND-05.2, ADR — file storage). Talks the S3 protocol, so one
 * adapter serves Cloudflare R2, AWS S3 and MinIO — only the endpoint/region/credentials
 * differ (config, not code). `forcePathStyle` is set for MinIO.
 *
 * The bucket is private: files are reached only through short-lived presigned GET URLs, which
 * the caller requests after authorising access. Keys are server-generated, so a client never
 * addresses the bucket directly.
 */
@Injectable()
export class S3StorageService extends StorageService {
  private readonly config: StorageConfig;
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: ConfigService) {
    super();
    const storage = config.getOrThrow<StorageConfig>('storage');
    if (!storage.bucket || !storage.accessKeyId || !storage.secretAccessKey) {
      // The config guards this for provider `s3`; assert so the types are non-null here.
      throw new Error('S3 storage requires a bucket and credentials.');
    }
    this.config = storage;
    this.bucket = storage.bucket;
    this.client = new S3Client({
      region: storage.region,
      endpoint: storage.endpoint ?? undefined,
      forcePathStyle: storage.forcePathStyle,
      credentials: {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
      },
    });
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
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );

    return {
      key,
      sizeBytes: input.body.length,
      contentType: input.contentType,
      etag: result.ETag,
    };
  }

  getSignedDownloadUrl(
    key: string,
    options?: SignedDownloadOptions,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: this.contentDisposition(options),
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options?.expiresInSec ?? this.config.signedUrlTtlSec,
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Force a download by default; only serve inline when the caller opts in. The consumer that
   * serves user-supplied SVG/HTML must keep `inline` off (stored-XSS defence) — this layer
   * honours the flag and pins the filename.
   */
  private contentDisposition(options?: SignedDownloadOptions): string {
    const type = options?.inline ? 'inline' : 'attachment';
    if (!options?.downloadName) {
      return type;
    }
    const safe = options.downloadName.replace(/["\\\r\n]/g, '_');
    return `${type}; filename="${safe}"`;
  }
}
