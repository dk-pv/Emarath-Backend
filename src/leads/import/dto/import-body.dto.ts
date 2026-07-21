import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * The text fields that accompany the uploaded file on /validate and the import
 * (the file itself arrives via `@UploadedFile`, not the body).
 *
 * `mapping` is a JSON string (`{ [column]: fieldValue|null }`) — multipart form
 * fields are strings, so it is parsed and shape-checked in the service rather than
 * decoded by class-validator.
 */
export class ImportBodyDto {
  @IsString()
  @IsNotEmpty({ message: 'A field mapping is required.' })
  mapping!: string;

  @IsString()
  @IsNotEmpty({ message: 'A pipeline is required.' })
  @MaxLength(64)
  pipeline!: string;
}
