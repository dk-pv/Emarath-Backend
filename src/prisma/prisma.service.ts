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
