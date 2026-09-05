import { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, toSalesCrmGeneral } from './settings.service';
import {
  SALES_CRM_GENERAL_DEFAULTS,
  SALES_CRM_GENERAL_KEY,
  SalesCrmGeneralSettings,
  UpdateSalesCrmGeneralDto,
} from './dto/sales-crm-general.dto';
import {
  SALES_CRM_DUPLICATE_DEFAULTS,
  SALES_CRM_DUPLICATE_KEY,
  UpdateSalesCrmDuplicateDto,
} from './dto/sales-crm-duplicate.dto';
import {
  ORGANIZATION_GENERAL_DEFAULTS,
  ORGANIZATION_GENERAL_KEY,
  UpdateOrganizationGeneralDto,
  toMinutes,
} from './dto/organization-general.dto';

/**
 * Mocks held as locals so assertions never reference an unbound class method — the
 * pattern the view-preferences and leads specs use.
 */
function makeService() {
  const findUnique = jest.fn();
  const upsert = jest.fn().mockResolvedValue(undefined);
  const userFindUnique = jest.fn().mockResolvedValue({ name: 'Emarath Admin' });
  const prisma = {
    appSetting: { findUnique, upsert },
    user: { findUnique: userFindUnique },
  } as unknown as PrismaService;

  return {
    service: new SettingsService(prisma),
    findUnique,
    upsert,
    userFindUnique,
  };
}

/** The one upsert argument shape the assertions read back. */
interface UpsertCall {
  where: { key: string };
  create: { value: SalesCrmGeneralSettings };
}

const validDto = (): UpdateSalesCrmGeneralDto => ({
  ...SALES_CRM_GENERAL_DEFAULTS,
  maskingRole: null,
  fieldNames: { ...SALES_CRM_GENERAL_DEFAULTS.fieldNames },
});

describe('SettingsService', () => {
  describe('getSalesCrmGeneral', () => {
    it('returns the shipped defaults when nothing has been saved', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue(null);

      await expect(service.getSalesCrmGeneral()).resolves.toEqual(
        SALES_CRM_GENERAL_DEFAULTS,
      );
      expect(findUnique).toHaveBeenCalledWith({
        where: { key: SALES_CRM_GENERAL_KEY },
        select: { value: true },
      });
    });

    it('returns what was stored', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: { ...SALES_CRM_GENERAL_DEFAULTS, noActivityThreshold: 42 },
      });

      const result = await service.getSalesCrmGeneral();

      expect(result.noActivityThreshold).toBe(42);
    });
  });

  describe('saveSalesCrmGeneral', () => {
    it('upserts one row per key and returns what it stored', async () => {
      const { service, upsert } = makeService();
      const dto = { ...validDto(), noActivityThreshold: 6 };

      const result = await service.saveSalesCrmGeneral(dto);

      expect(result.noActivityThreshold).toBe(6);
      expect(upsert).toHaveBeenCalledTimes(1);
      const [call] = upsert.mock.calls[0] as [UpsertCall];
      expect(call.where.key).toBe(SALES_CRM_GENERAL_KEY);
      expect(call.create.value.noActivityThreshold).toBe(6);
    });

    it('trims the field labels', async () => {
      const { service } = makeService();
      const dto = validDto();
      dto.fieldNames.zipcode = '  Postal Code  ';

      const result = await service.saveSalesCrmGeneral(dto);

      expect(result.fieldNames.zipcode).toBe('Postal Code');
    });

    it('uppercases the country code', async () => {
      const { service } = makeService();

      const result = await service.saveSalesCrmGeneral({
        ...validDto(),
        defaultCountryCode: 'ae',
      });

      expect(result.defaultCountryCode).toBe('AE');
    });

    it('keeps the masking role while masking is off, so toggling does not lose it', async () => {
      const { service } = makeService();

      const result = await service.saveSalesCrmGeneral({
        ...validDto(),
        maskMobileNumbers: false,
        maskingRole: UserRole.SALES_MANAGER,
      });

      expect(result.maskingRole).toBe(UserRole.SALES_MANAGER);
    });

    it('stores no masking role when none was chosen', async () => {
      const { service } = makeService();

      const result = await service.saveSalesCrmGeneral({
        ...validDto(),
        maskingRole: undefined,
      });

      expect(result.maskingRole).toBeNull();
    });

    it('keeps the masking role while masking is on', async () => {
      const { service } = makeService();

      const result = await service.saveSalesCrmGeneral({
        ...validDto(),
        maskMobileNumbers: true,
        maskingRole: UserRole.SALES_MANAGER,
      });

      expect(result.maskingRole).toBe(UserRole.SALES_MANAGER);
    });
  });

  describe('toSalesCrmGeneral', () => {
    it('falls back to defaults for a row that is not an object', () => {
      expect(toSalesCrmGeneral(null)).toEqual(SALES_CRM_GENERAL_DEFAULTS);
      expect(toSalesCrmGeneral([])).toEqual(SALES_CRM_GENERAL_DEFAULTS);
      expect(toSalesCrmGeneral(undefined)).toEqual(SALES_CRM_GENERAL_DEFAULTS);
    });

    it('defaults only the unreadable fields, keeping the valid ones', () => {
      const result = toSalesCrmGeneral({
        orderBy: 'NOT_A_FIELD',
        noteDisplay: 'LEAD_PRIMARY_NOTE',
        requireCompanyName: 'yes',
        noActivityThreshold: 0,
      });

      expect(result.orderBy).toBe(SALES_CRM_GENERAL_DEFAULTS.orderBy);
      expect(result.noteDisplay).toBe('LEAD_PRIMARY_NOTE');
      expect(result.requireCompanyName).toBe(false);
      expect(result.noActivityThreshold).toBe(18);
    });

    it('defaults a blank label without unnaming the others', () => {
      const result = toSalesCrmGeneral({
        fieldNames: { city: '   ', state: 'Emirate' },
      });

      expect(result.fieldNames.city).toBe('City');
      expect(result.fieldNames.state).toBe('Emirate');
      expect(result.fieldNames.zipcode).toBe('Pincode');
    });

    it('rejects a mask-digit count outside the supported range', () => {
      expect(toSalesCrmGeneral({ maskDigits: 99 }).maskDigits).toBe(4);
      expect(toSalesCrmGeneral({ maskDigits: 6 }).maskDigits).toBe(6);
    });

    it('drops a masking role that is not a known user role', () => {
      expect(
        toSalesCrmGeneral({ maskingRole: 'PRESIDENT' }).maskingRole,
      ).toBeNull();
      expect(
        toSalesCrmGeneral({ maskingRole: UserRole.SALES_AGENT }).maskingRole,
      ).toBe(UserRole.SALES_AGENT);
    });
  });
});

