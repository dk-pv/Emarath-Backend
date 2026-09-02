import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '../../generated/prisma/client';

export const USER_ROLES = Object.values(UserRole);

export const USER_SORT_COLUMNS = [
  'name',
  'email',
  'role',
  'jobTitle',
  'lastLoginAt',
  'lastSeenAt',
  'createdAt',
] as const;
export type UserSortColumn = (typeof USER_SORT_COLUMNS)[number];

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;
/** A search longer than this is never a real query; reject it before the DB (matches Leads). */
export const MAX_SEARCH_LENGTH = 200;

/** WhatsApp inbox access levels. Only "Restricted" is captured; FULL is the sole inferred peer. */
export const WHATSAPP_ACCESS_LEVELS = ['RESTRICTED', 'FULL'] as const;
export type WhatsappAccessLevel = (typeof WHATSAPP_ACCESS_LEVELS)[number];

export { PERMISSION_CATALOG, PERMISSION_MODULES } from '../permission-catalog';
export type { PermissionModule } from '../permission-catalog';
import { PERMISSION_MODULES } from '../permission-catalog';
import type { PermissionModule } from '../permission-catalog';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? null : next;
};

const lower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** The roster query: page, size, sort, free-text search and the Role filter. */
export class ListUsersQueryDto {
  /** 1-based, matching what the pager shows. */
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be 1 or greater' })
  @IsOptional()
  page: number = 1;

  @Type(() => Number)
  @IsInt({ message: 'size must be an integer' })
  @Min(1, { message: 'size must be 1 or greater' })
  @Max(MAX_PAGE_SIZE, { message: `size must be at most ${MAX_PAGE_SIZE}` })
  @IsOptional()
  size: number = DEFAULT_PAGE_SIZE;

  @IsIn(USER_SORT_COLUMNS, {
    message: `sort must be one of: ${USER_SORT_COLUMNS.join(', ')}`,
  })
  @IsOptional()
  sort: UserSortColumn = 'name';

  @Transform(lower)
  @IsIn(['asc', 'desc'], { message: 'direction must be asc or desc' })
  @IsOptional()
  direction: 'asc' | 'desc' = 'asc';

  /** Matches name, email, username, job title or phone. */
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  @IsOptional()
  search?: string;

  /** The Role dropdown; unset means every role. */
  @IsIn(USER_ROLES, { message: 'role must be a known user role' })
  @IsOptional()
  role?: UserRole;
}

/** One row of the permission matrix as the wizard submits it. */
export class PermissionEntryDto {
  @IsIn(PERMISSION_MODULES, { message: 'module must be a known module' })
  module!: PermissionModule;

  @IsBoolean()
  @IsOptional()
  canView?: boolean;

  @IsBoolean()
  @IsOptional()
  canAdd?: boolean;

  @IsBoolean()
  @IsOptional()
  canEdit?: boolean;
}

/** Wizard fields shared by create and edit (everything except identity + password). */
class TeamMemberConfigDto {
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  jobTitle?: string | null;

  /** The organisational role (Role table). Resolves User.role via Role.baseRole. */
  @IsUUID('all', { message: 'roleId must be a role id' })
  @IsOptional()
  roleId?: string;

  @IsUUID('all', { message: 'reportingToId must be a user id' })
  @IsOptional()
  reportingToId?: string | null;

  @IsUUID('all', { message: 'leadFormId must be a lead form id' })
  @IsOptional()
  leadFormId?: string | null;

  /** Validated against the `pipelines` lookup in the service. */
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @IsOptional()
  pipelines?: string[];

  @Transform(trimToNull)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  team?: string | null;

  @IsBoolean({ message: 'isActive must be a boolean' })
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  appAccess?: boolean;

  @IsBoolean()
  @IsOptional()
  trackCheckInOut?: boolean;

  @IsBoolean()
  @IsOptional()
  trackMeetingLocation?: boolean;

  @IsBoolean()
  @IsOptional()
  includeInReporting?: boolean;

