import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service';

/**
 * Health-check endpoint.
 *
 * With the global `api` prefix applied in `main.ts`, this is served at
 * `GET /api/health` and is used to confirm the backend is alive in each
 * environment.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthStatus {
    return this.health.check();
  }
}
