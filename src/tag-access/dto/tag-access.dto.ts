import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TagAccessMode, UserRole } from '../../generated/prisma/client';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Matches `tag_access_policies.team` (and `users.team`). */
export const MAX_TEAM = 120;

const MODES = [TagAccessMode.ALL, TagAccessMode.LISTED] as const;
const MAX_TAGS = 500;

/** `PUT /api/tag-access/teams` — a team's default, replaced whole. */
export class SaveTeamTagAccessDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Team is required.' })
  @MaxLength(MAX_TEAM)
  team!: string;

  @IsBoolean()
  canCreate!: boolean;

  @IsIn(MODES, { message: 'tagAccess must be ALL or LISTED.' })
  tagAccess!: TagAccessMode;

  /** The tags the team may select. Ignored (and cleared) when `tagAccess` is ALL. */
  @IsArray()
  @ArrayMaxSize(MAX_TAGS)
  @ArrayUnique()
  @IsUUID('all', { each: true, message: 'Each tag id must be a valid tag id.' })
  tagIds!: string[];
}

/**
 * `PUT /api/tag-access/users/:userId` — one user's override. A null or absent field means
 * "inherit the team's value"; sending both as null removes the override.
 */
export class SaveUserTagAccessDto {
  @IsOptional()
  @IsBoolean()
  canCreate?: boolean | null;

  @IsOptional()
  @IsIn(MODES, { message: 'tagAccess must be ALL, LISTED or null.' })
  tagAccess?: TagAccessMode | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS)
  @ArrayUnique()
  @IsUUID('all', { each: true, message: 'Each tag id must be a valid tag id.' })
  tagIds?: string[];
}

/** One team's default, as the Admin screen lists it. */
export interface TeamTagAccessNode {
  team: string;
  /** Active users assigned to this team. */
  memberCount: number;
  /** False while no policy is saved: the team behaves as it did before this feature. */
  configured: boolean;
  canCreate: boolean;
  tagAccess: TagAccessMode;
  tagIds: string[];
}

/** One user, their override (if any) and what they end up with. */
export interface UserTagAccessNode {
  userId: string;
  name: string;
  role: UserRole;
  team: string | null;
  override: {
    canCreate: boolean | null;
    tagAccess: TagAccessMode | null;
    tagIds: string[];
  } | null;
  effective: {
    canCreate: boolean;
    tagAccess: TagAccessMode;
    tagIds: string[];
  };
}

export interface TagAccessOverview {
  teams: TeamTagAccessNode[];
  users: UserTagAccessNode[];
}
