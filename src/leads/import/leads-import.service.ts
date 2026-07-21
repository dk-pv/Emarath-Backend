import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { EvaluatedRow, RowError } from '../../common/import/import-descriptor';
import { ImportEngineService } from '../../common/import/import-engine.service';
import { parseSpreadsheet } from '../../common/import/spreadsheet-parser';
import {
  LeadsImportContext,
  LeadsImportDescriptor,
} from './leads-import.descriptor';
import { LEADS_REQUIRED_FIELDS } from './leads-import.fields';
import {
  ImportJobRepository,
  resolveHistoryLimit,
} from './import-job.repository';
import { importJobScopeWhere } from './import-job-scope';
import { ImportBodyDto } from './dto/import-body.dto';
import {
  ImportFieldOption,
  ImportJobResponse,
  ParseResult,
  ValidateResult,
  toImportJobResponse,
} from './dto/import-response.dto';

/** The first rows returned for the preview table (whole-file counts are exact). */
const PREVIEW_LIMIT = 20;
const VALIDATE_ROW_LIMIT = 200;

type UploadedFile = { originalname: string; buffer: Buffer; size: number };

/**
 * Wires the generic import engine to the Leads descriptor (LEAD-07.1).
 *
 * Parse and validate are stateless — the browser re-sends its file — so no upload
 * is stored between steps. Only the import persists an `ImportJob`: it evaluates
 * synchronously (fast, in-memory plus one dedupe query), returns the job id, then
 * writes the valid rows in the background, updating the job so the client polls
 * real progress. Processing runs in-process on one instance; a queue is the
 * multi-instance evolution and does not change this contract.
 */
@Injectable()
export class LeadsImportService {
  private readonly logger = new Logger(LeadsImportService.name);

  constructor(
    private readonly engine: ImportEngineService,
    private readonly descriptor: LeadsImportDescriptor,
    private readonly jobs: ImportJobRepository,
    private readonly currentUser: CurrentUserService,
  ) {}

  fields(): { fields: ImportFieldOption[] } {
    return {
      fields: this.descriptor.fields.map((field) => ({
        value: field.value,
        label: field.label,
        required: Boolean(field.required),
      })),
    };
  }

  async parse(file: UploadedFile): Promise<ParseResult> {
    await this.currentUser.resolve();
    const sheet = await parseSpreadsheet(file);

    const preview = sheet.rows.slice(0, PREVIEW_LIMIT).map((cells) => {
      const row: Record<string, string> = {};
      sheet.headers.forEach((header, index) => {
        row[header] = cells[index] ?? '';
      });
      return row;
    });

    return { columns: sheet.headers, preview, totalRows: sheet.rows.length };
  }

  async validate(
    file: UploadedFile,
    dto: ImportBodyDto,
  ): Promise<ValidateResult> {
    await this.currentUser.resolve();
    const sheet = await parseSpreadsheet(file);
    const mapping = this.parseMapping(dto.mapping);
    this.assertRequiredMapped(mapping);

    const { rows, summary } = await this.engine.evaluate(
      sheet,
      mapping,
      this.descriptor,
    );

    return {
      ...summary,
      rows: rows.slice(0, VALIDATE_ROW_LIMIT).map((row) => ({
        rowNumber: row.rowNumber,
        values: row.values,
        status: row.status,
        error: row.error,
      })),
    };
  }

