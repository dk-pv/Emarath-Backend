import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Minimal Prisma integration for NestJS.
 *
 * Prisma 7 uses the driver-adapter runtime, so the client connects through the
 * node-postgres adapter (`@prisma/adapter-pg`) using the POOLED `DATABASE_URL`.
 * CLI migration operations use the UNPOOLED URL (see prisma.config.ts).
 *
 * Connection is attempted at startup but failures are non-fatal: the process
 * stays alive (liveness `/api/health` remains up) and Prisma reconnects on the
 * next query. This keeps app liveness independent of transient DB availability.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    // Fail fast on a missing connection string in production, mirroring the JWT
    // secret gate: an unset DATABASE_URL is a deploy misconfiguration that should
    // block boot with a clear message, not silently serve an app that errors on
    // every query. (Transient DB *outages* stay non-fatal — see onModuleInit.)
    if (
      config.get<string>('app.environment') === 'production' &&
      !connectionString
    ) {
      throw new Error('DATABASE_URL must be set in production.');
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error(
        `Database connection failed at startup (app stays up, will retry on demand): ${
          (error as Error).message
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
