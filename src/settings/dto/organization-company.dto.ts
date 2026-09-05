import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** The `app_settings` row this screen owns. */
export const ORGANIZATION_COMPANY_KEY = 'organization.companyDetails';

/** WGS-84 bounds; a value outside them is not a place. */
export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

/** Field lengths, generous enough for the reference values and bounded against abuse. */
export const MAX_COMPANY_NAME = 180;
export const MAX_ADDRESS_LINE = 240;
export const MAX_PLACE_NAME = 120;
export const MAX_ZIP_CODE = 20;
export const MAX_TELEPHONE = 32;
export const MAX_EMAIL = 180;
export const MAX_WEBSITE = 240;

export interface OrganizationCompanyDetails {
  companyName: string;
  address: string;
  street: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  /** ISO 3166-1 alpha-2 of the dialling country, matching the frontend's country dataset. */
  telephoneCountry: string;
  /** Dial digits followed by the local number, no "+" — the shape `Lead.primaryPhone` holds. */
  telephone: string;
  email: string;
  website: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * An unsaved tenant starts blank rather than pre-filled with the reference's demo values:
 * a company name nobody typed is worse than an empty field. The telephone country matches
 * the Sales & CRM default country so the selector opens somewhere sensible.
 */
export const ORGANIZATION_COMPANY_DEFAULTS: OrganizationCompanyDetails = {
  companyName: '',
  address: '',
  street: '',
  city: '',
  state: '',
  country: '',
  zipCode: '',
  telephoneCountry: 'AE',
  telephone: '',
  email: '',
  website: '',
  latitude: null,
  longitude: null,
};

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Every field is present on every save — the row is replaced wholesale, as the other
 * settings screens are. Optional fields carry `''` (or `null` for the coordinates) rather
 * than being omitted, so "cleared" and "not sent" cannot be confused.
 *
 * `@ValidateIf` is what makes a field optional-but-checked: an empty string skips the
 * format rule, anything else must satisfy it. Blank is allowed everywhere except the
 * company name.
 */
export class UpdateOrganizationCompanyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Company Name is required.' })
  @MaxLength(MAX_COMPANY_NAME)
  companyName!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(MAX_ADDRESS_LINE)
  address!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(MAX_ADDRESS_LINE)
  street!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(MAX_PLACE_NAME)
  city!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(MAX_PLACE_NAME)
  state!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(MAX_PLACE_NAME)
  country!: string;

  /** A string, not a number: postal codes elsewhere carry letters and leading zeroes. */
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_ZIP_CODE)
  zipCode!: string;

  @Transform(upper)
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  telephoneCountry!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(MAX_TELEPHONE)
  @Matches(/^\d*$/, { message: 'Telephone must contain digits only.' })
  telephone!: string;

  @Transform(trim)
  @ValidateIf((dto: UpdateOrganizationCompanyDto) => dto.email !== '')
  @IsString()
  @MaxLength(MAX_EMAIL)
  @IsEmail({}, { message: 'A valid email is required.' })
  email!: string;

  /**
   * `require_protocol: false` because the reference placeholder invites "Add Website",
   * not a scheme; the protocol allow-list still rejects anything a browser could execute
   * if this value were ever rendered as a link.
   */
  @Transform(trim)
  @ValidateIf((dto: UpdateOrganizationCompanyDto) => dto.website !== '')
  @IsString()
  @MaxLength(MAX_WEBSITE)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: false },
    { message: 'A valid website address is required.' },
  )
  website!: string;

  @ValidateIf((dto: UpdateOrganizationCompanyDto) => dto.latitude !== null)
  @IsNumber({}, { message: 'Latitude must be a number.' })
  @Min(MIN_LATITUDE)
  @Max(MAX_LATITUDE)
  latitude!: number | null;

  @ValidateIf((dto: UpdateOrganizationCompanyDto) => dto.longitude !== null)
  @IsNumber({}, { message: 'Longitude must be a number.' })
  @Min(MIN_LONGITUDE)
  @Max(MAX_LONGITUDE)
  longitude!: number | null;
}
