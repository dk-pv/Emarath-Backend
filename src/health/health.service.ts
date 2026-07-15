import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

export interface HealthStatus {
  status: 'ok';
  service: string;
  environment: string;
  timestamp: string;
  uptime: number;
}

/**
 * Lightweight liveness reporting for the Emarath backend.
 *
 * Intentionally does NOT check the database or any external dependency —
 * those are introduced by later backlog tasks (FND-01.2 onwards).
 */
@Injectable()
export class HealthService {
  constructor(private readonly config: ConfigService) {}

  check(): HealthStatus {
    const app = this.config.get<AppConfig>('app');

    return {
      status: 'ok',
      service: app?.name ?? 'Emarath Backend',
      environment: app?.environment ?? 'development',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
