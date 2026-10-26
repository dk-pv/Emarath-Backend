import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UserRole } from '../generated/prisma/client';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenService } from './refresh-token.service';
import { PasswordResetService } from './password-reset.service';
import {
  MailerService,
  PASSWORD_RESET_DISABLED_MESSAGE,
} from './mailer.service';
import type { MailConfig } from '../config/mail.config';
import { recordAuditEvents, userActor } from '../audit/audit-events';
import { userEvent } from '../users/user-audit';

/** bcrypt work factor for a stored password hash (matches the seed's rounds). */
const BCRYPT_ROUNDS = 10;

/** The profile returned on login/refresh — never includes the password hash (AC5). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

/** A started or renewed session: an access token, a refresh token, and the profile. */
export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

/**
 * A valid bcrypt hash of a throwaway value. `login` always runs `bcrypt.compare`
 * against a hash — this one when the email is unknown — so the response time does
 * not reveal whether an account exists (AC2, no user enumeration).
 */
const TIMING_EQUALISER_HASH = bcrypt.hashSync('emarath-timing-equaliser', 10);

/**
 * The account an address names, among the rows a case-insensitive lookup returned: the exact
 * match, else one equal to it ignoring case. The lookup only narrows — Prisma runs
 * `mode: 'insensitive'` as ILIKE on PostgreSQL, where `%` and `_`, both legal in an address, are
 * wildcards — so a returned row is not yet a match. One lookup either way, so an unknown address
 * costs what a known one does (AC2).
 */
