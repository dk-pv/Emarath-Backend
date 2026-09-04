import { registerAs } from '@nestjs/config';

/**
 * File storage configuration (FND-05.2). Its own `storage` namespace, consumed via
 * `ConfigService.get<StorageConfig>('storage')` so application code never reads
 * `process.env` directly (CLAUDE §5).
 *
 * The provider is chosen by environment, mirroring the mail transport: development (and the
 * test suite) uses the local-filesystem adapter so uploads need no cloud account, bucket or
 * credentials; staging and production use the S3 adapter. Because the S3 adapter talks the
 * S3 protocol against a configurable endpoint, the same code serves Cloudflare R2, AWS S3
 * and MinIO — the provider is config, not code. When `s3` is selected the bucket and keys
 * are required and the app refuses to boot without them (fail-closed, like the JWT secret).
 */
export type StorageProvider = 'local' | 's3';

export interface StorageConfig {
  provider: StorageProvider;
  /** Bucket name — required when provider is `s3`. */
  bucket: string | null;
  /** Region; `auto` for R2. AWS S3 needs a real region (e.g. `ap-southeast-1`). */
  region: string;
  /** Custom endpoint for R2/MinIO; null uses AWS S3's default endpoint. */
  endpoint: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  /** Path-style addressing — required by MinIO, harmless elsewhere. */
  forcePathStyle: boolean;
  /** Lifetime of a presigned download URL, in seconds. */
  signedUrlTtlSec: number;
  /** Maximum accepted upload size, in bytes. */
  maxBytes: number;
  /** Allowed file extensions (lower-case, no dot). */
  allowedExtensions: string[];
  /** Local adapter: directory the dev files live under (git-ignored). */
  localDir: string;
  /** Local adapter: origin the signed dev URL points at. */
  localBaseUrl: string;
  /** Local adapter: HMAC secret for signing dev download URLs. */
  localSigningSecret: string;
}

/** Allowed types the Documents filter exposes (video: XLSX/PNG/JPG/PDF/DOCX/TXT/CSV/SVG). */
const DEFAULT_ALLOWED_EXTENSIONS = [
  'xlsx',
  'png',
  'jpg',
  'jpeg',
  'pdf',
  'docx',
  'txt',
  'csv',
  'svg',
];

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEV_INSECURE_SIGNING_SECRET = 'dev-insecure-storage-signing-secret';

export default registerAs('storage', (): StorageConfig => {
  const rawEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const isDevelopment = rawEnv === 'development' || rawEnv === 'test';

  const rawProvider =
    process.env.STORAGE_PROVIDER?.toLowerCase() ??
    (isDevelopment ? 'local' : 's3');
  if (rawProvider !== 'local' && rawProvider !== 's3') {
    throw new Error(`Invalid STORAGE_PROVIDER "${rawProvider}".`);
  }
  const provider: StorageProvider = rawProvider;

  const bucket = process.env.STORAGE_BUCKET ?? null;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID ?? null;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY ?? null;

  if (provider === 's3' && (!bucket || !accessKeyId || !secretAccessKey)) {
    throw new Error(
      'STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY must be set when STORAGE_PROVIDER is "s3".',
    );
  }

  const allowedExtensions = (
    process.env.STORAGE_ALLOWED_EXTENSIONS?.split(',') ??
    DEFAULT_ALLOWED_EXTENSIONS
  )
    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ''))
    .filter((ext) => ext.length > 0);

  return {
    provider,
    bucket,
    region: process.env.STORAGE_REGION ?? 'auto',
    endpoint: process.env.STORAGE_ENDPOINT ?? null,
    accessKeyId,
    secretAccessKey,
    forcePathStyle:
      (process.env.STORAGE_FORCE_PATH_STYLE ?? 'false').toLowerCase() ===
      'true',
    signedUrlTtlSec: Number.parseInt(
      process.env.STORAGE_SIGNED_URL_TTL_SEC ?? '300',
      10,
    ),
    maxBytes: Number.parseInt(
      process.env.STORAGE_MAX_BYTES ?? String(DEFAULT_MAX_BYTES),
      10,
    ),
    allowedExtensions,
    localDir: process.env.STORAGE_LOCAL_DIR ?? '.storage',
    localBaseUrl:
      process.env.STORAGE_LOCAL_BASE_URL ?? 'http://localhost:5001/api',
    localSigningSecret:
      process.env.STORAGE_SIGNING_SECRET ?? DEV_INSECURE_SIGNING_SECRET,
  };
});
