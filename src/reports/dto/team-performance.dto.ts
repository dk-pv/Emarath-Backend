import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { normalizeFilterValues } from '../../leads/lead-filter';
import { MAX_FILTER_VALUES } from './no-activity-query.dto';
import { MAX_TEAM_LENGTH } from './leads-by-status-query.dto';

/** `Lead.source` is `VarChar(120)`; a longer value can never match a row. */
const MAX_SOURCE_LENGTH = 120;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const values = ({ value }: { value: unknown }): unknown =>
  normalizeFilterValues(value);

/**
 * The Team Performance query (Teams v1). `from`/`to` are ISO instants the browser computes for
 * its own day edges — the lead-creation window by default, or the last status change with
 * `dateField=statusChanged`, as in Leads By Ownership. `team`, `agent` and
 * `source` accept repeated params; `manager` narrows to that Sales Manager's team.
 */
export class TeamPerformanceQueryDto {
  @Transform(trim)
  @IsISO8601({ strict: true }, { message: 'from must be an ISO date' })
  @IsOptional()
  from?: string;

  @Transform(trim)
  @IsISO8601({ strict: true }, { message: 'to must be an ISO date' })
  @IsOptional()
  to?: string;

  /** Which lead date the window applies to: creation (default) or the last status change. */
  @Transform(trim)
  @IsIn(['created', 'statusChanged'], {
    message: 'dateField must be created or statusChanged',
  })
  @IsOptional()
  dateField?: 'created' | 'statusChanged';

  @Transform(values)
  @IsArray({ message: 'team must be one or more values' })
  @IsString({ each: true, message: 'each team must be a string' })
  @MaxLength(MAX_TEAM_LENGTH, {
    each: true,
    message: `each team must be at most ${MAX_TEAM_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `team accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  team?: string[];

  /** BDEs: assigned-user ids, matched through the assignment join. */
  @Transform(values)
  @IsArray({ message: 'agent must be one or more values' })
  @IsUUID('all', { each: true, message: 'each agent must be a valid id' })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `agent accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  agent?: string[];

  /** A Sales Manager's id: the report narrows to the team they belong to. */
  @Transform(trim)
  @IsUUID('all', { message: 'manager must be a valid id' })
  @IsOptional()
  manager?: string;

  @Transform(values)
  @IsArray({ message: 'source must be one or more values' })
  @IsString({ each: true, message: 'each source must be a string' })
  @MaxLength(MAX_SOURCE_LENGTH, {
    each: true,
    message: `each source must be at most ${MAX_SOURCE_LENGTH} characters`,
  })
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `source accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsOptional()
  source?: string[];
}

/**
 * The figures every row carries, over the leads created in the window:
 * - `leads`: leads in the row's set;
 * - `won`: those whose stage is WON now (the Converted Leads definition);
 * - `orders`: those that have a Logistics order, whatever its status since;
 * - `conversionRate`: won ÷ leads, a percentage to two places (0 with no leads);
 * - `wonValue`: Σ actualAmount of the won leads, AED, as a Decimal string.
 */
export interface TeamPerformanceFigures {
  leads: number;
  won: number;
  orders: number;
  conversionRate: number;
  wonValue: string;
}

/**
 * One team: its leads are those with at least one current assignee on the team, each counted once.
 * `team` null is the leads of assignees with no team.
 */
export interface TeamPerformanceTeamRow extends TeamPerformanceFigures {
  team: string | null;
  /** Active members carrying the label — the people whose goals make the target. Null for no team. */
  members: number | null;
  /** Σ the active members' monthly goals (AED); null when none is set, and for no team. */
  target: string | null;
  /** wonValue ÷ target as a percentage, uncapped; null without a target. Not pro-rated. */
  achievement: number | null;
}

/** One BDE: the leads assigned to them (a co-assigned lead counts for each of its owners). */
export interface TeamPerformancePersonRow extends TeamPerformanceFigures {
  userId: string;
  name: string;
  team: string | null;
  /** Their monthly goal (AED); null when none is set. */
  target: string | null;
  achievement: number | null;
}

export interface TeamPerformanceResponse {
  /** Empty for a sales agent, and for a Sales Manager with no team: they see their own row. */
  teams: TeamPerformanceTeamRow[];
  people: TeamPerformancePersonRow[];
  /** The whole filtered set, each lead once — unassigned leads included. */
  total: TeamPerformanceFigures;
}

/** What the filters offer the caller: never a team or a person outside what they may see. */
export interface TeamPerformanceFilterOptions {
  teams: string[];
  /** Sales Managers with a team; empty for a manager or an agent (their scope is fixed). */
  managers: { id: string; name: string; team: string }[];
  agents: { id: string; name: string; team: string | null }[];
}
