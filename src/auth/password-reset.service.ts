import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthConfig } from '../config/auth.config';

/**
 * Password-reset token persistence (AUTH-03.1, ADR-0031).
 *
 * The token is an opaque 256-bit random value; only its sha-256 hash is stored, so the DB
 * never holds a usable token — the same shape as RefreshTokenService. A token is
 * single-use (`usedAt`) and short-lived (`expiresAt`); issuing a new one invalidates the
 * user's earlier unused tokens, so at most one link is ever live.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private expiry(): Date {
    const { resetTokenTtlSec } = this.config.getOrThrow<AuthConfig>('auth');
    return new Date(Date.now() + resetTokenTtlSec * 1000);
  }

  /**
   * Issue a reset token for a user. Any earlier unused token for that user is invalidated
   * first, so only the latest link works. Returns the raw token — the only place it exists
   * in plaintext, to be embedded in the emailed link.
   */
  async issueFor(userId: string): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId,
          tokenHash: this.hash(rawToken),
          expiresAt: this.expiry(),
        },
      });
    });
    return rawToken;
  }

  /**
   * Validate and atomically spend a presented token. Unknown, already-used and expired
   * tokens are rejected with the same generic error (AC4) — the caller never learns which.
   * The single guarded `updateMany` marks the row used only if it is still unused and
   * unexpired, so two concurrent resets cannot both succeed. Returns the owning user id.
   */
  async consume(rawToken: string): Promise<string> {
    const tokenHash = this.hash(rawToken);
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!row) {
      throw new UnauthorizedException('Invalid or expired reset link.');
    }

    const spent = await this.prisma.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (spent.count !== 1) {
      throw new UnauthorizedException('Invalid or expired reset link.');
    }
    return row.userId;
  }
}
