import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Setting a new password from a reset link (AUTH-03.1). The token is the opaque value from
 * the emailed link; the password must meet the basic strength rule (AC3).
 *
 * Strength rule adopted: minimum 8 characters (with a max matching login). "Basic strength
 * rules" is not further specified by the backlog, so the least-inventive, non-exclusionary
 * rule is used — it never rejects a legitimate long passphrase. Tightening it (complexity
 * classes) is a one-line change if the Product Owner specifies more.
 */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'A reset token is required.' })
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(200)
  password!: string;
}
