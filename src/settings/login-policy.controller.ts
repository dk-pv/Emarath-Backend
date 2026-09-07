import { Controller, Get, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { SettingsService } from './settings.service';
import { LoginPolicy } from './dto/application-controls.dto';

/**
 * The one Application Controls value the login screen must know before anyone has
 * authenticated: whether the browser's password manager is offered.
 *
 * Its own controller rather than a route on `SettingsController`, because that class is
 * `@Roles(SUPERADMIN)` as a whole and an anonymous caller carries no role at all — a
 * handler-level exception there would read as a hole in an administrator-only surface.
 * Here the narrow contract is the class: one boolean, no writes, rate-limited exactly
 * like the auth routes it serves.
 */
@Controller('settings/application-controls')
@Public()
@UseGuards(ThrottlerGuard)
export class LoginPolicyController {
  constructor(private readonly service: SettingsService) {}

  /** GET /api/settings/application-controls/login-policy */
  @Get('login-policy')
  getLoginPolicy(): Promise<LoginPolicy> {
    return this.service.getLoginPolicy();
  }
}
