import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { CurrentUser, CurrentUserService } from './current-user';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Stand-in identity provider used until AUTH-01.2/AUTH-01.3 issue real sessions.
 *
 * It resolves a seeded account instead of verifying a token. That makes it a
 * development-only shortcut, and it says so loudly: it refuses to resolve
 * anyone in production rather than quietly authorising every caller as an admin
 * on a live deployment.
 *
 * Reads a real row rather than returning a literal, so scoping is exercised
 * against a genuine user id — an agent whose id matches nothing would appear to
 * pass a scoping test while actually seeing an empty list.
 */
@Injectable()
export class DevelopmentCurrentUserService extends CurrentUserService {
  private readonly logger = new Logger(DevelopmentCurrentUserService.name);
  private warned = false;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async resolve(): Promise<CurrentUser> {
    if (process.env['NODE_ENV'] === 'production') {
      throw new UnauthorizedException('Authentication is not configured.');
    }

    if (!this.warned) {
      this.warned = true;
      this.logger.warn(
        'Requests are authorised as a seeded development user. ' +
          'AUTH-01.2/AUTH-01.3 replace this provider.',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: DevelopmentCurrentUserService.DEV_EMAIL,
        deletedAt: null,
      },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException(
        'No development user found. Run `npm run db:seed`.',
      );
    }

    return user;
  }

  /**
   * Which seeded account requests are attributed to (see src/prisma/seed.ts).
   *
   * Overridable so role scoping can be exercised as a sales agent rather than
   * only as an admin — an admin sees everything, so a scope bug is invisible
   * from that seat. AUTH-01.3 removes this along with the rest of the class.
   */
  private static get DEV_EMAIL(): string {
    return process.env['DEV_USER_EMAIL'] ?? 'admin@emarath.local';
  }
}
