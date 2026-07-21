import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LeadsExportService } from './leads-export.service';
import { ExportLeadsQueryDto } from './dto/export-leads-query.dto';

/**
 * Lead export (LEAD-08.1), at `GET /api/leads/export`.
 *
 * Streams a file, so it owns the response (`@Res()`). The DTO validates format,
 * scope and the shared filters before the service runs, so an invalid request is a
 * clean 400 with nothing written; the service resolves the caller and streams.
 */
@Controller('leads/export')
export class LeadsExportController {
  constructor(private readonly service: LeadsExportService) {}

  @Get()
  export(
    @Query() query: ExportLeadsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.service.export(query, res);
  }
}