  @IsBoolean()
  @IsOptional()
  autoFollowUpPrompt?: boolean;

  @IsIn([...WHATSAPP_ACCESS_LEVELS], {
    message: `whatsappInboxAccess must be one of: ${WHATSAPP_ACCESS_LEVELS.join(', ')}`,
  })
  @IsOptional()
  whatsappInboxAccess?: WhatsappAccessLevel | null;

  /** "#RRGGBB" from the picker — user data, not a design token. */
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'colorCode must be a #RRGGBB hex value',
  })
  @IsOptional()
  colorCode?: string | null;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'monthlyGoalAmount must be an amount' },
  )
  @Min(0, { message: 'monthlyGoalAmount must not be negative' })
  @Max(9_999_999_999, { message: 'monthlyGoalAmount is too large' })
  @IsOptional()
  monthlyGoalAmount?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionEntryDto)
  @IsOptional()
  permissions?: PermissionEntryDto[];
}

/**
 * Create a team member (wizard submit). Identity fields mirror the reference's step 1;
 * `username` is derived from the email local part when omitted, because the captured
 * form has no username control and the model needs its second unique credential.
 * Confirm-password never leaves the browser — equality is a client-side check.
 */
export class CreateUserDto extends TeamMemberConfigDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'First name is required.' })
  @MaxLength(80)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Last name is required.' })
  @MaxLength(80)
  lastName!: string;

  @Transform(lower)
  @IsEmail({}, { message: 'A valid email is required.' })
  @MaxLength(180)
  email!: string;

  /** Dial code + local digits, the format PhoneInput stores ("971542327276"). */
  @Transform(trim)
  @Matches(/^\d{6,20}$/, { message: 'A valid phone number is required.' })
  phone!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  username?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(200)
  password!: string;

  /** Required in create: every member is created in a named role. */
  @IsUUID('all', { message: 'roleId must be a role id' })
  declare roleId: string;
}

/**
 * Edit a team member. Every field optional so the drawer sends what changed; the
 * password is deliberately absent — changing it is a separate, explicit action.
 */
export class UpdateUserDto extends TeamMemberConfigDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'First name is required.' })
  @MaxLength(80)
  @IsOptional()
  firstName?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Last name is required.' })
  @MaxLength(80)
  @IsOptional()
  lastName?: string;

  @Transform(lower)
  @IsEmail({}, { message: 'A valid email is required.' })
  @MaxLength(180)
  @IsOptional()
  email?: string;

  @Transform(trim)
  @Matches(/^\d{6,20}$/, { message: 'A valid phone number is required.' })
  @IsOptional()
  phone?: string | null;
}

/** Set another user's password (the roster's Change Password action). */
export class SetUserPasswordDto {
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(200)
  password!: string;
}

/** One matrix row as the API returns it. */
export interface PermissionEntryResponse {
  module: PermissionModule;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
}

/**
 * One team member as the roster returns it. `passwordHash` is absent by construction —
 * the service selects columns explicitly, so a hash can never reach a response.
 */
export interface UserResponse {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  username: string;
  role: UserRole;
  /** The named organisational role; falls back to null on pre-roles accounts. */
  roleId: string | null;
  roleName: string | null;
  jobTitle: string | null;
  phone: string | null;
  team: string | null;
  isActive: boolean;
  colorCode: string | null;
  /** Short-lived signed link to the profile picture; null when none is set. */
  avatarUrl: string | null;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

/** The full wizard configuration, for the edit drawer (GET /api/users/:id). */
export interface UserDetailResponse extends UserResponse {
  reportingToId: string | null;
  reportingToName: string | null;
  leadFormId: string | null;
  pipelines: string[];
  appAccess: boolean;
  trackCheckInOut: boolean;
  trackMeetingLocation: boolean;
  includeInReporting: boolean;
  autoFollowUpPrompt: boolean;
  whatsappInboxAccess: WhatsappAccessLevel | null;
  monthlyGoalAmount: string | null;
  permissions: PermissionEntryResponse[];
}
