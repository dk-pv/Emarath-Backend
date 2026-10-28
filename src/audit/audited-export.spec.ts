import 'reflect-metadata';
import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../generated/prisma/client';
import { LeadsExportController } from '../leads/export/leads-export.controller';
import { LogisticsOrdersController } from '../logistics/logistics-orders.controller';
import { ConvertedLeadsController } from '../reports/converted-leads.controller';
import { LeadAgingController } from '../reports/lead-aging.controller';
import { LeadFirstResponseController } from '../reports/lead-first-response.controller';
import { LeadsByOwnershipController } from '../reports/leads-by-ownership.controller';
import { LeadsBySourceController } from '../reports/leads-by-source.controller';
import { LeadsByStatusController } from '../reports/leads-by-status.controller';
import { LostLeadsController } from '../reports/lost-leads.controller';
import { OverdueFollowUpsController } from '../reports/overdue-follow-ups.controller';
import { ReportsController } from '../reports/reports.controller';
import { RevenueController } from '../reports/revenue.controller';
import { TodayLeadsController } from '../reports/today-leads.controller';
import { TodaysFollowUpsController } from '../reports/todays-follow-ups.controller';
import { UpcomingFollowUpsController } from '../reports/upcoming-follow-ups.controller';
import {
  AuditedExport,
  exportFilters,
  ExportAuditInterceptor,
} from './audited-export';

function makeInterceptor() {
  const createMany = jest.fn();
  const prisma = {
    auditEvent: { createMany },
  } as unknown as PrismaService;
  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: 'user-1', role: UserRole.SALES_MANAGER }),
  } as unknown as CurrentUserService;
  const interceptor = new ExportAuditInterceptor(
    new Reflector(),
    prisma,
    currentUser,
  );
  return { interceptor, createMany };
}

class Probe {
  @AuditedExport('reports.probe.export')
  export(this: void): void {}
}

function context(query: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => Probe.prototype.export,
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  } as unknown as ExecutionContext;
}

const handler = (result: unknown): CallHandler => ({
  handle: () => of(result),
});

describe('ExportAuditInterceptor (AUD-01)', () => {
  it('records a finished export — who, which, how many rows, which filters — once the file is out', async () => {
    const { interceptor, createMany } = makeInterceptor();

    const stream = await interceptor.intercept(
      context({ format: 'csv', status: ['New', 'Won'], search: '0501234567' }),
      handler(42),
    );
    await expect(lastValueFrom(stream)).resolves.toBe(42);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          entityType: 'EXPORT',
          leadId: null,
          action: 'EXPORTED',
          actorType: 'USER',
          actorId: 'user-1',
          source: 'reports.probe.export',
          metadata: {
            rows: 42,
            filters: { format: 'csv', status: ['New', 'Won'], search: true },
          },
        }),
      ],
    });
    // The search text — here a customer's phone number — is never stored.
    expect(JSON.stringify(createMany.mock.calls)).not.toContain('0501234567');
  });

  it('records nothing for an export that failed', async () => {
    const { interceptor, createMany } = makeInterceptor();

    const stream = await interceptor.intercept(context({}), {
      handle: () => throwError(() => new Error('query failed')),
    });

    await expect(lastValueFrom(stream)).rejects.toThrow('query failed');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('logs, and does not fail the finished download, when only the history write fails', async () => {
    const { interceptor, createMany } = makeInterceptor();
    createMany.mockRejectedValue(new Error('db down'));
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const stream = await interceptor.intercept(context({}), handler(3));

    await expect(lastValueFrom(stream)).resolves.toBe(3);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('EXPORTED'));
    logged.mockRestore();
  });
});

describe('exportFilters', () => {
  it('keeps the filters but replaces free text and field conditions with "used"', () => {
    expect(
      exportFilters({
        pipeline: 'Lead Pipeline',
        conditions: '[{"field":"primaryPhone","value":"0501234567"}]',
        search: 'Aisha',
        empty: undefined,
      }),
    ).toEqual({ pipeline: 'Lead Pipeline', conditions: true, search: true });
  });
});

describe('every export route is audited (AUD-01)', () => {
  const routes: [string, object][] = [
    ['leads.export', LeadsExportController.prototype],
    ['reports.converted-leads.export', ConvertedLeadsController.prototype],
    ['reports.lead-aging.export', LeadAgingController.prototype],
    [
      'reports.lead-first-response.export',
      LeadFirstResponseController.prototype,
    ],
    ['reports.leads-by-ownership.export', LeadsByOwnershipController.prototype],
    ['reports.leads-by-source.export', LeadsBySourceController.prototype],
    ['reports.leads-by-status.export', LeadsByStatusController.prototype],
    ['reports.lost-leads.export', LostLeadsController.prototype],
    ['reports.overdue-follow-ups.export', OverdueFollowUpsController.prototype],
    ['reports.no-activity.export', ReportsController.prototype],
    ['reports.today-leads.export', TodayLeadsController.prototype],
    ['reports.todays-follow-ups.export', TodaysFollowUpsController.prototype],
    [
      'reports.upcoming-follow-ups.export',
      UpcomingFollowUpsController.prototype,
    ],
    ['logistics.orders.export', LogisticsOrdersController.prototype],
    ['reports.revenue.export', RevenueController.prototype],
  ];

  it.each(routes)(
    '%s carries the interceptor and its source',
    (source, proto) => {
      const handlerFn = (proto as Record<string, unknown>)['export'];
      expect(
        new Reflector().get('audit:export-source', handlerFn as () => void),
      ).toBe(source);
      expect(
        Reflect.getMetadata(INTERCEPTORS_METADATA, handlerFn as object),
      ).toContain(ExportAuditInterceptor);
    },
  );
});
