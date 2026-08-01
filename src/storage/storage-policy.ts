import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/** The upload limits an adapter enforces before persisting (FND-05.2 AC3). */
export interface UploadPolicy {
  allowedExtensions: string[];
  maxBytes: number;
}

/** The parts of an upload the policy inspects. */
export interface UploadCandidate {
  originalFileName: string;
  sizeBytes: number;
}

/** Lower-case extension without the dot, or '' when the name has none. */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Reject a disallowed type or an oversized/empty file with a clear 400 (AC3). Both adapters
 * call this before persisting, so the rule holds no matter which backend stores the bytes.
 */
export function assertUploadAllowed(
  candidate: UploadCandidate,
  policy: UploadPolicy,
): void {
  if (candidate.sizeBytes <= 0) {
    throw new BadRequestException('The file is empty.');
  }
  if (candidate.sizeBytes > policy.maxBytes) {
    const maxMb = Math.round(policy.maxBytes / (1024 * 1024));
    throw new BadRequestException(`The file exceeds the ${maxMb} MB limit.`);
  }
  const ext = extensionOf(candidate.originalFileName);
  if (!ext || !policy.allowedExtensions.includes(ext)) {
    throw new BadRequestException(
      `File type "${ext || 'unknown'}" is not allowed. Allowed: ${policy.allowedExtensions.join(', ')}.`,
    );
  }
}

/** Strip a name to a safe basename for use inside a storage key. */
function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '');
  return cleaned.slice(0, 120) || 'file';
}

/**
 * Build an opaque, collision-free object key the server owns: `<prefix>/<uuid>/<name>`.
 * The random segment guarantees uniqueness and means a client can never predict or overwrite
 * another file's key; the sanitized name is kept only so the object is recognisable.
 */
export function buildObjectKey(
  originalFileName: string,
  keyPrefix = 'uploads',
): string {
  const prefix =
    keyPrefix.replace(/[^a-z0-9-]+/gi, '').toLowerCase() || 'uploads';
  return `${prefix}/${randomUUID()}/${sanitizeFileName(originalFileName)}`;
}
