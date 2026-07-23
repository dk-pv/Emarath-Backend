import { IsUUID } from 'class-validator';

/**
 * Row "add tag" action (LEAD-12.1 AC1): the existing tag to apply to a lead.
 *
 * A tag id, not a name — the picker offers only tags that already exist
 * (`GET /lookups/tags`); creating new tags is FND-04.2's reference-data concern.
 */
export class AddLeadTagDto {
  @IsUUID('all', { message: 'tagId must be a valid tag id' })
  tagId!: string;
}