describe('SettingsService — Duplicate Settings', () => {
  const dto = (over: Partial<UpdateSalesCrmDuplicateDto> = {}) => ({
    mode: SALES_CRM_DUPLICATE_DEFAULTS.mode,
    allowDuplicateSearch: SALES_CRM_DUPLICATE_DEFAULTS.allowDuplicateSearch,
    displayAssigneeInfo: SALES_CRM_DUPLICATE_DEFAULTS.displayAssigneeInfo,
    checkArchivedLeads: SALES_CRM_DUPLICATE_DEFAULTS.checkArchivedLeads,
    ...over,
  });

  const storedValue = (upsert: jest.Mock) =>
    (
      upsert.mock.calls[0] as [{ create: { value: Record<string, unknown> } }]
    )[0].create.value;

  it('returns the shipped defaults when nothing is stored', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.getSalesCrmDuplicate()).resolves.toEqual(
      SALES_CRM_DUPLICATE_DEFAULTS,
    );
  });

  it('falls back per field when a stored row is half-formed', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        mode: 'NONSENSE',
        allowDuplicateSearch: 'yes',
        checkArchivedLeads: true,
      },
    });

    const settings = await service.getSalesCrmDuplicate();

    expect(settings.mode).toBe('WARN_ALLOW_SAVE');
    expect(settings.allowDuplicateSearch).toBe(true);
    // The one valid field survives.
    expect(settings.checkArchivedLeads).toBe(true);
  });

  it('writes to its own key, leaving the general settings row alone', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue(null);

    await service.saveSalesCrmDuplicate(dto({ mode: 'BLOCK_HARD_STOP' }), 'u1');

    const [call] = upsert.mock.calls[0] as [{ where: { key: string } }];
    expect(call.where.key).toBe(SALES_CRM_DUPLICATE_KEY);
    expect(call.where.key).not.toBe(SALES_CRM_GENERAL_KEY);
  });

  it('keeps the block toggles while Warn is selected, so switching back restores them', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue(null);

    await service.saveSalesCrmDuplicate(
      dto({
        mode: 'WARN_ALLOW_SAVE',
        displayAssigneeInfo: true,
        checkArchivedLeads: true,
      }),
      'u1',
    );

    expect(storedValue(upsert)).toMatchObject({
      mode: 'WARN_ALLOW_SAVE',
      displayAssigneeInfo: true,
      checkArchivedLeads: true,
    });
  });

  it('logs a mode change with the author’s name', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue(null);

    await service.saveSalesCrmDuplicate(dto({ mode: 'BLOCK_HARD_STOP' }), 'u1');

    const log = storedValue(upsert).log as {
      byName: string;
      changes: string[];
    }[];
    expect(log).toHaveLength(1);
    expect(log[0].byName).toBe('Emarath Admin');
    expect(log[0].changes[0]).toContain('Warn, allow save');
    expect(log[0].changes[0]).toContain('Block, hard stop');
  });

  it('logs one line per toggle that actually changed', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue(null);

    await service.saveSalesCrmDuplicate(
      dto({ allowDuplicateSearch: false, checkArchivedLeads: true }),
      'u1',
    );

    const log = storedValue(upsert).log as { changes: string[] }[];
    expect(log[0].changes).toHaveLength(2);
  });

  it('records nothing — and looks up no user — when a save changes nothing', async () => {
    const { service, findUnique, upsert, userFindUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await service.saveSalesCrmDuplicate(dto(), 'u1');

    expect(storedValue(upsert).log).toEqual([]);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('keeps earlier entries, newest first', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue({
      value: {
        ...SALES_CRM_DUPLICATE_DEFAULTS,
        log: [
          {
            at: '2026-01-01T00:00:00.000Z',
            byName: 'Old',
            changes: ['earlier'],
          },
        ],
      },
    });

    await service.saveSalesCrmDuplicate(dto({ mode: 'BLOCK_HARD_STOP' }), 'u1');

    const log = storedValue(upsert).log as { changes: string[] }[];
    expect(log).toHaveLength(2);
    expect(log[1].changes).toEqual(['earlier']);
  });
});

