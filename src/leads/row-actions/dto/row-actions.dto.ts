import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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

/**
 * Row "Email" action (LEAD-10.2, ADR-0032): the composed message to send from a
 * lead's row. `to` must carry at least one valid email; Cc/Bcc/Subject/Message are
 * optional. The From is the server's verified sender (`MAIL_FROM`) — never accepted
 * from the client — so this DTO deliberately has no `from`.
 */
export class SendLeadEmailDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one recipient is required' })
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true, message: 'each recipient must be a valid email' })
  to!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true, message: 'each Cc must be a valid email' })
  cc?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true, message: 'each Bcc must be a valid email' })
  bcc?: string[];

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  message?: string;
}

/** Row "Email" action result — the compose drawer closes on `sent: true`. */
export interface SendLeadEmailResponse {
  sent: boolean;
}
