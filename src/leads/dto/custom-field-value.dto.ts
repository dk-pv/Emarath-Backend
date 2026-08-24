import { IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * One custom-field value carried on the New/Edit Lead payload (LEAD-05.1, ADR-0051).
 * The form omits blank fields, so an entry here is a real value; its type-correctness
 * (numeric for NUMBER, parseable for DATE/DATETIME) is enforced server-side against
 * the field's definition, since the row DTO cannot know a field's type on its own.
 */
export class CustomFieldValueDto {
  @IsUUID('all', { message: 'each custom field id must be valid' })
  fieldId!: string;

  @IsString()
  @MaxLength(5000)
  value!: string;
}
