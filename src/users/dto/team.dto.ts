import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '../../generated/prisma/client';
import { MAX_TEAM_NAME, normalizeTeamName } from '../team-label';

/** One request moves at most this many people; a whole sales floor fits comfortably. */
const MAX_MEMBERS_PER_REQUEST = 500;

const teamName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeTeamName(value) : value;

/** `POST /api/teams` — a new team, born with its first members (an empty team is not stored). */
export class CreateTeamDto {
  @Transform(teamName)
  @IsString({ message: 'Team name is required.' })
  @MinLength(1, { message: 'Team name is required.' })
  @MaxLength(MAX_TEAM_NAME, {
    message: `Team name must be at most ${MAX_TEAM_NAME} characters.`,
  })
  name!: string;

  @IsArray({ message: 'Choose the members of the new team.' })
  @ArrayMinSize(1, {
    message:
      'Choose at least one member: a team exists while someone belongs to it.',
  })
  @ArrayMaxSize(MAX_MEMBERS_PER_REQUEST)
  @ArrayUnique({ message: 'A member is listed twice.' })
  @IsUUID('all', { each: true, message: 'Each member must be a valid id.' })
  memberIds!: string[];
}

/** `POST /api/teams/rename` — every member, and the team's tag permissions, take the new name. */
export class RenameTeamDto {
  @Transform(teamName)
  @IsString({ message: 'The team to rename is required.' })
  @MinLength(1, { message: 'The team to rename is required.' })
  @MaxLength(MAX_TEAM_NAME)
  name!: string;

  @Transform(teamName)
  @IsString({ message: 'The new name is required.' })
  @MinLength(1, { message: 'The new name is required.' })
  @MaxLength(MAX_TEAM_NAME, {
    message: `Team name must be at most ${MAX_TEAM_NAME} characters.`,
  })
  newName!: string;
}

/**
 * `POST /api/teams/assign` — put people in an existing team, moving them out of any other (one team
 * per person), or take them out of their team with `team: null`.
 */
export class AssignTeamDto {
  @Transform(teamName)
  @IsDefined({
    message: 'team is required: a team name, or null to remove from a team.',
  })
  @ValidateIf((dto: AssignTeamDto) => dto.team !== null)
  @IsString({ message: 'team must be a team name or null.' })
  @MinLength(1, { message: 'team must be a team name or null.' })
  @MaxLength(MAX_TEAM_NAME)
  team!: string | null;

  @IsArray({ message: 'Choose the members to move.' })
  @ArrayMinSize(1, { message: 'Choose at least one member.' })
  @ArrayMaxSize(MAX_MEMBERS_PER_REQUEST)
  @ArrayUnique({ message: 'A member is listed twice.' })
  @IsUUID('all', { each: true, message: 'Each member must be a valid id.' })
  userIds!: string[];
}

/** One live team, as the Teams screen lists it. */
export interface TeamSummary {
  name: string;
  /** Every live account carrying the label, active or not. */
  memberCount: number;
  activeMemberCount: number;
  /**
   * Σ the active members' monthly goals (AED, a Decimal string) — the same team target the
   * reports use. Null when no active member has a goal.
   */
  targetTotal: string | null;
  /** Active Sales Managers in the team: the people whose lead scope this team is. */
  managers: string[];
  /** Whether Tag Permissions has a policy saved for this team's name. */
  tagPermissions: boolean;
}

/** One live account, with what the Teams screen needs to place it. */
export interface TeamMemberEntry {
  id: string;
  name: string;
  role: UserRole;
  roleName: string | null;
  team: string | null;
  isActive: boolean;
  monthlyGoalAmount: string | null;
  /** Whether the role may be placed in a team (sales users other than the administrator). */
  eligible: boolean;
}

export interface TeamsOverview {
  teams: TeamSummary[];
  /** Every live account, by name; the screen derives each team's roster and the candidates. */
  members: TeamMemberEntry[];
  /** Live sales users who could join a team but belong to none. */
  unassigned: number;
}
