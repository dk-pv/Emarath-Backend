import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * The Add Document drawer's text payload (DOC-02.1). The file itself arrives as the
 * multipart `file` part (consumed by the interceptor), not a DTO field.
 *
 * `title` is the drawer's "File name" — a user-entered display title, distinct from the
 * uploaded file's own name (the reference row shows "Product Images" over
 * "LUMINUX3IN1 COMBO.png"). `userIds` is the "Select Users" access whitelist. `category`
 * is not in the Documents drawer; it is exposed so every future module reusing this upload
 * can file an object under a category (DOC-01.1 AC2).
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

// Multipart repeats a field once per value: many values arrive as an array, one as a bare
// string, none as undefined. Normalise to an array so the validators below see one shape.
const toArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value : [value];
};

const MAX_TITLE = 255;
const MAX_CATEGORY = 120;
const MAX_ACCESS_USERS = 100;

export class CreateDocumentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'File name is required' })
  @MaxLength(MAX_TITLE)
  title!: string;

  /**
   * "Select Users" — the DocumentAccess whitelist (DOC-01.1 AC3). Optional: an empty
   * selection means owner-only, the default access setting (DOC-02.1 AC4).
   */
  @Transform(toArray)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ACCESS_USERS)
  @IsUUID('all', {
    each: true,
    message: 'each selected user must be a valid id',
  })
  userIds?: string[];

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CATEGORY)
  category?: string;
}
