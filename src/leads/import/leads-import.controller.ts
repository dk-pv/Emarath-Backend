import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { MAX_IMPORT_BYTES } from '../../common/import/spreadsheet-parser';
import { errorsToCsv } from '../../common/import/errors-to-csv';
import { LeadsImportService } from './leads-import.service';
import { ImportBodyDto } from './dto/import-body.dto';
import {
  ImportFieldOption,
  ImportJobResponse,
  ParseResult,
  ValidateResult,
} from './dto/import-response.dto';

/** Buffer at most the business cap; the service re-checks and reports cleanly. */
const UPLOAD_OPTIONS = { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } };

/**
 * Bulk import endpoints (LEAD-07.1), all under `/api/leads/import`.
 *
 * Thin by design: the service owns parsing, validation and the job lifecycle.
 * Static routes (`fields`, `history`) are declared before `:jobId` so they are
 * never captured as an id, mirroring the leads controller's ordering.
 */
@Controller('leads/import')
export class LeadsImportController {
  constructor(private readonly service: LeadsImportService) {}

  /** GET /api/leads/import/fields — the target field catalog. */
  @Get('fields')
  fields(): { fields: ImportFieldOption[] } {
    return this.service.fields();
  }

  /** GET /api/leads/import/history — recent jobs, scoped by role. */
  @Get('history')
  history(
    @Query('limit') limit?: string,
  ): Promise<{ jobs: ImportJobResponse[] }> {
    return this.service.history(limit);
  }

  /** GET /api/leads/import/:jobId/errors — failed rows as JSON or `?format=csv`. */
  @Get(':jobId/errors')
  async errors(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Res() res: Response,
    @Query('format') format?: string,
  ): Promise<void> {
    const errors = await this.service.getErrors(jobId);

    if (format === 'csv') {
      res
        .status(200)
        .setHeader('Content-Type', 'text/csv; charset=utf-8')
        .setHeader(
          'Content-Disposition',
          `attachment; filename="import-${jobId}-errors.csv"`,
        )
        .send(errorsToCsv(errors));
      return;
    }

    res.status(200).json({ errors });
  }

  /** GET /api/leads/import/:jobId — poll one job. */
  @Get(':jobId')
  job(
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<ImportJobResponse> {
    return this.service.getJob(jobId);
  }

  /** POST /api/leads/import/parse — detect columns and preview rows. */
  @Post('parse')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  parse(@UploadedFile() file?: Express.Multer.File): Promise<ParseResult> {
    return this.service.parse(requireFile(file));
  }

  /** POST /api/leads/import/validate — classify rows without persisting. */
  @Post('validate')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  validate(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ImportBodyDto,
  ): Promise<ValidateResult> {
    return this.service.validate(requireFile(file), dto);
  }

  /** POST /api/leads/import — start an async import, returns the job id. */
  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  start(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ImportBodyDto,
  ): Promise<{ jobId: string }> {
    return this.service.startImport(requireFile(file), dto);
  }
}

/** Narrows the optional upload to a present file, or a clean 400. */
function requireFile(file?: Express.Multer.File): Express.Multer.File {
  if (!file) {
    throw new BadRequestException('A CSV or XLSX file is required.');
  }
  return file;
}
