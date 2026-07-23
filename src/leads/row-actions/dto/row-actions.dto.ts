import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Row "Assignee" action (LEAD-10.1 AC3): the agent to own this one lead. */
export class ReassignLeadDto {
  @IsUUID('all', { message: 'agentId must be a valid user id' })
  agentId!: string;
}

/**
 * Row "status"/"Convert" action (LEAD-10.1 AC4): the value to set the lead's
 * status to. A plain set-status primitive, not a toggle — `status` is a
 * free-text, multi-value field (New/HOT/Cold/…), so there is nothing to flip
 * between; the UI (LEAD-10.2) decides which value to send once stage config
 * (LEAD-11.1) defines the choices. Bounded to the column width.
 */
export class SetLeadStatusDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'status is required' })
  @MaxLength(64)
  status!: string;
}

/** Row "Delete" action (LEAD-10.1 AC5): confirms which lead was removed. */
export interface RowDeleteResponse {
  id: string;
}
