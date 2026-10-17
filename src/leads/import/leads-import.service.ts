import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import {
  EvaluatedRow,
  ImportField,
  RowError,
} from '../../common/import/import-descriptor';
import {
  EvaluationSummary,
  ImportEngineService,
} from '../../common/import/import-engine.service';
import { SampleFormat, buildSampleFile } from '../../common/import/sample-file';
import {
  ParsedSheet,
  parseSpreadsheet,
} from '../../common/import/spreadsheet-parser';
import { CONVERTED_STATUS } from '../../reports/converted-leads-where';
import {
  LeadsImportContext,
  LeadsImportDescriptor,
  LeadsImportRun,
} from './leads-import.descriptor';
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

    const preview = sheet.rows.slice(0, PREVIEW_LIMIT).map(({ cells }) => {
      const row: Record<string, string> = {};
      sheet.headers.forEach((header, index) => {
        row[header] = cells[index] ?? '';
      });
      return row;
    });

    return { columns: sheet.headers, preview, totalRows: sheet.rows.length };
  }

  /** The import template, generated from the field catalog the importer validates against. */
  async sample(format: SampleFormat): Promise<Buffer> {
    await this.currentUser.resolve();
    return buildSampleFile(
      this.descriptor.fields,
      await this.descriptor.sampleRows(),
      format,
    );
  }

  async validate(
    file: UploadedFile,
    dto: ImportBodyDto,
  ): Promise<ValidateResult> {
    const user = await this.currentUser.resolve();
    const sheet = await parseSpreadsheet(file);
    const mapping = this.parseMapping(dto.mapping);
    this.assertMapping(mapping);
    const run = await this.descriptor.prepare(dto.pipeline, user);

    const { rows, summary } = await this.evaluate(sheet, mapping, run);

    // Rows that need attention first, so the bounded window always shows them.
    const window = [
      ...rows.filter((row) => row.status !== 'valid'),
      ...rows.filter((row) => row.status === 'valid'),
    ].slice(0, VALIDATE_ROW_LIMIT);

    return {
      ...summary,
      rows: window.map((row) => ({
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
    this.assertMapping(mapping);
    const run = await this.descriptor.prepare(dto.pipeline, user);

    const { rows, summary } = await this.evaluate(sheet, mapping, run);

    const errors = this.collectErrors(rows);
    // A duplicate is written as its own lead (ADR-0092), so nothing is skipped.
    const skipped = this.descriptor.importsDuplicates ? 0 : summary.duplicates;

    const job = await this.jobs.create({
      module: this.descriptor.module,
      status: 'PROCESSING',
      fileName: file.originalname,
      pipeline: dto.pipeline,
      mapping: mapping,
      totalRows: summary.total,
      // Rows that are not written are settled up front; only the writable ones still process.
      processedRows: summary.invalid + skipped,
      skippedCount: skipped,
      failedCount: summary.invalid,
      errors: errors.length
        ? (errors as unknown as Prisma.InputJsonValue)
        : undefined,
      startedAt: new Date(),
      createdBy: { connect: { id: user.id } },
    });

    // Background write — deliberately not awaited; the response returns the id now.
    void this.processJob(job.id, rows, {
      pipeline: dto.pipeline,
      defaultStatus: run.defaultStatus,
      user,
      jobId: job.id,
    });

    return { jobId: job.id };
  }

  private async processJob(
    jobId: string,
    rows: EvaluatedRow[],
    context: LeadsImportContext,
  ): Promise<void> {
    const writable = this.engine.writable(rows, this.descriptor);
    const settledCount = rows.length - writable.length;
    // Set before the progress write, so it stays right even when that write fails.
    let landed = 0;

    try {
      const imported = await this.engine.persistValid(
        rows,
        this.descriptor,
        context,
        async (importedSoFar) => {
          landed = importedSoFar;
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
      // Valid rows after the failed batch were never written. They count as failed and
      // join the error report, so the totals add up and the report lists what to retry.
      const unwritten = writable.slice(landed).map((row): RowError => ({
        rowNumber: row.rowNumber,
        values: row.values,
        reason:
          'Not imported: the import stopped before this row was written. Import the file again to add it.',
        errorCode: 'NOT_IMPORTED',
      }));
      const errors = [...this.collectErrors(rows), ...unwritten];
      await this.jobs
        .update(jobId, {
          status: 'FAILED',
          completedAt: new Date(),
          importedCount: landed,
          processedRows: rows.length,
          failedCount:
            rows.filter((row) => row.status === 'invalid').length +
            unwritten.length,
          errors: errors as unknown as Prisma.InputJsonValue,
        })
        .catch((updateError: unknown) =>
          this.logger.error(
            `Import job ${jobId}: could not record the failure: ${(updateError as Error).message}`,
          ),
        );
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
    return { jobs: rows.map((row) => toImportJobResponse(row)) };
  }

  /** The rows the report lists: invalid ones, plus duplicates when they are skipped, not written. */
  private collectErrors(rows: EvaluatedRow[]): RowError[] {
    const written = new Set(this.engine.writable(rows, this.descriptor));
    const errors: RowError[] = [];
    for (const row of rows) {
      if (row.status !== 'valid' && !written.has(row) && row.error) {
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

  /**
   * The engine's verdict on every row, then the one rule only this run knows: a row that would
   * arrive WON — its own Lead Status, or the pipeline's first stage standing in for a blank one —
   * would be a converted lead, and a converted lead's order needs a delivery date (client,
   * 2026-10-17) that import has no column for yet. Each such row is refused on its own, as a row
   * error, so the rest of the file still imports and nothing is written for it.
   */
  private async evaluate(
    sheet: ParsedSheet,
    mapping: Record<string, string | null>,
    run: LeadsImportRun,
  ): Promise<{ rows: EvaluatedRow[]; summary: EvaluationSummary }> {
    const { rows } = await this.engine.evaluate(
      sheet,
      mapping,
      this.descriptor,
      run.fields,
    );
    const settled = rows.map((row) => refuseConversion(row, run.defaultStatus));
    return { rows: settled, summary: this.engine.summarise(settled) };
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

  /**
   * Every mapped target is a real field, none is fed by two columns (the engine would
   * silently keep one), and every required field is mapped.
   */
  private assertMapping(mapping: Record<string, string | null>): void {
    const mapped = Object.values(mapping).filter((value): value is string =>
      Boolean(value),
    );
    const byValue = new Map<string, ImportField>(
      this.descriptor.fields.map((field) => [field.value, field]),
    );

    const unknown = mapped.find((value) => !byValue.has(value));
    if (unknown) {
      throw new BadRequestException(`"${unknown}" is not an import field.`);
    }
    const twice = mapped.find(
      (value, index) => mapped.indexOf(value) !== index,
    );
    if (twice) {
      throw new BadRequestException(
        `${byValue.get(twice)?.label} is mapped from more than one column. Map it from one column only.`,
      );
    }
    const missing = this.descriptor.fields.filter(
      (field) => field.required && !mapped.includes(field.value),
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

/**
 * A row that would be created WON — by its own Lead Status or, left blank, by the pipeline's first
 * stage — refused with a row error; any other row as it was.
 */
function refuseConversion(
  row: EvaluatedRow,
  defaultStatus: string,
): EvaluatedRow {
  if (row.status === 'invalid') return row;
  const explicit = row.mapped.status;
  if ((explicit || defaultStatus) !== CONVERTED_STATUS) return row;
  return {
    ...row,
    status: 'invalid',
    error: {
      errorCode: 'INVALID_OPTION',
      reason: explicit
        ? `Lead Status ${CONVERTED_STATUS} converts the lead, and a converted lead needs a Delivery Date, which import can’t take yet. Import the row with another Lead Status and convert it in Emarath with its Delivery Date`
        : `Lead Status is blank, so the row would take the pipeline’s first stage, ${CONVERTED_STATUS}, and convert without a Delivery Date. Give the row another Lead Status and convert it in Emarath with its Delivery Date`,
    },
  };
}
