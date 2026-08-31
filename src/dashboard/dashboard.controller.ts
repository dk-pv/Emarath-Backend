import { Controller, Get, Query } from '@nestjs/common';
import { DashboardKpis, DashboardKpisService } from './dashboard-kpis.service';
import { DashboardKpisQueryDto } from './dto/dashboard-kpis-query.dto';

/** Thin by design: validation is the DTO's job, scoping the service's. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly kpis: DashboardKpisService) {}

  /**
   * GET /api/dashboard/kpis — the top-of-dashboard counters for one widget's own
   * period (DASH-02.1). `counters` narrows the response to what a card needs;
   * omitting it returns all six.
   */
  @Get('kpis')
  getKpis(@Query() query: DashboardKpisQueryDto): Promise<DashboardKpis> {
    return this.kpis.getKpis(query);
  }
}
