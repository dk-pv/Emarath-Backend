import { Prisma } from '../../generated/prisma/client';

/**
 * The document projection the create endpoint returns (DOC-02.1). `storageKey` is selected
 * to mint the download link but never exposed — access is always through a signed URL, so
 * a client never sees the raw key (schema note on `Document.storageKey`).
 */
export const DOCUMENT_SELECT = {
  id: true,
  title: true,
  fileName: true,
  storageKey: true,
  sizeBytes: true,
  contentType: true,
  category: true,
  createdAt: true,
  uploader: { select: { id: true, name: true } },
  access: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.DocumentSelect;

type DocumentRow = Prisma.DocumentGetPayload<{
  select: typeof DOCUMENT_SELECT;
}>;

/** A user reference as the Documents columns render one ("Uploaded By", "Access"). */
export interface DocumentUserRef {
  id: string;
  name: string;
}

export interface DocumentResponse {
  id: string;
  /** "File Name" column — the user-entered display title. */
  title: string;
  /** "Attachment" column — the uploaded file's own name. */
  fileName: string;
  sizeBytes: number;
  contentType: string;
  category: string | null;
  createdAt: string;
  uploadedBy: DocumentUserRef;
  /** The users granted access (DocumentAccess); empty means owner-only. */
  access: DocumentUserRef[];
  /** Short-lived signed link to the stored file (AC1). */
  downloadUrl: string;
}

export function toDocumentResponse(
  row: DocumentRow,
  downloadUrl: string,
): DocumentResponse {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    uploadedBy: row.uploader,
    access: row.access.map((grant) => grant.user),
    downloadUrl,
  };
}
