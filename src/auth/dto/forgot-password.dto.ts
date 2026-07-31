import { IsEmail, MaxLength } from 'class-validator';

/**
 * A password-reset request (AUTH-03.1). Only the email is needed. A malformed email is a
 * 400 from the global ValidationPipe; a well-formed but unregistered email is accepted and
 * returns the same generic success as a registered one (AC2 — no account enumeration).
 */
export class ForgotPasswordDto {
  @IsEmail({}, { message: 'A valid email is required.' })
  @MaxLength(180)
  email!: string;
}
