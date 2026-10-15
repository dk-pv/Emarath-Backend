import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { DuplicateMatchField } from '../lead-duplicates';

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/**
 * `GET /api/leads/duplicate-check` — the contact values the New Lead form is about to save.
 * All optional: the form asks as soon as it has any one of them. Lengths match the lead's own
 * columns, so a value the lead could never hold is a 400 rather than a pointless query.
 */
export class DuplicateCheckQueryDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  primaryPhone?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  secondaryPhone?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string;
}

/**
 * One existing lead the enquiry would duplicate. A lead the caller cannot open (outside their
 * role scope, or archived) is reported as `restricted` with no id, name or status: the form
 * can still say "a lead with this phone exists", and nothing about the lead leaks.
 */
export interface DuplicateCheckMatch {
  id: string | null;
  name: string | null;
  status: string | null;
  matchedOn: DuplicateMatchField;
  restricted: boolean;
}

/** A warning only: the enquiry is created whether or not anything matched (ADR-0092). */
export interface DuplicateCheckResponse {
  matches: DuplicateCheckMatch[];
}

/** A lead on the other end of a duplicate link — only what the caller may already read. */
export interface RelatedLead {
  id: string;
  name: string;
  status: string;
  pipeline: string;
  primaryPhone: string;
  createdAt: string;
}

/** `GET /api/leads/:id/duplicates` — the lead's place in its duplicate group. */
export interface LeadDuplicateLinks {
  /** The earlier lead this one was received as a duplicate of; null if not a duplicate or hidden. */
  original: RelatedLead | null;
  /** Leads recorded as duplicates of this one, oldest first. */
  duplicates: RelatedLead[];
  /** True when a related lead exists that is not listed: archived, or outside the caller's scope. */
  hasHidden: boolean;
}
