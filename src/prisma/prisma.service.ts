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
/**
 * Connection pool and transaction budgets.
 *
 * A round trip to the managed Postgres costs ~1.2s here, so a list request holds
 * its connection for about that long. With node-postgres' default pool of 10, a
 * page opened by more than ten concurrent callers queues, and Prisma's default
 * 2s `maxWait` then aborts the waiters with
 * "Transaction API error: Unable to start a transaction in the given time" —
 * surfacing as a 500 on an otherwise valid request. That is pool exhaustion, not
 * a failing query: every list endpoint (Leads included) fails the same way, so
 * the budgets belong here rather than in any one module.
 *
 * `maxWait` is therefore sized to queue behind a saturated pool instead of giving
 * up mid-round-trip; `timeout` still bounds a transaction that has actually started,
 * so a runaway query cannot hold a connection indefinitely.
 */
const POOL_SIZE = 20;
const TRANSACTION_MAX_WAIT_MS = 15_000;
const TRANSACTION_TIMEOUT_MS = 20_000;
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
    super({
      adapter: new PrismaPg({ connectionString, max: POOL_SIZE }),
      transactionOptions: {
        maxWait: TRANSACTION_MAX_WAIT_MS,
        timeout: TRANSACTION_TIMEOUT_MS,
      },
    });
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
