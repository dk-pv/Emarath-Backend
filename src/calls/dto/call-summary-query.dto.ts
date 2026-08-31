import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * The period the Call summary KPIs cover (CALL-03.1 AC5). Absent → Today (the
 * service defaults it). `from`/`to` are the resolved window the summary filter
 * sends (the video's period presets + custom Date From/To collapse to a range
 * on the client). `to` is exclusive. `agentId` is the popup's "Select User" leg;
 * role scoping is applied regardless, so it can only ever narrow what the caller
 * may already see.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

export class CallSummaryQueryDto {
  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'from must be a valid date' })
  @IsOptional()
  from?: string;

  @Transform(emptyToUndefined)
  @IsDateString({}, { message: 'to must be a valid date' })
  @IsOptional()
  to?: string;

  /** "Select User" — narrows every figure to one agent. Never widens scope. */
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'agentId must be a valid id' })
  @IsOptional()
  agentId?: string;
}
