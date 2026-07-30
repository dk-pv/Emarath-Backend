import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthConfig } from '../config/auth.config';

/** A validated, still-live refresh token, resolved from the presented raw value. */
export interface VerifiedRefreshToken {
  id: string;
  userId: string;
  familyId: string;
}

/**
 * Refresh-token persistence and rotation (AUTH-01.3, ADR-0029 §3).
 *
 * The token is an opaque 256-bit random value; only its sha-256 hash is stored, so the
 * DB never holds a usable token. Each login starts a `familyId` (one device); refresh
 * rotates within the family. Presenting an already-revoked token is treated as theft and
 * revokes the whole family.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private expiry(): Date {
    const { refreshTtlSec } = this.config.getOrThrow<AuthConfig>('auth');
    return new Date(Date.now() + refreshTtlSec * 1000);
  }

  /**
   * Issue a new refresh token. Omitting `familyId` starts a new family (a fresh login /
   * device); passing one continues an existing lineage (rotation). Returns the raw token
   * — the only place it exists in plaintext.
   */
  async issue(
    userId: string,
    familyId?: string,
    userAgent?: string,
  ): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(rawToken),
        familyId: familyId ?? randomUUID(),
        expiresAt: this.expiry(),
        userAgent: userAgent ?? null,
      },
    });
    return rawToken;
  }

  /**
   * Validate a presented refresh token without rotating it. Rejects unknown, expired and
   * revoked tokens with the same generic error; a revoked token additionally revokes its
   * whole family (reuse detection). The caller checks the user, then calls `rotate`.
   */
  async verify(rawToken: string): Promise<VerifiedRefreshToken> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });
    if (!row) {
      throw new UnauthorizedException('Invalid session.');
    }
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Invalid session.');
    }
    if (row.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid session.');
    }
    return { id: row.id, userId: row.userId, familyId: row.familyId };
  }

  /**
   * Rotate a verified token: atomically issue a replacement in the same family and revoke
   * the presented row (recording the successor). Returns the new raw token.
   */
  async rotate(
    token: VerifiedRefreshToken,
    userAgent?: string,
  ): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      const replacement = await tx.refreshToken.create({
        data: {
          userId: token.userId,
          tokenHash: this.hash(rawToken),
          familyId: token.familyId,
          expiresAt: this.expiry(),
          userAgent: userAgent ?? null,
        },
      });
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date(), replacedById: replacement.id },
      });
    });
    return rawToken;
  }

  /** Revoke every still-live token in a family (reuse response; logout reuses this in 01.5). */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
