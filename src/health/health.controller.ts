import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service';
import { Public } from '../auth/public.decorator';

/**
 * Health-check endpoint.
 *
 * With the global `api` prefix applied in `main.ts`, this is served at
 * `GET /api/health` and is used to confirm the backend is alive in each
 * environment. `@Public()` — liveness must never require authentication (AUTH-01.4).
 */
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthStatus {
    return this.health.check();
  }
}
