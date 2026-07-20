import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * The New Lead form's payload (LEAD-06.1).
 *
 * The form's required fields are enforced here, not in the schema: the columns
 * stay nullable because imported/real Workpex rows leave them blank, so "required"
 * is a rule about *this create form* (see the Lead model's comment). Amounts and
 * quantities arrive as numeric strings and reach Prisma unchanged, preserving the
 * Decimal precision the columns exist for. Empty optional strings are normalised
 * to undefined so a blank field is "not set", never a validation error.
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

/** No sane lead has more attempts than this; guards the int column from abuse. */
const MAX_ATTEMPTS = 1000;

export class CreateLeadDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Customer Name is required' })
  @MaxLength(180)
  name!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Primary Phone is required' })
  @MaxLength(32)
  primaryPhone!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  firstName?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(32)
  @IsOptional()
  secondaryPhone?: string;

  @IsArray()
  @IsUUID('all', {
    each: true,
    message: 'each assigned agent must be a valid id',
  })
  @ArrayMaxSize(50)
  @IsOptional()
  assignedAgentIds?: string[];

  /** Defaults to "New" (LEAD-06.1 AC3/AC4). */
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  status?: string;

  /** Defaults to "Lead Pipeline" (ADR-0005). */
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  pipeline?: string;

  @IsArray()
  @IsUUID('all', { each: true, message: 'each tag must be a valid id' })
  @ArrayMaxSize(50)
  @IsOptional()
  tagIds?: string[];

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(180)
  @IsOptional()
  complaintReason?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Product is required' })
  @MaxLength(180)
  product!: string;

  @Transform(emptyToUndefined)
  @IsNumberString({}, { message: 'QTY must be a number' })
  @IsOptional()
  productQty?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(180)
  @IsOptional()
  product2?: string;

  @Transform(emptyToUndefined)
  @IsNumberString({}, { message: 'QTY of Product 2 must be a number' })
  @IsOptional()
  product2Qty?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Language is required' })
  @MaxLength(64)
  language!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  source?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Call Status is required' })
  @MaxLength(64)
  callStatus!: string;

  @Type(() => Number)
  @IsInt({ message: 'Number of call attempts is required' })
  @Min(0)
  @Max(MAX_ATTEMPTS)
  callAttempts!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ATTEMPTS)
  @IsOptional()
  msgAttempts?: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Country is required' })
  @MaxLength(64)
  country!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  state?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  street?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  city?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  nationalCode?: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'Booking Date must be a valid date' })
  @IsOptional()
  bookingDate?: string;

  /** Defaults to "Default" (LEAD-06.1 AC3). */
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  category?: string;

  @Transform(trim)
  @IsNotEmpty({ message: 'Actual Amount is required' })
  @IsNumberString({}, { message: 'Actual Amount must be a number' })
  actualAmount!: string;

  @Transform(emptyToUndefined)
  @IsNumberString({}, { message: 'Forecasted Amount must be a number' })
  @IsOptional()
  forecastedAmount?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Payment Method is required' })
  @MaxLength(64)
  paymentMethod!: string;
}