describe('SettingsService — Organization General Settings', () => {
  const dto = (over: Partial<UpdateOrganizationGeneralDto> = {}) => ({
    ...ORGANIZATION_GENERAL_DEFAULTS,
    ...over,
  });

  const storedValue = (upsert: jest.Mock) =>
    (
      upsert.mock.calls[0] as [{ create: { value: Record<string, unknown> } }]
    )[0].create.value;

  it('returns the reference defaults when nothing is stored', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.getOrganizationGeneral()).resolves.toEqual(
      ORGANIZATION_GENERAL_DEFAULTS,
    );
  });

  it('writes to its own key, leaving the other settings rows alone', async () => {
    const { service, upsert } = makeService();

    await service.saveOrganizationGeneral(dto({ currency: 'INR' }));

    const [call] = upsert.mock.calls[0] as [{ where: { key: string } }];
    expect(call.where.key).toBe(ORGANIZATION_GENERAL_KEY);
    expect(call.where.key).not.toBe(SALES_CRM_GENERAL_KEY);
    expect(call.where.key).not.toBe(SALES_CRM_DUPLICATE_KEY);
  });

  it('stores off days in weekday order, whatever order they were picked in', async () => {
    const { service, upsert } = makeService();

    await service.saveOrganizationGeneral(
      dto({ offDays: ['Friday', 'Sunday', 'Wednesday'] }),
    );

    expect(storedValue(upsert).offDays).toEqual([
      'Sunday',
      'Wednesday',
      'Friday',
    ]);
  });

  it('falls back per field when a stored row is half-formed', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        currency: 'NOT_A_CURRENCY',
        dateDisplayFormat: 'nonsense',
        tablePaginationLimit: 37,
        shiftStartHour: 99,
        shiftStartPeriod: 'XX',
        offDays: ['Sunday', 'Blursday', 'Sunday'],
        productModuleEnabled: true,
      },
    });

    const settings = await service.getOrganizationGeneral();

    expect(settings.currency).toBe('AED');
    expect(settings.dateDisplayFormat).toBe('d-m-Y');
    expect(settings.tablePaginationLimit).toBe(100);
    expect(settings.shiftStartHour).toBe(10);
    expect(settings.shiftStartPeriod).toBe('AM');
    // Unknown names dropped, duplicates collapsed, week order restored.
    expect(settings.offDays).toEqual(['Sunday']);
    // The one valid field survives.
    expect(settings.productModuleEnabled).toBe(true);
  });

  it('keeps a real stored payload intact', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        ...ORGANIZATION_GENERAL_DEFAULTS,
        currency: 'INR',
        dateDisplayFormat: 'Y-m-d',
        tablePaginationLimit: 20,
        organizationalGrouping: true,
        shiftStartHour: 9,
        shiftStartMinute: 30,
        shiftEndHour: 6,
        offDays: ['Friday', 'Saturday'],
      },
    });

    await expect(service.getOrganizationGeneral()).resolves.toMatchObject({
      currency: 'INR',
      dateDisplayFormat: 'Y-m-d',
      tablePaginationLimit: 20,
      organizationalGrouping: true,
      shiftStartHour: 9,
      shiftStartMinute: 30,
      offDays: ['Friday', 'Saturday'],
    });
  });

  it('accepts an empty off-days list', async () => {
    const { service, upsert } = makeService();

    await service.saveOrganizationGeneral(dto({ offDays: [] }));

    expect(storedValue(upsert).offDays).toEqual([]);
  });
});

describe('toMinutes', () => {
  it('folds 12 AM to midnight and 12 PM to noon', () => {
    expect(toMinutes(12, 0, 'AM')).toBe(0);
    expect(toMinutes(12, 0, 'PM')).toBe(720);
  });

  it('places the reference shift correctly', () => {
    expect(toMinutes(10, 0, 'AM')).toBe(600);
    expect(toMinutes(7, 0, 'PM')).toBe(1140);
    expect(toMinutes(10, 0, 'AM')).toBeLessThan(toMinutes(7, 0, 'PM'));
  });
});
