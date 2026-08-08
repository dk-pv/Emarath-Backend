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
 * The Edit Document drawer's payload (DOC-04.1). A JSON PATCH, so `userIds` is a native
 * array (unlike the multipart create). Both fields are optional — the drawer may change the
 * title, the access whitelist, or both. When `title` is present it must be non-empty (a
 * rename cannot blank the name); when `userIds` is present it replaces the whole whitelist.
 * The physical file (fileName/storageKey) is never touched here (DOC-04.1 renames metadata
 * only). Category is deliberately absent — the reference Edit UI does not expose it.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const MAX_TITLE = 255;
const MAX_ACCESS_USERS = 100;

export class UpdateDocumentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'File name cannot be empty' })
  @MaxLength(MAX_TITLE)
  @IsOptional()
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ACCESS_USERS)
  @IsUUID('all', {
    each: true,
    message: 'each selected user must be a valid id',
  })
  userIds?: string[];
}
