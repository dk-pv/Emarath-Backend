import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GpsExportService } from './gps-export.service';
import { ExportGpsQueryDto } from './dto/export-gps-query.dto';

/**
 * GPS activity export (GPS-08.1), at `GET /api/gps/export`.
 *
 * Streams a file, so it owns the response (`@Res()`). The DTO validates format,
 * period and Team Member (the shared summary filter) before the service runs, so
 * an invalid request is a clean 400 with nothing written. Mirrors the leads
 * export controller.
 */
@Controller('gps/export')
export class GpsExportController {
  constructor(private readonly service: GpsExportService) {}

  @Get()
  export(
    @Query() query: ExportGpsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.service.export(query, res);
  }
}
