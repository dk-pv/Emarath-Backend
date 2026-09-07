import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';
import {
  APPLICATION_DASHBOARD_DEFAULTS,
  APPLICATION_DASHBOARD_KEY,
  APPLICATION_GENERAL_DEFAULTS,
  APPLICATION_GENERAL_KEY,
  DashboardSettings,
  UpdateApplicationGeneralDto,
  UpdateDashboardSettingsDto,
  normaliseCards,
} from './dto/application-controls.dto';

/**
 * Its own mock rather than the shared `makeService`: these two screens are the first to
 * read the Stage and Lead Source catalogues, and widening the shared helper for them
 * would touch every other suite in that file.
 */
function makeService(
  stages: string[] = ['New', 'Warm', 'Converted'],
  sources: string[] = ['Facebook', 'Direct'],
) {
  const findUnique = jest.fn().mockResolvedValue(null);
  const upsert = jest.fn().mockResolvedValue(undefined);
  const stageFindMany = jest
    .fn()
    .mockResolvedValue(stages.map((name) => ({ name })));
  const leadSourceFindMany = jest
    .fn()
    .mockResolvedValue(sources.map((name) => ({ name })));

  const prisma = {
    appSetting: { findUnique, upsert },
    stage: { findMany: stageFindMany },
    leadSource: { findMany: leadSourceFindMany },
  } as unknown as PrismaService;

  return {
    service: new SettingsService(prisma),
    findUnique,
    upsert,
    stageFindMany,
    leadSourceFindMany,
  };
}

/** The upsert argument shape these assertions read back. */
interface UpsertCall {
  where: { key: string };
  create: { value: DashboardSettings };
}

const dashboardDto = (
  over: Partial<UpdateDashboardSettingsDto> = {},
): UpdateDashboardSettingsDto => ({
  summaryMode: 'LEAD_STAGE',
  displayOnCards: 'LEAD_COUNT',
  leadStage: [],
  leadSource: [],
  ...over,
});

