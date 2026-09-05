import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { UserRole } from '../../generated/prisma/client';

/**
 * The deepest the tree may go (ADR-0056). The reference legend enumerates exactly six
 * hierarchy levels, so a seventh has no colour and no meaning — the service rejects it
 * rather than rendering an unstyled row.
 */
export const MAX_ROLE_DEPTH = 6;

/** Create one role, optionally beneath an existing one. */
export class CreateRoleDto {
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(120, { message: 'name must be 120 characters or fewer' })
  name!: string;

  /**
   * The authorisation role this named role maps onto. Kept explicit (ADR-0055): the enum
   * remains the sole guard input, so a new named role must say which existing privilege
   * level it grants rather than inventing one.
   */
  @IsEnum(UserRole, { message: 'baseRole must be a valid role' })
  baseRole!: UserRole;

  @IsOptional()
  @IsUUID('all', { message: 'parentId must be a role id' })
  parentId?: string;
}

/** Rename a role, re-point it at a different base role, or move it under a new parent. */
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'name cannot be blank' })
  @MaxLength(120, { message: 'name must be 120 characters or fewer' })
  name?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'baseRole must be a valid role' })
  baseRole?: UserRole;

  /**
   * `null` promotes the role to a root. Absent leaves the parent untouched — the two are
   * different intents, so the controller distinguishes "key present" from "key omitted".
   */
  @IsOptional()
  @IsUUID('all', { message: 'parentId must be a role id' })
  parentId?: string | null;
}

/** Drag/drop result: where the role landed. */
export class MoveRoleDto {
  @IsOptional()
  @IsUUID('all', { message: 'parentId must be a role id' })
  parentId?: string | null;

  @IsInt({ message: 'position must be a whole number' })
  @Min(0, { message: 'position cannot be negative' })
  @Type(() => Number)
  position!: number;
}

/** One row of the hierarchy as the API returns it. */
export interface RoleNode {
  id: string;
  name: string;
  baseRole: UserRole;
  parentId: string | null;
  position: number;
  /** 1-based depth, computed server-side so the UI never derives its own level colours. */
  level: number;
  /** Live users pointing at this role — a real count, never a display placeholder. */
  assignedCount: number;
  /** True when the role still has children, so the UI knows to draw a collapse control. */
  hasChildren: boolean;
  /** Author's display name for the info popover; null for the seeded roles. */
  createdByName: string | null;
  createdAt: Date;
}
