import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { Prisma } from '../../generated/prisma/client';
import { CurrentUserService } from '../../auth/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildLeadWhere,
  duplicatePhones,
  withSearchScope,
} from '../lead-where';
import { LeadSortColumn } from '../dto/list-leads-query.dto';
import { ExportLeadsQueryDto } from './dto/export-leads-query.dto';
import {
  csvCell,
  ExportColumn,
  LEAD_EXPORT_SELECT,
  LeadExportRow,
  resolveExportColumns,
} from './leads-export.columns';

/** Rows are read in pages so a 20,000-row export never loads the whole set at once. */
const BATCH_SIZE = 1000;
/** A hard ceiling so a runaway filter cannot stream unbounded rows (AC5 safety). */
const MAX_EXPORT_ROWS = 100_000;

/**
 * Streams the scoped, filtered, sorted leads to a CSV or XLSX download (LEAD-08.1).
 *
 * The `where` and sort are the exact query the list runs (`buildLeadWhere` plus the
 * "Duplicate Lead" search scope), so the file matches the on-screen view and respects
 * role scoping (AC1/AC2). Rows
 * are pulled in batches and written straight to the response, so memory stays flat
 * regardless of how many rows match (AC5). CSV and Excel need no new dependency:
 * ExcelJS (already used by import) writes both.
 */
@Injectable()
export class LeadsExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async export(query: ExportLeadsQueryDto, res: Response): Promise<void> {
    const user = await this.currentUser.resolve();
    const where = await withSearchScope(
      user,
      query,
      buildLeadWhere(user, query),
      (scope) => duplicatePhones(this.prisma, scope),
    );
    const columns = resolveExportColumns(query.scope, query.columns);
    const filename = exportFilename(query.format);

    // The first page is read before any status or header goes out, so a query that
    // fails up front is an ordinary error response — never a 200 file with no rows.
    const pages = this.batches(where, query.sort, query.direction);
    const first = await pages.next();
    async function* rows(): AsyncGenerator<LeadExportRow[]> {
      if (!first.done) yield first.value;
      yield* pages;
    }

    try {
      if (query.format === 'xlsx') {
        await this.streamXlsx(res, rows(), columns, filename);
      } else {
        await this.streamCsv(res, rows(), columns, filename);
      }
    } catch (error) {
      // Headers are already out, so the status can't change: abort the connection so
      // the browser fails the download instead of saving a truncated file.
      res.destroy(error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /** Yields matching rows in id-stable pages until the set is exhausted or capped. */
  private async *batches(
    where: Prisma.LeadWhereInput,
    sort: LeadSortColumn,
    direction: 'asc' | 'desc',
  ): AsyncGenerator<LeadExportRow[]> {
    let skip = 0;
    while (skip < MAX_EXPORT_ROWS) {
      const rows = await this.prisma.lead.findMany({
        where,
        select: LEAD_EXPORT_SELECT,
        // id breaks ties so a row never repeats or vanishes across batches, the
        // same tie-break the paged list uses.
        orderBy: [{ [sort]: direction }, { id: 'asc' }],
        skip,
        take: BATCH_SIZE,
      });
      if (rows.length === 0) return;
      yield rows;
      if (rows.length < BATCH_SIZE) return;
      skip += BATCH_SIZE;
    }
  }

  private async streamCsv(
    res: Response,
    pages: AsyncIterable<LeadExportRow[]>,
    columns: ExportColumn[],
    filename: string,
  ): Promise<void> {
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // A BOM so Excel opens the UTF-8 content (Arabic names, "د.إ") without mojibake.
    res.write('﻿');
    res.write(
      columns.map((column) => csvCell(column.header)).join(',') + '\r\n',
    );

    for await (const rows of pages) {
      let chunk = '';
      for (const row of rows) {
        chunk +=
          columns.map((column) => csvCell(column.value(row))).join(',') +
          '\r\n';
      }
      res.write(chunk);
    }

    res.end();
  }

  private async streamXlsx(
    res: Response,
    pages: AsyncIterable<LeadExportRow[]>,
    columns: ExportColumn[],
    filename: string,
  ): Promise<void> {
    res
      .status(200)
      .setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: false,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet('Leads');
    sheet.addRow(columns.map((column) => column.header)).commit();

    for await (const rows of pages) {
      for (const row of rows) {
        sheet.addRow(columns.map((column) => column.value(row))).commit();
      }
    }

    // The streaming worksheet's commit is synchronous; only the workbook's
    // finalize (which writes the zip trailer and ends the response) is a Promise.
    sheet.commit();
    await workbook.commit();
  }
}

/** A timestamped, download-safe name: `leads-YYYYMMDD-HHmmss.<ext>`. */
function exportFilename(format: 'csv' | 'xlsx'): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `leads-${stamp}.${format}`;
}
