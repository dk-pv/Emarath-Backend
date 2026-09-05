import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** The `app_settings` row this screen owns. */
export const ORGANIZATION_HOST_MAPPING_KEY = 'organization.hostMapping';

/** A fully qualified name cannot exceed this, per RFC 1035. */
export const MAX_DOMAIN_NAME = 253;
export const MAX_FROM_EMAIL_ADDRESS = 180;
export const MAX_FROM_EMAIL_NAME = 120;

/**
 * The row holds the whole list, so it needs a ceiling — without one a script could grow a
 * single JSON value without bound. Far above any real tenant's domain count.
 */
export const MAX_HOST_DOMAINS = 50;

/**
 * Labels of 1–63 characters, no leading or trailing hyphen, at least two of them — a
 * hostname, which is what the field is called. Matched against the lowercased value.
 */
export const DOMAIN_PATTERN =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export interface HostDomain {
  id: string;
  domainName: string;
  fromEmailAddress: string;
  fromEmailName: string;
  /** ISO-8601, what the list's "Date and Time" column prints. */
  createdAt: string;
}

export interface OrganizationHostMapping {
  domains: HostDomain[];
}

/** An unconfigured tenant has no domains; the reference's own list is empty. */
export const ORGANIZATION_HOST_MAPPING_DEFAULTS: OrganizationHostMapping = {
  domains: [],
};

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * The Add Domain form's payload — the three fields the reference draws, and no others.
 *
 * Only the domain name is required, matching the Company Details rule: the field the
 * record is meaningless without is enforced, and the rest are optional-but-checked, so an
 * empty string skips the format rule and anything else must satisfy it. The reference
 * marks no field as required, so nothing beyond that is assumed.
 */
export class CreateHostDomainDto {
  /** Lowercased on the way in: DNS is case-insensitive, so `A.com` and `a.com` are one. */
  @Transform(trimLower)
  @IsString()
  @IsNotEmpty({ message: 'Domain Name is required.' })
  @MaxLength(MAX_DOMAIN_NAME)
  @Matches(DOMAIN_PATTERN, {
    message: 'Enter a valid domain name, for example emarathglobal.com.',
  })
  domainName!: string;

  @Transform(trim)
  @ValidateIf((dto: CreateHostDomainDto) => dto.fromEmailAddress !== '')
  @IsString()
  @MaxLength(MAX_FROM_EMAIL_ADDRESS)
  @IsEmail({}, { message: 'A valid From Email Address is required.' })
  fromEmailAddress!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(MAX_FROM_EMAIL_NAME)
  fromEmailName!: string;
}