describe('SettingsService — Application Controls', () => {
  describe('getApplicationGeneral', () => {
    it('returns the shipped defaults when nothing has been saved', async () => {
      const { service, findUnique } = makeService();

      await expect(service.getApplicationGeneral()).resolves.toEqual(
        APPLICATION_GENERAL_DEFAULTS,
      );
      expect(findUnique).toHaveBeenCalledWith({
        where: { key: APPLICATION_GENERAL_KEY },
        select: { value: true },
      });
    });

    it('falls back per field, so one unreadable value does not cost the screen', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: { autoSavePassword: true, disablePromptAfterCall: 'yes' },
      });

      await expect(service.getApplicationGeneral()).resolves.toEqual({
        autoSavePassword: true,
        disablePromptAfterCall: false,
        selfieVerificationOnLogin: false,
      });
    });
  });

  describe('saveApplicationGeneral', () => {
    it('stores exactly the three switches and returns them', async () => {
      const { service, upsert } = makeService();
      const dto: UpdateApplicationGeneralDto = {
        autoSavePassword: true,
        disablePromptAfterCall: false,
        selfieVerificationOnLogin: true,
      };

      await expect(service.saveApplicationGeneral(dto)).resolves.toEqual(dto);
      const call = upsert.mock.calls[0][0] as UpsertCall;
      expect(call.where.key).toBe(APPLICATION_GENERAL_KEY);
      expect(call.create.value).toEqual(dto);
    });
  });

  describe('getLoginPolicy', () => {
    it('exposes only the switch the login screen needs', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: {
          autoSavePassword: true,
          disablePromptAfterCall: true,
          selfieVerificationOnLogin: true,
        },
      });

      await expect(service.getLoginPolicy()).resolves.toEqual({
        autoSavePassword: true,
      });
    });
  });

  describe('getDashboardFields', () => {
    it('offers the stage catalogue and the active sources', async () => {
      const { service, leadSourceFindMany } = makeService();

      await expect(service.getDashboardFields()).resolves.toEqual({
        leadStage: [
          { fieldKey: 'New', label: 'New' },
          { fieldKey: 'Warm', label: 'Warm' },
          { fieldKey: 'Converted', label: 'Converted' },
        ],
        leadSource: [
          { fieldKey: 'Facebook', label: 'Facebook' },
          { fieldKey: 'Direct', label: 'Direct' },
        ],
      });
      // An inactive source stays on its leads but is not offered as a new card.
      expect(leadSourceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('offers one card per stage name, however many pipelines share it', async () => {
      const { service } = makeService(['New', 'New', 'Warm']);

      const catalogue = await service.getDashboardFields();
      expect(catalogue.leadStage.map((option) => option.fieldKey)).toEqual([
        'New',
        'Warm',
      ]);
    });
  });

  describe('getDashboardSettings', () => {
    it('returns Lead Stage / Lead Count the first time', async () => {
      const { service } = makeService();

      await expect(service.getDashboardSettings()).resolves.toEqual(
        APPLICATION_DASHBOARD_DEFAULTS,
      );
    });

    it('renumbers a stored list densely, whatever positions it carries', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: {
          summaryMode: 'LEAD_SOURCE',
          displayOnCards: 'BOTH',
          leadStage: [
            { fieldKey: 'Warm', position: 9 },
            { fieldKey: 'New', position: 2 },
          ],
          leadSource: [],
        },
      });

      await expect(service.getDashboardSettings()).resolves.toEqual({
        summaryMode: 'LEAD_SOURCE',
        displayOnCards: 'BOTH',
        leadStage: [
          { fieldKey: 'New', position: 1 },
          { fieldKey: 'Warm', position: 2 },
        ],
        leadSource: [],
      });
    });
  });

  describe('saveDashboardSettings', () => {
    it('writes both modes in one row, so neither can be lost by switching', async () => {
      const { service, upsert } = makeService();

      const stored = await service.saveDashboardSettings(
        dashboardDto({
          summaryMode: 'LEAD_SOURCE',
          leadStage: [
            { fieldKey: 'Warm', position: 1 },
            { fieldKey: 'Converted', position: 2 },
          ],
          leadSource: [{ fieldKey: 'Direct', position: 1 }],
        }),
      );

      expect(stored.leadStage).toEqual([
        { fieldKey: 'Warm', position: 1 },
        { fieldKey: 'Converted', position: 2 },
      ]);
      expect(stored.leadSource).toEqual([{ fieldKey: 'Direct', position: 1 }]);
      const call = upsert.mock.calls[0][0] as UpsertCall;
      expect(call.where.key).toBe(APPLICATION_DASHBOARD_KEY);
      expect(call.create.value).toEqual(stored);
    });

    it('normalises positions to a dense 1..n in the order given', async () => {
      const { service } = makeService();

      const stored = await service.saveDashboardSettings(
        dashboardDto({
          leadStage: [
            { fieldKey: 'Converted', position: 40 },
            { fieldKey: 'New', position: 41 },
          ],
        }),
      );

      expect(stored.leadStage).toEqual([
        { fieldKey: 'Converted', position: 1 },
        { fieldKey: 'New', position: 2 },
      ]);
    });

    it('rejects a key no catalogue offers rather than dropping the card', async () => {
      const { service, upsert } = makeService();

      await expect(
        service.saveDashboardSettings(
          dashboardDto({ leadStage: [{ fieldKey: 'Nonsense', position: 1 }] }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('rejects a stage key offered to the Lead Source list', async () => {
      const { service } = makeService();

      await expect(
        service.saveDashboardSettings(
          dashboardDto({ leadSource: [{ fieldKey: 'Warm', position: 1 }] }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects the same card selected twice', async () => {
      const { service } = makeService();

      await expect(
        service.saveDashboardSettings(
          dashboardDto({
            leadStage: [
              { fieldKey: 'Warm', position: 1 },
              { fieldKey: 'Warm', position: 2 },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('normaliseCards', () => {
    it('drops anything that is not a usable card', () => {
      expect(
        normaliseCards([
          { fieldKey: 'Warm', position: 3 },
          { fieldKey: '', position: 1 },
          { position: 2 },
          'nonsense',
          null,
        ]),
      ).toEqual([{ fieldKey: 'Warm', position: 1 }]);
    });

    it('keeps the first of a duplicated key', () => {
      expect(
        normaliseCards([
          { fieldKey: 'Warm', position: 1 },
          { fieldKey: 'Warm', position: 2 },
          { fieldKey: 'New', position: 3 },
        ]),
      ).toEqual([
        { fieldKey: 'Warm', position: 1 },
        { fieldKey: 'New', position: 2 },
      ]);
    });

    it('reads a non-array as no selection', () => {
      expect(normaliseCards(undefined)).toEqual([]);
      expect(normaliseCards({ fieldKey: 'Warm' })).toEqual([]);
    });
  });
});
