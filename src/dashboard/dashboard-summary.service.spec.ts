import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { DashboardSettings } from '../settings/dto/application-controls.dto';
import { DashboardSummaryService } from './dashboard-summary.service';

const ADMIN = {
  id: 'admin-1',
  role: UserRole.SUPERADMIN,
  email: 'admin@emarath.com',
};

const settings = (
  over: Partial<DashboardSettings> = {},
): DashboardSettings => ({
  summaryMode: 'LEAD_STAGE',
  displayOnCards: 'LEAD_COUNT',
  leadStage: [],
  leadSource: [],
  ...over,
});

function makeService(config: DashboardSettings, rows: unknown[] = []) {
  const groupBy = jest.fn().mockResolvedValue(rows);
  const prisma = { lead: { groupBy } } as unknown as PrismaService;
  const currentUser = {
    resolve: jest.fn().mockResolvedValue(ADMIN),
  } as unknown as CurrentUserService;
  const settingsService = {
    getDashboardSettings: jest.fn().mockResolvedValue(config),
  } as unknown as SettingsService;

  return {
    service: new DashboardSummaryService(prisma, currentUser, settingsService),
    groupBy,
  };
}

describe('DashboardSummaryService', () => {
  it('returns no cards, and asks the database nothing, when nothing is configured', async () => {
    const { service, groupBy } = makeService(settings());

    await expect(service.getSummary()).resolves.toEqual({
      summaryMode: 'LEAD_STAGE',
      displayOnCards: 'LEAD_COUNT',
      cards: [],
    });
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('returns the configured cards in the configured order', async () => {
    const { service } = makeService(
      settings({
        leadStage: [
          { fieldKey: 'Converted', position: 1 },
          { fieldKey: 'Warm', position: 2 },
        ],
      }),
      [
        { status: 'Warm', _count: 4, _sum: { actualAmount: null } },
        { status: 'Converted', _count: 2, _sum: { actualAmount: '900.00' } },
      ],
    );

    const summary = await service.getSummary();
    expect(summary.cards).toEqual([
      { fieldKey: 'Converted', label: 'Converted', count: 2, amount: '900.00' },
      { fieldKey: 'Warm', label: 'Warm', count: 4, amount: '0' },
    ]);
  });

  it('draws a configured card with no leads as a zero, not as nothing', async () => {
    const { service } = makeService(
      settings({ leadStage: [{ fieldKey: 'Warm', position: 1 }] }),
      [],
    );

    const summary = await service.getSummary();
    expect(summary.cards).toEqual([
      { fieldKey: 'Warm', label: 'Warm', count: 0, amount: '0' },
    ]);
  });

  it('groups by source in Lead Source mode, and only over the selected sources', async () => {
    const { service, groupBy } = makeService(
      settings({
        summaryMode: 'LEAD_SOURCE',
        leadSource: [{ fieldKey: 'Direct', position: 1 }],
      }),
      [{ source: 'Direct', _count: 7, _sum: { actualAmount: '10' } }],
    );

    const summary = await service.getSummary();
    expect(summary.summaryMode).toBe('LEAD_SOURCE');
    expect(summary.cards).toEqual([
      { fieldKey: 'Direct', label: 'Direct', count: 7, amount: '10' },
    ]);

    const call = groupBy.mock.calls[0][0] as {
      by: string[];
      where: { AND: unknown[] };
    };
    expect(call.by).toEqual(['source']);
    expect(call.where.AND).toContainEqual({ source: { in: ['Direct'] } });
  });

  it('ignores a null source row, which no configured card can name', async () => {
    const { service } = makeService(
      settings({
        summaryMode: 'LEAD_SOURCE',
        leadSource: [{ fieldKey: 'Direct', position: 1 }],
      }),
      [
        { source: null, _count: 3, _sum: { actualAmount: '5' } },
        { source: 'Direct', _count: 1, _sum: { actualAmount: '5' } },
      ],
    );

    const summary = await service.getSummary();
    expect(summary.cards).toEqual([
      { fieldKey: 'Direct', label: 'Direct', count: 1, amount: '5' },
    ]);
  });

  it('scopes the count, so a card can never total a lead the caller cannot see', async () => {
    const { service, groupBy } = makeService(
      settings({ leadStage: [{ fieldKey: 'Warm', position: 1 }] }),
      [],
    );

    await service.getSummary();
    const call = groupBy.mock.calls[0][0] as { where: { AND: unknown[] } };
    // `leadScopeWhere` always contributes the soft-delete predicate; an agent's own
    // scope fragment rides in the same clause.
    expect(call.where.AND[0]).toEqual(
      expect.objectContaining({ deletedAt: null }),
    );
  });
});