function accountFor<T extends { email: string }>(
  rows: T[],
  email: string,
): T | null {
  const lower = email.toLowerCase();
  return (
    rows.find((row) => row.email === email) ??
    rows.find((row) => row.email.toLowerCase() === lower) ??
    null
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly passwordResets: PasswordResetService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verify credentials and start a session (AUTH-01.2 + AUTH-01.3 AC1): a valid login
   * issues both an access token and a refresh token, the latter starting a new family
   * (this device's session). Unknown email, wrong password and a disabled account all
   * fail with the same generic 401 (AC2); the profile omits the hash (AC5).
   */
  async login(dto: LoginDto, userAgent?: string): Promise<SessionResult> {
    const select = {
      id: true,
      name: true,
      email: true,
      role: true,
      team: true,
      isActive: true,
      passwordHash: true,
    } satisfies Prisma.UserSelect;
    // Addresses are stored lower-cased, but a phone keyboard capitalises the first letter and an
    // older account may hold capitals, so the lookup ignores case. The password still decides,
    // so a case-only twin can at worst fail the login.
    const user = accountFor(
      await this.prisma.user.findMany({
        where: {
          email: { equals: dto.email, mode: 'insensitive' },
          deletedAt: null,
        },
        select,
      }),
      dto.email,
    );

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? TIMING_EQUALISER_HASH,
    );

    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const accessToken = await this.signAccessToken(
      user.id,
      user.role,
      user.team,
    );
    const refreshToken = await this.refreshTokens.issue(
      user.id,
      undefined,
      userAgent,
    );

    // Roster activity columns (Settings > Users & Access). Stamped after the credentials
    // pass, so a failed attempt never advances either timestamp.
    await this.touchActivity(user.id, true);

    return { accessToken, refreshToken, user: toPublicUser(user) };
  }

  /**
   * Exchange a valid refresh token for a fresh access token and a rotated refresh token
   * (AUTH-01.3 AC3). The presented token is validated and rotated (ADR §3.3); the user is
   * re-checked (still present, not deleted, active) so a disabled/removed account cannot
   * keep refreshing. Invalid, expired, tampered or reused tokens are rejected (AC4).
   */
  async refresh(rawToken: string, userAgent?: string): Promise<SessionResult> {
    const verified = await this.refreshTokens.verify(rawToken);

    const user = await this.prisma.user.findFirst({
      where: { id: verified.userId, deletedAt: null, isActive: true },
      select: { id: true, name: true, email: true, role: true, team: true },
    });
    if (!user) {
      await this.refreshTokens.revokeFamily(verified.familyId);
      throw new UnauthorizedException('Invalid session.');
    }

    const refreshToken = await this.refreshTokens.rotate(verified, userAgent);
    const accessToken = await this.signAccessToken(
      user.id,
      user.role,
      user.team,
    );

    // A refresh means the user is still working, so presence advances — but this is not a
    // new login, so `lastLoginAt` is left alone.
    await this.touchActivity(user.id, false);

    return { accessToken, refreshToken, user: toPublicUser(user) };
  }

  /**
   * End the session (AUTH-01.5 AC1): revoke the presented refresh token's family so it can
   * no longer refresh (AC4). Idempotent — an absent or unknown token is a no-op, so logout
   * never fails and may be called repeatedly. The controller clears the cookies (AC2/AC3).
   */
  async logout(rawToken?: string): Promise<void> {
    if (rawToken) {
      await this.refreshTokens.revokeByRawToken(rawToken);
    }
  }

  /**
   * Begin password recovery (AUTH-03.1 AC1). For a known, active account this issues a
   * single-use, expiring token and emails the reset link; for an unknown or inactive email
   * it does nothing. Either way it returns normally with no signal of which happened (AC2 —
   * no enumeration). The email is sent without blocking the response, so a slow transport
   * cannot make the "account exists" path measurably slower, and a send failure never
   * surfaces to the caller. With no email provider configured every request is refused with a
   * 503 before any lookup: that is a property of the server, not of the account, so it reveals
   * nothing about an address, and no token is issued that could never be delivered.
   */
  async requestPasswordReset(email: string): Promise<void> {
    if (!this.mailer.enabled) {
      throw new ServiceUnavailableException(PASSWORD_RESET_DISABLED_MESSAGE);
    }
    // As at login: one lookup that ignores case, and the address itself decides.
    const user = accountFor(
      await this.prisma.user.findMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          deletedAt: null,
          isActive: true,
        },
        select: { id: true, email: true },
      }),
      email,
    );
    if (!user) {
      return;
    }

    const rawToken = await this.passwordResets.issueFor(user.id);
    const { webAppUrl } = this.config.getOrThrow<MailConfig>('mail');
    const resetUrl = `${webAppUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

    void this.mailer
      .sendPasswordReset({ to: user.email, resetUrl })
      .catch((error: unknown) => {
        // The user id, not the address: a provider outage must not copy every requester's
        // email into the log.
        this.logger.error(
          `Password reset email failed for user ${user.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
  }

  /**
   * Complete password recovery (AUTH-03.1 AC3/AC5). The token is validated and spent
   * (single-use — AC4); the account is re-checked (present, not deleted, active); the new
   * password replaces the hash; and every existing session is revoked, so the user can log
   * in only with the new password and any pre-reset session dies. A used, expired, invalid
   * token or a vanished account all fail with the same generic error.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const userId = await this.passwordResets.consume(rawToken);

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset link.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // The holder of the reset link is the account itself, so the account is the actor.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      recordAuditEvents(this.prisma, [
        userEvent(
          user.id,
          'PASSWORD_RESET',
          userActor(user),
          'auth.reset-password',
        ),
      ]),
    ]);
    await this.refreshTokens.revokeAllForUser(user.id);
  }

  /**
   * Advances the roster's activity columns.
   *
   * Deliberately only on login and refresh rather than on every authenticated request: a
   * write per request would put the roster's cosmetic "Last Seen" column in the hot path of
   * every API call. Refresh recurs on its own as the access token expires, so this tracks
   * presence closely enough for a directory without that cost.
   *
   * Failure is swallowed: presence is display data, and a write blip must never turn a
   * successful login into a failed one.
   */
  private async touchActivity(userId: string, isLogin: boolean): Promise<void> {
    const now = new Date();
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: now, ...(isLogin ? { lastLoginAt: now } : {}) },
      });
    } catch (error) {
      this.logger.warn(
        `Could not record activity for user ${userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * The access token carries user id + role claims (AUTH-01.3 AC2), plus the team label
   * (AUTH-02.1 / ADR-0030 §4) so the guard can resolve manager team-scope without a DB read.
   * `team` is null for users with no team; the claim is still present for uniformity.
   */
  private signAccessToken(
    userId: string,
    role: UserRole,
    team: string | null,
  ): Promise<string> {
    return this.jwt.signAsync({ sub: userId, role, team });
  }
}

function toPublicUser(user: PublicUser): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
