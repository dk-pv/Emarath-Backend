import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AssignmentAlgorithm,
  AssignmentApplyTo,
  AssignmentRuleStatus,
  AssignmentTarget,
} from '../../generated/prisma/client';

export const ASSIGNMENT_ALGORITHMS = Object.values(AssignmentAlgorithm);
export const ASSIGNMENT_RULE_STATUSES = Object.values(AssignmentRuleStatus);
export const ASSIGNMENT_APPLY_TO = Object.values(AssignmentApplyTo);
export const ASSIGNMENT_TARGETS = Object.values(AssignmentTarget);

export const MAX_RULE_NAME = 180;
export const MAX_RULE_DESCRIPTION = 600;
export const MAX_GROUP_NAME = 180;
/** A rule with more groups than this is a modelling mistake, not a configuration. */
export const MAX_GROUPS_PER_RULE = 50;
export const MAX_RULE_SEARCH = 120;

/** The reference's footer opens on 100. */
export const DEFAULT_RULE_PAGE_SIZE = 100;
export const MAX_RULE_PAGE_SIZE = 200;

export interface AssignmentRuleGroupRow {
  id: string;
  name: string;
  position: number;
  applyTo: AssignmentApplyTo;
  target: AssignmentTarget;
}

export interface AssignmentRuleRow {
  id: string;
  name: string;
  description: string;
  algorithm: AssignmentAlgorithm;
  status: AssignmentRuleStatus;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Always in `position` order — the order the drag handle wrote. */
  groups: AssignmentRuleGroupRow[];
}

export interface AssignmentRuleList {
  rows: AssignmentRuleRow[];
  total: number;
}

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * One configuration group. `position` is not sent: the array's order *is* the order, which
 * removes any chance of two groups claiming the same slot or the client and server
 * disagreeing about what "first" means.
 */
export class AssignmentRuleGroupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Each configuration group needs a name.' })
  @MaxLength(MAX_GROUP_NAME)
  name!: string;

  @IsIn(ASSIGNMENT_APPLY_TO, {
    message: 'Choose what this group applies to.',
  })
  applyTo!: AssignmentApplyTo;

  @IsIn(ASSIGNMENT_TARGETS, { message: 'Choose who this group assigns to.' })
  target!: AssignmentTarget;
}

/**
 * The wizard's payload, saved in one request at the end of step 3 rather than a request
 * per step: a rule with no groups is not a state the reference can produce, so a
 * half-written rule should never reach the database.
 */
export class CreateAssignmentRuleDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Rule Name is required.' })
  @MaxLength(MAX_RULE_NAME)
  name!: string;

  /** Optional in the reference — its Description field carries no asterisk. */
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_RULE_DESCRIPTION)
  description!: string;

  @IsIn(ASSIGNMENT_ALGORITHMS, {
    message: 'Choose an assignment algorithm.',
  })
  algorithm!: AssignmentAlgorithm;

  @IsIn(ASSIGNMENT_RULE_STATUSES)
  status!: AssignmentRuleStatus;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'Add at least one configuration group before saving.',
  })
  @ArrayMaxSize(MAX_GROUPS_PER_RULE)
  @ValidateNested({ each: true })
  @Type(() => AssignmentRuleGroupDto)
  groups!: AssignmentRuleGroupDto[];
}

/** Every field optional; the groups, when sent, replace the rule's whole list. */
export class UpdateAssignmentRuleDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Rule Name is required.' })
  @MaxLength(MAX_RULE_NAME)
  name?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RULE_DESCRIPTION)
  description?: string;

  @IsOptional()
  @IsIn(ASSIGNMENT_ALGORITHMS)
  algorithm?: AssignmentAlgorithm;

  @IsOptional()
  @IsIn(ASSIGNMENT_RULE_STATUSES)
  status?: AssignmentRuleStatus;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message: 'A rule keeps at least one configuration group.',
  })
  @ArrayMaxSize(MAX_GROUPS_PER_RULE)
  @ValidateNested({ each: true })
  @Type(() => AssignmentRuleGroupDto)
  groups?: AssignmentRuleGroupDto[];
}

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/** `page`/`size` mirror the Leads and Templates lists so the shape is already familiar. */
export class ListAssignmentRulesQueryDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RULE_SEARCH)
  search?: string;

  @IsOptional()
  @IsIn(ASSIGNMENT_RULE_STATUSES)
  status?: AssignmentRuleStatus;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RULE_PAGE_SIZE)
  size?: number;
}
