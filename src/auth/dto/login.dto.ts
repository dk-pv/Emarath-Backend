import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Login credentials (AUTH-01.2). The identifier is the email, matching the Workpex
 * login screen (`ui-reference/loginPage.png`). Malformed input is a 400 from the
 * global ValidationPipe; wrong-but-well-formed credentials are the service's generic
 * 401 (AC2) — the two never leak which field was wrong or whether the account exists.
 */
export class LoginDto {
  @IsEmail({}, { message: 'A valid email is required.' })
  @MaxLength(180)
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required.' })
  @MaxLength(200)
  password!: string;
}