  async startImport(
    file: UploadedFile,
    dto: ImportBodyDto,
  ): Promise<{ jobId: string }> {
    const user = await this.currentUser.resolve();
    const sheet = await parseSpreadsheet(file);
    const mapping = this.parseMapping(dto.mapping);
    this.assertRequiredMapped(mapping);

    if (sheet.rows.length === 0) {
      throw new BadRequestException('The file has no data rows to import.');
    }

    const { rows, summary } = await this.engine.evaluate(
      sheet,
      mapping,
      this.descriptor,
    );

    const errors = this.collectErrors(rows);

    const job = await this.jobs.create({
      module: this.descriptor.module,
      status: 'PROCESSING',
      fileName: file.originalname,
      pipeline: dto.pipeline,
      mapping: mapping,
      totalRows: summary.total,
      // Invalid and duplicate rows are settled up front; only valid rows still process.
      processedRows: summary.invalid + summary.duplicates,
      skippedCount: summary.duplicates,
      failedCount: summary.invalid,
      errors: errors.length
        ? (errors as unknown as Prisma.InputJsonValue)
        : undefined,
      startedAt: new Date(),
      createdBy: { connect: { id: user.id } },
    });

    // Background write — deliberately not awaited; the response returns the id now.
    void this.processJob(job.id, rows, { pipeline: dto.pipeline, user });

    return { jobId: job.id };
  }

  private async processJob(
    jobId: string,
    rows: EvaluatedRow[],
    context: LeadsImportContext,
  ): Promise<void> {
    const settledCount = rows.filter((row) => row.status !== 'valid').length;

    try {
      const imported = await this.engine.persistValid(
        rows,
        this.descriptor,
        context,
        async (importedSoFar) => {
          await this.jobs.update(jobId, {
            processedRows: settledCount + importedSoFar,
            importedCount: importedSoFar,
          });
        },
      );

      await this.jobs.update(jobId, {
        status: 'COMPLETED',
        importedCount: imported,
        processedRows: rows.length,
        completedAt: new Date(),
      });
    } catch (error) {
      this.logger.error(
        `Import job ${jobId} failed: ${(error as Error).message}`,
      );
      await this.jobs
        .update(jobId, { status: 'FAILED', completedAt: new Date() })
        .catch(() => undefined);
    }
  }

  async getJob(jobId: string): Promise<ImportJobResponse> {
    const user = await this.currentUser.resolve();
    const job = await this.jobs.findScoped(jobId, importJobScopeWhere(user));
    if (!job) throw new NotFoundException('Import job not found.');
    return toImportJobResponse(job);
  }

  async getErrors(jobId: string): Promise<RowError[]> {
    const user = await this.currentUser.resolve();
    const job = await this.jobs.findErrors(jobId, importJobScopeWhere(user));
    if (!job) throw new NotFoundException('Import job not found.');
    return (job.errors as unknown as RowError[] | null) ?? [];
  }

  async history(limit?: string): Promise<{ jobs: ImportJobResponse[] }> {
    const user = await this.currentUser.resolve();
    const rows = await this.jobs.history(
      importJobScopeWhere(user),
      resolveHistoryLimit(limit),
    );
    return { jobs: rows.map(toImportJobResponse) };
  }

  private collectErrors(rows: EvaluatedRow[]): RowError[] {
    const errors: RowError[] = [];
    for (const row of rows) {
      if (row.status !== 'valid' && row.error) {
        errors.push({
          rowNumber: row.rowNumber,
          values: row.values,
          reason: row.error.reason,
          errorCode: row.error.errorCode,
        });
      }
    }
    return errors;
  }

  private parseMapping(raw: string): Record<string, string | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('The field mapping is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('The field mapping must be an object.');
    }

    const mapping: Record<string, string | null> = {};
    for (const [column, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (value === null || typeof value === 'string') {
        mapping[column] = value;
      } else {
        throw new BadRequestException('The field mapping is malformed.');
      }
    }
    return mapping;
  }

  private assertRequiredMapped(mapping: Record<string, string | null>): void {
    const mappedValues = new Set(
      Object.values(mapping).filter((value): value is string => Boolean(value)),
    );
    const missing = LEADS_REQUIRED_FIELDS.filter(
      (field) => !mappedValues.has(field.value),
    );
    if (missing.length) {
      throw new BadRequestException(
        `MAPPING_INCOMPLETE: ${missing
          .map((field) => field.label)
          .join(', ')} must be mapped.`,
      );
    }
  }
}
