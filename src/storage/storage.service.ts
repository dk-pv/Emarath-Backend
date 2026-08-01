/** A stored object's identity and metadata, returned by `put`. */
export interface StoredObject {
  /** The opaque storage key (never client-controlled); the row that references the file. */
  key: string;
  /** Size of the stored bytes. */
  sizeBytes: number;
  /** The content type the object was stored with. */
  contentType: string;
  /** Provider entity tag, when the backend supplies one. */
  etag?: string;
}

/** An upload to persist. `body` is the file bytes (multer memory buffer at the edge). */
export interface PutObjectInput {
  body: Buffer;
  /** The uploaded file's original name — used for the extension/type check and the key. */
  originalFileName: string;
  /** The declared content type (e.g. `image/png`). */
  contentType: string;
  /** Logical folder prefix for the key (e.g. `documents`); defaults to `uploads`. */
  keyPrefix?: string;
}

/** Options for a signed download link. */
export interface SignedDownloadOptions {
  /** Override the configured TTL (seconds). */
  expiresInSec?: number;
  /** File name the browser should save as (sets Content-Disposition). */
  downloadName?: string;
  /** Serve inline (preview) rather than as an attachment. Ignored for unsafe types. */
  inline?: boolean;
}

/**
 * The shared file storage port (FND-05.2, ADR — file storage).
 *
 * An abstract class so it is a Nest injection token: Documents (DOC-02.1) and any future
 * attachment feature depend on this type, and the module binds the environment's adapter
 * (local in development, S3 in staging/production) without those consumers changing.
 * Deliberately narrow — persist, hand back an access-checked link, and remove — which is
 * everything the backlog's storage ACs need; broader surface (listing, copy, direct-upload
 * URLs) is added only when a task requires it.
 *
 * Objects are always private: `getSignedDownloadUrl` mints a short-lived link, and the
 * caller authorises access before asking for one. `put` generates the key itself, so a
 * client never controls the storage path.
 */
export abstract class StorageService {
  /** Persist bytes; enforces the upload policy (type/size) and returns the object metadata. */
  abstract put(input: PutObjectInput): Promise<StoredObject>;

  /** Mint a short-lived download URL for a stored key (call only after authorising access). */
  abstract getSignedDownloadUrl(
    key: string,
    options?: SignedDownloadOptions,
  ): Promise<string>;

  /** Remove the stored object. Idempotent — deleting a missing key is not an error. */
  abstract delete(key: string): Promise<void>;
}
