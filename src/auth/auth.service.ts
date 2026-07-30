import { Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../generated/prisma/client';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenService } from './refresh-token.service';

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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /**
   * Verify credentials and start a session (AUTH-01.2 + AUTH-01.3 AC1): a valid login
   * issues both an access token and a refresh token, the latter starting a new family
   * (this device's session). Unknown email, wrong password and a disabled account all
   * fail with the same generic 401 (AC2); the profile omits the hash (AC5).
   */
  async login(dto: LoginDto, userAgent?: string): Promise<SessionResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? TIMING_EQUALISER_HASH,
    );

    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const accessToken = await this.signAccessToken(user.id, user.role);
    const refreshToken = await this.refreshTokens.issue(
      user.id,
      undefined,
      userAgent,
    );

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
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) {
      await this.refreshTokens.revokeFamily(verified.familyId);
      throw new UnauthorizedException('Invalid session.');
    }

    const refreshToken = await this.refreshTokens.rotate(verified, userAgent);
    const accessToken = await this.signAccessToken(user.id, user.role);

    return { accessToken, refreshToken, user: toPublicUser(user) };
  }

  /** The access token carries user id + role claims (AUTH-01.3 AC2). */
  private signAccessToken(userId: string, role: UserRole): Promise<string> {
    return this.jwt.signAsync({ sub: userId, role });
  }
}

function toPublicUser(user: PublicUser): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
