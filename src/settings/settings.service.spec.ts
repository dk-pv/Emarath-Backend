import { CallOutcome, UserRole } from '../generated/prisma/client';
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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ORGANIZATION_COMPANY_DEFAULTS,
  ORGANIZATION_COMPANY_KEY,
  UpdateOrganizationCompanyDto,
} from './dto/organization-company.dto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateHostDomainDto,
  MAX_HOST_DOMAINS,
  ORGANIZATION_HOST_MAPPING_KEY,
} from './dto/organization-host-mapping.dto';
import { COMMUNICATION_ALERTS_KEY } from './dto/communication-alerts.dto';
import {
  ASSIGNMENT_GENERAL_DEFAULTS,
  ASSIGNMENT_GENERAL_KEY,
  UpdateAssignmentGeneralDto,
} from './dto/assignment-general.dto';
import {
  CALL_STATUS_DEFAULTS,
  CALL_TRACKING_GENERAL_DEFAULTS,
  CALL_TRACKING_GENERAL_KEY,
  CALL_TRACKING_STATUSES_KEY,
  UpdateCallStatusDto,
  UpdateCallTrackingGeneralDto,
} from './dto/call-tracking.dto';
import {
  ACTIVITY_FOLLOW_UP_TYPES_KEY,
  ACTIVITY_GENERAL_DEFAULTS,
  ACTIVITY_GENERAL_KEY,
  FollowUpType,
  MAX_FOLLOW_UP_TYPES,
  SaveFollowUpTypeDto,
  UpdateActivityGeneralDto,
} from './dto/activity-reminders.dto';

/**
 * Mocks held as locals so assertions never reference an unbound class method — the
 * pattern the view-preferences and leads specs use.
 */
function makeService() {
  const findUnique = jest.fn();
  const upsert = jest.fn().mockResolvedValue(undefined);
  const userFindUnique = jest.fn().mockResolvedValue({ name: 'Emarath Admin' });
  // Follow Up Types refuse to delete a type live follow-ups are filed under.
  const activityCount = jest.fn().mockResolvedValue(0);
  const prisma = {
    appSetting: { findUnique, upsert },
    user: { findUnique: userFindUnique },
    activity: { count: activityCount },
  } as unknown as PrismaService;

  return {
    service: new SettingsService(prisma),
    findUnique,
    upsert,
    userFindUnique,
    activityCount,
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

/**
 * The reference tenant's own values (`ui-reference` Company Details), used as one
 * realistic payload rather than invented data.
 */
const REFERENCE_COMPANY = {
  companyName: 'Emarath',
  address: 'Billing Address:',
  street:
    'EMARATH GLOBAL PRIVATE LIMITED Office number 1101, 1th Floor,T1, HiLIT',
  city: 'EMARATH',
  state: 'EMARATH',
  country: 'United Arab Emirates',
  zipCode: '11',
  telephoneCountry: 'IN',
  telephone: '918157897198',
  email: 'hr@emarathglobal.com',
  website: '',
  latitude: 11.2477892,
  longitude: 75.8340558,
};

describe('SettingsService — Organization Company Details', () => {
  const dto = (
    over: Partial<UpdateOrganizationCompanyDto> = {},
  ): UpdateOrganizationCompanyDto => ({ ...REFERENCE_COMPANY, ...over });

  const storedValue = (upsert: jest.Mock) =>
    (
      upsert.mock.calls[0] as [{ create: { value: Record<string, unknown> } }]
    )[0].create.value;

  it('returns a blank record when nothing is stored', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.getOrganizationCompany()).resolves.toEqual(
      ORGANIZATION_COMPANY_DEFAULTS,
    );
  });

  it('writes to its own key, leaving the other settings rows alone', async () => {
    const { service, upsert } = makeService();

    await service.saveOrganizationCompany(dto());

    const [call] = upsert.mock.calls[0] as [{ where: { key: string } }];
    expect(call.where.key).toBe(ORGANIZATION_COMPANY_KEY);
    expect(call.where.key).not.toBe(ORGANIZATION_GENERAL_KEY);
    expect(call.where.key).not.toBe(SALES_CRM_GENERAL_KEY);
    expect(call.where.key).not.toBe(SALES_CRM_DUPLICATE_KEY);
  });

  it('stores every field the form holds', async () => {
    const { service, upsert } = makeService();

    await expect(service.saveOrganizationCompany(dto())).resolves.toEqual(
      REFERENCE_COMPANY,
    );
    expect(storedValue(upsert)).toEqual(REFERENCE_COMPANY);
  });

  it('keeps the address, street, city and state separate', async () => {
    const { service, upsert } = makeService();

    await service.saveOrganizationCompany(dto());

    const stored = storedValue(upsert);
    expect(stored.address).toBe('Billing Address:');
    expect(stored.street).toContain('Office number 1101');
    expect(stored.city).toBe('EMARATH');
    expect(stored.state).toBe('EMARATH');
  });

  it('falls back per field when a stored row is half-formed', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        companyName: 'Emarath',
        address: 42,
        telephoneCountry: 'india',
        telephone: '+91 815 789',
        latitude: 'eleven',
        longitude: 999,
      },
    });

    const settings = await service.getOrganizationCompany();

    // The one valid field survives; everything unusable falls back on its own.
    expect(settings.companyName).toBe('Emarath');
    expect(settings.address).toBe('');
    expect(settings.telephoneCountry).toBe('AE');
    expect(settings.telephone).toBe('');
    expect(settings.latitude).toBeNull();
    expect(settings.longitude).toBeNull();
  });

  it('keeps a real stored payload intact', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ value: REFERENCE_COMPANY });

    await expect(service.getOrganizationCompany()).resolves.toEqual(
      REFERENCE_COMPANY,
    );
  });
});

describe('UpdateOrganizationCompanyDto validation', () => {
  const messages = async (
    over: Record<string, unknown> = {},
  ): Promise<string[]> => {
    const dto = plainToInstance(UpdateOrganizationCompanyDto, {
      ...REFERENCE_COMPANY,
      ...over,
    });
    const errors = await validate(dto);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts the reference values', async () => {
    expect(await messages()).toEqual([]);
  });

  it('requires a company name, whitespace not counting as one', async () => {
    expect((await messages({ companyName: '' })).length).toBeGreaterThan(0);
    expect((await messages({ companyName: '   ' })).length).toBeGreaterThan(0);
  });

  it('trims surrounding whitespace off the text fields', () => {
    const dto = plainToInstance(UpdateOrganizationCompanyDto, {
      ...REFERENCE_COMPANY,
      companyName: '  Emarath  ',
      zipCode: ' 11 ',
      telephoneCountry: ' in ',
    });
    expect(dto.companyName).toBe('Emarath');
    expect(dto.zipCode).toBe('11');
    // Uppercased too, so the stored code matches the country dataset's ISO2 keys.
    expect(dto.telephoneCountry).toBe('IN');
  });

  it('allows a blank email and website, but checks either once entered', async () => {
    expect(await messages({ email: '', website: '' })).toEqual([]);
    expect((await messages({ email: 'not-an-email' })).length).toBeGreaterThan(
      0,
    );
    expect(
      (await messages({ website: 'not a website' })).length,
    ).toBeGreaterThan(0);
    expect(await messages({ website: 'https://emarathglobal.com' })).toEqual(
      [],
    );
    expect(await messages({ website: 'www.emarathglobal.com' })).toEqual([]);
  });

  it('rejects a website that is a script URL', async () => {
    expect(
      (await messages({ website: 'javascript:alert(1)' })).length,
    ).toBeGreaterThan(0);
  });

  it('bounds latitude to 90 and longitude to 180, and accepts neither', async () => {
    expect(await messages({ latitude: null, longitude: null })).toEqual([]);
    expect((await messages({ latitude: 91 })).length).toBeGreaterThan(0);
    expect((await messages({ latitude: -91 })).length).toBeGreaterThan(0);
    expect((await messages({ longitude: 181 })).length).toBeGreaterThan(0);
    expect((await messages({ longitude: -181 })).length).toBeGreaterThan(0);
    expect((await messages({ latitude: 'eleven' })).length).toBeGreaterThan(0);
    expect(await messages({ latitude: -89.5, longitude: 179.5 })).toEqual([]);
  });

  it('rejects a telephone carrying anything but digits', async () => {
    expect(
      (await messages({ telephone: '+91 8157897198' })).length,
    ).toBeGreaterThan(0);
    expect(await messages({ telephone: '' })).toEqual([]);
  });

  it('rejects a telephone country that is not a two-letter code', async () => {
    expect(
      (await messages({ telephoneCountry: 'IND' })).length,
    ).toBeGreaterThan(0);
    expect((await messages({ telephoneCountry: '' })).length).toBeGreaterThan(
      0,
    );
  });
});

describe('SettingsService — Organization Host Mapping', () => {
  const dto = (
    over: Partial<CreateHostDomainDto> = {},
  ): CreateHostDomainDto => ({
    domainName: 'emarathglobal.com',
    fromEmailAddress: 'hr@emarathglobal.com',
    fromEmailName: 'Emarath HR',
    ...over,
  });

  const storedDomains = (upsert: jest.Mock) =>
    (
      upsert.mock.calls[0] as [
        { create: { value: { domains: Record<string, unknown>[] } } },
      ]
    )[0].create.value.domains;

  it('returns an empty list when nothing is stored', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.getOrganizationHostMapping()).resolves.toEqual({
      domains: [],
    });
  });

  it('writes to its own key, leaving the other settings rows alone', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue(null);

    await service.addHostDomain(dto());

    const [call] = upsert.mock.calls[0] as [{ where: { key: string } }];
    expect(call.where.key).toBe(ORGANIZATION_HOST_MAPPING_KEY);
    expect(call.where.key).not.toBe(ORGANIZATION_COMPANY_KEY);
    expect(call.where.key).not.toBe(ORGANIZATION_GENERAL_KEY);
  });

  it('stamps a new domain with an id and a creation time', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue(null);

    const mapping = await service.addHostDomain(dto());

    expect(mapping.domains).toHaveLength(1);
    const [domain] = mapping.domains;
    expect(domain.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(domain.createdAt))).toBe(false);
    expect(domain.domainName).toBe('emarathglobal.com');
    expect(storedDomains(upsert)).toHaveLength(1);
  });

  it('appends rather than replacing, so the list is a list', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        domains: [
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000001',
            domainName: 'first.com',
            fromEmailAddress: '',
            fromEmailName: '',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    const mapping = await service.addHostDomain(
      dto({ domainName: 'second.com' }),
    );

    expect(mapping.domains.map((d) => d.domainName)).toEqual([
      'first.com',
      'second.com',
    ]);
  });

  it('refuses a domain that is already mapped', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        domains: [
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000001',
            domainName: 'emarathglobal.com',
            fromEmailAddress: '',
            fromEmailName: '',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    await expect(service.addHostDomain(dto())).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses to grow the row past its ceiling', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        domains: Array.from({ length: MAX_HOST_DOMAINS }, (_, index) => ({
          id: `a1b2c3d4-0000-4000-8000-${String(index).padStart(12, '0')}`,
          domainName: `domain${index}.com`,
          fromEmailAddress: '',
          fromEmailName: '',
          createdAt: new Date().toISOString(),
        })),
      },
    });

    await expect(service.addHostDomain(dto())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('removes one domain and leaves the rest', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue({
      value: {
        domains: [
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000001',
            domainName: 'first.com',
            fromEmailAddress: '',
            fromEmailName: '',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000002',
            domainName: 'second.com',
            fromEmailAddress: '',
            fromEmailName: '',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    const mapping = await service.deleteHostDomain(
      'a1b2c3d4-0000-4000-8000-000000000001',
    );

    expect(mapping.domains.map((d) => d.domainName)).toEqual(['second.com']);
    expect(storedDomains(upsert)).toHaveLength(1);
  });

  it('reports an unknown id rather than quietly doing nothing', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue({ value: { domains: [] } });

    await expect(
      service.deleteHostDomain('a1b2c3d4-0000-4000-8000-00000000dead'),
    ).rejects.toThrow(NotFoundException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('drops unusable entries from a hand-edited row, keeping the good ones', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        domains: [
          'not an object',
          { domainName: 'no-id.com' },
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000001',
            domainName: 'not a domain',
          },
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000002',
            domainName: 'GOOD.com',
            fromEmailAddress: 'hr@good.com',
            fromEmailName: 'Good',
            createdAt: 'nonsense',
          },
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000003',
            domainName: 'good.com',
            fromEmailAddress: '',
            fromEmailName: '',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });

    const { domains } = await service.getOrganizationHostMapping();

    // One survivor: lowercased, its unparseable date replaced, its duplicate dropped.
    expect(domains).toHaveLength(1);
    expect(domains[0].domainName).toBe('good.com');
    expect(Number.isNaN(Date.parse(domains[0].createdAt))).toBe(false);
  });

  it('reads a row that is not a list at all as an empty list', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ value: { domains: 'nope' } });

    await expect(service.getOrganizationHostMapping()).resolves.toEqual({
      domains: [],
    });
  });
});

describe('CreateHostDomainDto validation', () => {
  const messages = async (
    over: Record<string, unknown> = {},
  ): Promise<string[]> => {
    const dto = plainToInstance(CreateHostDomainDto, {
      domainName: 'emarathglobal.com',
      fromEmailAddress: 'hr@emarathglobal.com',
      fromEmailName: 'Emarath HR',
      ...over,
    });
    const errors = await validate(dto);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts the three fields the form collects', async () => {
    expect(await messages()).toEqual([]);
  });

  it('requires a domain name', async () => {
    expect((await messages({ domainName: '' })).length).toBeGreaterThan(0);
    expect((await messages({ domainName: '   ' })).length).toBeGreaterThan(0);
  });

  it('rejects something that is not a domain', async () => {
    for (const bad of [
      'emarathglobal',
      'http://emarathglobal.com',
      'emarath global.com',
      '-emarath.com',
      'emarath-.com',
      'emarath@global.com',
    ]) {
      expect((await messages({ domainName: bad })).length).toBeGreaterThan(0);
    }
  });

  it('accepts a subdomain and a multi-part suffix', async () => {
    expect(await messages({ domainName: 'mail.emarathglobal.co.uk' })).toEqual(
      [],
    );
  });

  it('lowercases and trims the domain name', () => {
    const dto = plainToInstance(CreateHostDomainDto, {
      domainName: '  EmarathGlobal.COM  ',
      fromEmailAddress: '  hr@emarathglobal.com ',
      fromEmailName: '  Emarath HR  ',
    });
    expect(dto.domainName).toBe('emarathglobal.com');
    expect(dto.fromEmailAddress).toBe('hr@emarathglobal.com');
    expect(dto.fromEmailName).toBe('Emarath HR');
  });

  it('allows the email fields to be blank, but checks the address once entered', async () => {
    expect(await messages({ fromEmailAddress: '', fromEmailName: '' })).toEqual(
      [],
    );
    expect(
      (await messages({ fromEmailAddress: 'not-an-email' })).length,
    ).toBeGreaterThan(0);
  });

  it('bounds the field lengths', async () => {
    expect(
      (await messages({ fromEmailName: 'x'.repeat(121) })).length,
    ).toBeGreaterThan(0);
  });
});

describe('SettingsService — Communication → Emarath Alerts', () => {
  const storedValue = (upsert: jest.Mock) =>
    (
      upsert.mock.calls[0] as [{ create: { value: Record<string, unknown> } }]
    )[0].create.value;

  it('is off when nothing is stored, as the reference draws it', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.getCommunicationAlerts()).resolves.toEqual({
      alertsEnabled: false,
    });
  });

  it('writes to its own key, leaving the other settings rows alone', async () => {
    const { service, upsert } = makeService();

    await service.saveCommunicationAlerts({ alertsEnabled: true });

    const [call] = upsert.mock.calls[0] as [{ where: { key: string } }];
    expect(call.where.key).toBe(COMMUNICATION_ALERTS_KEY);
    expect(call.where.key).not.toBe(ORGANIZATION_GENERAL_KEY);
    expect(call.where.key).not.toBe(SALES_CRM_GENERAL_KEY);
  });

  it('round-trips the switch', async () => {
    const { service, upsert } = makeService();

    await expect(
      service.saveCommunicationAlerts({ alertsEnabled: true }),
    ).resolves.toEqual({ alertsEnabled: true });
    expect(storedValue(upsert)).toEqual({ alertsEnabled: true });
  });

  it('falls back to off when the stored value is not a boolean', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ value: { alertsEnabled: 'yes' } });

    await expect(service.getCommunicationAlerts()).resolves.toEqual({
      alertsEnabled: false,
    });
  });

  it('keeps a real stored value', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ value: { alertsEnabled: true } });

    await expect(service.getCommunicationAlerts()).resolves.toEqual({
      alertsEnabled: true,
    });
  });
});

describe('SettingsService — Assignment → General Settings', () => {
  const dto = (
    over: Partial<UpdateAssignmentGeneralDto> = {},
  ): UpdateAssignmentGeneralDto => ({
    ...ASSIGNMENT_GENERAL_DEFAULTS,
    ...over,
  });

  const storedValue = (upsert: jest.Mock) =>
    (
      upsert.mock.calls[0] as [{ create: { value: Record<string, unknown> } }]
    )[0].create.value;

  it('returns the reference defaults when nothing is stored', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.getAssignmentGeneral()).resolves.toEqual(
      ASSIGNMENT_GENERAL_DEFAULTS,
    );
  });

  it('opens with automatic assigning on, everything else off', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    const settings = await service.getAssignmentGeneral();
    expect(settings.automaticLeadAssigning).toBe(true);
    expect(settings.carryoverLeads).toBe(false);
    expect(settings.leadAssignmentLimitEnabled).toBe(false);
    expect(settings.whatsappRoundRobin).toBe(false);
    expect(settings.saveFirstIncomingMessageAsNote).toBe(false);
  });

  it('writes to its own key, leaving the other settings rows alone', async () => {
    const { service, upsert } = makeService();

    await service.saveAssignmentGeneral(dto());

    const [call] = upsert.mock.calls[0] as [{ where: { key: string } }];
    expect(call.where.key).toBe(ASSIGNMENT_GENERAL_KEY);
    expect(call.where.key).not.toBe(ORGANIZATION_GENERAL_KEY);
    expect(call.where.key).not.toBe(COMMUNICATION_ALERTS_KEY);
  });

  it('round-trips every field the screen holds', async () => {
    const { service, upsert } = makeService();

    const saved = await service.saveAssignmentGeneral(
      dto({
        carryoverLeads: true,
        includeFollowUpLeadsInCarryover: true,
        checkUserLoggedInBeforeAssigning: true,
        recheckHour: 9,
        recheckMinute: 30,
        recheckPeriod: 'PM',
        leadAssignmentLimitEnabled: true,
        dailyLeadLimit: 25,
        whatsappRoundRobin: true,
        saveFirstIncomingMessageAsNote: true,
      }),
    );

    expect(saved).toMatchObject({
      carryoverLeads: true,
      recheckHour: 9,
      recheckMinute: 30,
      recheckPeriod: 'PM',
      dailyLeadLimit: 25,
      whatsappRoundRobin: true,
    });
    expect(storedValue(upsert)).toEqual(saved);
  });

  it('keeps a cleared re-check time cleared rather than defaulting it back', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        ...ASSIGNMENT_GENERAL_DEFAULTS,
        recheckHour: null,
        recheckMinute: null,
        recheckPeriod: null,
      },
    });

    const settings = await service.getAssignmentGeneral();
    expect(settings.recheckHour).toBeNull();
    expect(settings.recheckMinute).toBeNull();
    expect(settings.recheckPeriod).toBeNull();
  });

  it('keeps the dependent values while their parent toggle is off', async () => {
    const { service, upsert } = makeService();

    await service.saveAssignmentGeneral(
      dto({
        carryoverLeads: false,
        recheckHour: 7,
        leadAssignmentLimitEnabled: false,
        dailyLeadLimit: 40,
      }),
    );

    const stored = storedValue(upsert);
    expect(stored.recheckHour).toBe(7);
    expect(stored.dailyLeadLimit).toBe(40);
  });

  it('falls back per field when a stored row is half-formed', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        automaticLeadAssigning: 'yes',
        recheckHour: 99,
        recheckPeriod: 'XX',
        leadLimitMethod: 'PER_USER',
        dailyLeadLimit: -5,
        whatsappRoundRobin: true,
      },
    });

    const settings = await service.getAssignmentGeneral();
    expect(settings.automaticLeadAssigning).toBe(true);
    expect(settings.recheckHour).toBe(12);
    expect(settings.recheckPeriod).toBe('AM');
    expect(settings.leadLimitMethod).toBe('GLOBAL');
    expect(settings.dailyLeadLimit).toBeNull();
    // The one valid field survives.
    expect(settings.whatsappRoundRobin).toBe(true);
  });
});

describe('UpdateAssignmentGeneralDto validation', () => {
  const messages = async (
    over: Record<string, unknown> = {},
  ): Promise<string[]> => {
    const instance = plainToInstance(UpdateAssignmentGeneralDto, {
      ...ASSIGNMENT_GENERAL_DEFAULTS,
      ...over,
    });
    const errors = await validate(instance);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts the reference defaults', async () => {
    expect(await messages()).toEqual([]);
  });

  it('requires a daily limit above zero once the limit is switched on', async () => {
    for (const bad of [null, 0, -1, 1.5]) {
      const errors = await messages({
        leadAssignmentLimitEnabled: true,
        dailyLeadLimit: bad,
      });
      expect(errors.join(' ')).toContain(
        'Daily lead limit must be greater than 0.',
      );
    }
    expect(
      await messages({ leadAssignmentLimitEnabled: true, dailyLeadLimit: 1 }),
    ).toEqual([]);
  });

  it('ignores the daily limit while the limit is switched off', async () => {
    expect(
      await messages({
        leadAssignmentLimitEnabled: false,
        dailyLeadLimit: null,
      }),
    ).toEqual([]);
  });

  it('accepts a cleared re-check time but bounds a set one', async () => {
    expect(
      await messages({
        recheckHour: null,
        recheckMinute: null,
        recheckPeriod: null,
      }),
    ).toEqual([]);
    expect((await messages({ recheckHour: 0 })).length).toBeGreaterThan(0);
    expect((await messages({ recheckHour: 13 })).length).toBeGreaterThan(0);
    expect((await messages({ recheckMinute: 60 })).length).toBeGreaterThan(0);
    expect((await messages({ recheckPeriod: 'XM' })).length).toBeGreaterThan(0);
  });

  it('accepts only the limit method the reference offers', async () => {
    expect(
      (await messages({ leadLimitMethod: 'PER_USER' })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects a non-boolean toggle', async () => {
    expect(
      (await messages({ automaticLeadAssigning: 'yes' })).length,
    ).toBeGreaterThan(0);
  });
});

describe('SettingsService — Call Tracking → General Settings', () => {
  const dto = (
    over: Partial<UpdateCallTrackingGeneralDto> = {},
  ): UpdateCallTrackingGeneralDto => ({
    ...CALL_TRACKING_GENERAL_DEFAULTS,
    ...over,
  });

  const storedValue = (upsert: jest.Mock) =>
    (
      upsert.mock.calls[0] as [{ create: { value: Record<string, unknown> } }]
    )[0].create.value;

  it('returns the reference defaults when nothing is stored', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    await expect(service.getCallTrackingGeneral()).resolves.toEqual({
      outgoingCallType: 'EMARATH',
      incomingCallType: 'EMARATH',
      callProviderMode: 'UNIQUE_CALLS',
    });
  });

  it('writes to its own key, leaving the other settings rows alone', async () => {
    const { service, upsert } = makeService();

    await service.saveCallTrackingGeneral(dto());

    const [call] = upsert.mock.calls[0] as [{ where: { key: string } }];
    expect(call.where.key).toBe(CALL_TRACKING_GENERAL_KEY);
    expect(call.where.key).not.toBe(CALL_TRACKING_STATUSES_KEY);
    expect(call.where.key).not.toBe(ASSIGNMENT_GENERAL_KEY);
  });

  it('round-trips the provider mode', async () => {
    const { service, upsert } = makeService();

    await expect(
      service.saveCallTrackingGeneral(dto({ callProviderMode: 'TOTAL_CALLS' })),
    ).resolves.toMatchObject({ callProviderMode: 'TOTAL_CALLS' });
    expect(storedValue(upsert).callProviderMode).toBe('TOTAL_CALLS');
  });

  it('keeps a cleared control cleared rather than defaulting it back', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        outgoingCallType: null,
        incomingCallType: null,
        callProviderMode: null,
      },
    });

    await expect(service.getCallTrackingGeneral()).resolves.toEqual({
      outgoingCallType: null,
      incomingCallType: null,
      callProviderMode: null,
    });
  });

  it('falls back per field when a stored row is half-formed', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: {
        outgoingCallType: 'ASTERISK',
        callProviderMode: 'AVERAGE_CALLS',
      },
    });

    const settings = await service.getCallTrackingGeneral();
    expect(settings.outgoingCallType).toBe('EMARATH');
    expect(settings.incomingCallType).toBe('EMARATH');
    expect(settings.callProviderMode).toBe('UNIQUE_CALLS');
  });

  it('treats the two call types as independent settings', async () => {
    const { service, upsert } = makeService();

    await service.saveCallTrackingGeneral(
      dto({ outgoingCallType: 'EMARATH', incomingCallType: null }),
    );

    const stored = storedValue(upsert);
    expect(stored.outgoingCallType).toBe('EMARATH');
    expect(stored.incomingCallType).toBeNull();
  });
});

describe('SettingsService — Call Tracking → Call Status', () => {
  it('lists the reference’s six statuses, in its order, when nothing is stored', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    const statuses = await service.getCallStatuses();

    expect(statuses.map((s) => s.defaultName)).toEqual([
      'ANSWERED',
      'BUSY',
      'NO ANSWER',
      'CONGESTION',
      'CHAN UN AVAIL',
      'CANCEL',
    ]);
  });

  it('starts every custom name equal to its default', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);

    const statuses = await service.getCallStatuses();
    expect(statuses.every((s) => s.customName === s.defaultName)).toBe(true);
  });

  it('renames only the custom half, never the provider status', async () => {
    const { service, findUnique, upsert } = makeService();
    findUnique.mockResolvedValue(null);

    const statuses = await service.saveCallStatus('ANSWERED', {
      customName: 'Connected',
    });

    const answered = statuses.find((s) => s.providerStatus === 'ANSWERED');
    expect(answered).toEqual({
      providerStatus: 'ANSWERED',
      defaultName: 'ANSWERED',
      customName: 'Connected',
    });
    // Every other row is untouched.
    expect(statuses.filter((s) => s.providerStatus !== 'ANSWERED')).toEqual(
      CALL_STATUS_DEFAULTS.filter((s) => s.providerStatus !== 'ANSWERED'),
    );

    const [call] = upsert.mock.calls[0] as [{ where: { key: string } }];
    expect(call.where.key).toBe(CALL_TRACKING_STATUSES_KEY);
  });

  it('refuses a provider status that is not one of the six', async () => {
    const { service, upsert } = makeService();

    await expect(
      service.saveCallStatus('VOICEMAIL', { customName: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps a stored custom name across reads', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: [
        {
          providerStatus: 'BUSY',
          defaultName: 'BUSY',
          customName: 'Engaged',
        },
      ],
    });

    const statuses = await service.getCallStatuses();
    expect(statuses.find((s) => s.providerStatus === 'BUSY')?.customName).toBe(
      'Engaged',
    );
    // The five the row does not mention still come back, on their defaults.
    expect(statuses).toHaveLength(6);
    expect(
      statuses.find((s) => s.providerStatus === 'CANCEL')?.customName,
    ).toBe('CANCEL');
  });

  it('drops unusable stored entries without losing the table', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: [
        'not an object',
        { providerStatus: 'VOICEMAIL', customName: 'Invented' },
        { providerStatus: 'BUSY', customName: '   ' },
        { providerStatus: 'CANCEL', customName: 'x'.repeat(61) },
        { providerStatus: 'ANSWERED', customName: 'Connected' },
      ],
    });

    const statuses = await service.getCallStatuses();
    expect(statuses).toHaveLength(6);
    expect(statuses.map((s) => s.providerStatus)).not.toContain('VOICEMAIL');
    expect(statuses.find((s) => s.providerStatus === 'BUSY')?.customName).toBe(
      'BUSY',
    );
    expect(
      statuses.find((s) => s.providerStatus === 'CANCEL')?.customName,
    ).toBe('CANCEL');
    // The one valid entry survives.
    expect(
      statuses.find((s) => s.providerStatus === 'ANSWERED')?.customName,
    ).toBe('Connected');
  });

  it('reads a row that is not a list at all as the untouched defaults', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({ value: { ANSWERED: 'Connected' } });

    await expect(service.getCallStatuses()).resolves.toEqual(
      CALL_STATUS_DEFAULTS,
    );
  });

  it('keeps the three provider statuses the call aggregation reads', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      value: [
        { providerStatus: 'ANSWERED', customName: 'Connected' },
        { providerStatus: 'NO_ANSWER', customName: 'Unreachable' },
        { providerStatus: 'BUSY', customName: 'Engaged' },
      ],
    });

    const statuses = await service.getCallStatuses();

    // Renaming the label must never rename the key the Call model stores: the dashboard
    // aggregates on CallOutcome, and these three are the values it knows.
    for (const outcome of Object.values(CallOutcome)) {
      expect(statuses.map((s) => s.providerStatus)).toContain(outcome);
    }
  });
});

describe('UpdateCallTrackingGeneralDto validation', () => {
  const messages = async (
    over: Record<string, unknown> = {},
  ): Promise<string[]> => {
    const instance = plainToInstance(UpdateCallTrackingGeneralDto, {
      ...CALL_TRACKING_GENERAL_DEFAULTS,
      ...over,
    });
    const errors = await validate(instance);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts the reference values', async () => {
    expect(await messages()).toEqual([]);
  });

  it('accepts a cleared control on every field', async () => {
    expect(
      await messages({
        outgoingCallType: null,
        incomingCallType: null,
        callProviderMode: null,
      }),
    ).toEqual([]);
  });

  it('rejects a call type outside the offered one', async () => {
    expect(
      (await messages({ outgoingCallType: 'ASTERISK' })).length,
    ).toBeGreaterThan(0);
    expect(
      (await messages({ incomingCallType: 'ASTERISK' })).length,
    ).toBeGreaterThan(0);
  });

  it('accepts both provider modes and nothing else', async () => {
    expect(await messages({ callProviderMode: 'TOTAL_CALLS' })).toEqual([]);
    expect(await messages({ callProviderMode: 'UNIQUE_CALLS' })).toEqual([]);
    const errors = await messages({ callProviderMode: 'AVERAGE_CALLS' });
    expect(errors.join(' ')).toContain('Total Calls or Unique Calls');
  });
});

describe('UpdateCallStatusDto validation', () => {
  const messages = async (raw: Record<string, unknown>): Promise<string[]> => {
    const instance = plainToInstance(UpdateCallStatusDto, raw);
    const errors = await validate(instance);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts a real custom name', async () => {
    expect(await messages({ customName: 'Connected' })).toEqual([]);
  });

  it('rejects a blank or whitespace-only name', async () => {
    expect((await messages({ customName: '' })).length).toBeGreaterThan(0);
    const errors = await messages({ customName: '   ' });
    expect(errors.join(' ')).toContain('Custom Status Name is required.');
  });

  it('trims surrounding whitespace', () => {
    const instance = plainToInstance(UpdateCallStatusDto, {
      customName: '  Connected  ',
    });
    expect(instance.customName).toBe('Connected');
  });

  it('bounds the name length', async () => {
    expect(
      (await messages({ customName: 'x'.repeat(61) })).length,
    ).toBeGreaterThan(0);
    expect(await messages({ customName: 'x'.repeat(60) })).toEqual([]);
  });
});

/**
 * Settings → Activity and Reminders (ADR-0071).
 *
 * The follow-up types are one `app_settings` row seeded on first read, so most of these
 * assertions run against `findUnique` returning the list the previous call wrote.
 */
describe('SettingsService — Activity and Reminders', () => {
  const validGeneral = (): UpdateActivityGeneralDto => ({
    ...ACTIVITY_GENERAL_DEFAULTS,
  });

  /** The field builder's default: the five a follow-up cannot be created without. */
  const coreFields = () => [
    { key: 'DESCRIPTION' as const, position: 1 },
    { key: 'ASSIGNED_TO' as const, position: 2 },
    { key: 'LEAD_NAME' as const, position: 3 },
    { key: 'DUE_DATE' as const, position: 4 },
    { key: 'START_TIME' as const, position: 5 },
  ];

  const validType = (): SaveFollowUpTypeDto => ({
    name: 'Site Visit',
    isActive: true,
    fields: coreFields(),
  });

  /** What the row holds after a write, as the next read would see it. */
  const written = (upsert: jest.Mock): FollowUpType[] =>
    (
      (upsert.mock.calls as unknown[][]).at(-1)?.[0] as {
        create: { value: FollowUpType[] };
      }
    ).create.value;

  describe('getActivityGeneral', () => {
    it('returns the shipped defaults when nothing has been saved', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue(null);

      await expect(service.getActivityGeneral()).resolves.toEqual(
        ACTIVITY_GENERAL_DEFAULTS,
      );
      expect(findUnique).toHaveBeenCalledWith({
        where: { key: ACTIVITY_GENERAL_KEY },
        select: { value: true },
      });
    });

    it('returns what was stored', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: {
          ...ACTIVITY_GENERAL_DEFAULTS,
          remindersEnabled: false,
          overdueMode: 'END_OF_DAY',
        },
      });

      const result = await service.getActivityGeneral();

      expect(result.remindersEnabled).toBe(false);
      expect(result.overdueMode).toBe('END_OF_DAY');
    });

    it('defaults each unreadable field on its own', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: {
          remindersEnabled: 'yes',
          reminderTime: 'NEXT_TUESDAY',
          overdueMode: 'WHENEVER',
          overdueAfterMinutes: 7,
          autoPromptFollowUpOnCompletion: false,
        },
      });

      const result = await service.getActivityGeneral();

      expect(result.remindersEnabled).toBe(
        ACTIVITY_GENERAL_DEFAULTS.remindersEnabled,
      );
      expect(result.reminderTime).toBe(ACTIVITY_GENERAL_DEFAULTS.reminderTime);
      expect(result.overdueMode).toBe(ACTIVITY_GENERAL_DEFAULTS.overdueMode);
      expect(result.overdueAfterMinutes).toBe(
        ACTIVITY_GENERAL_DEFAULTS.overdueAfterMinutes,
      );
      // The one readable field survives the four unusable ones.
      expect(result.autoPromptFollowUpOnCompletion).toBe(false);
    });
  });

  describe('saveActivityGeneral', () => {
    it('stores the payload under its own key and returns it', async () => {
      const { service, upsert } = makeService();
      const dto = { ...validGeneral(), overdueAfterMinutes: 45 as const };

      await expect(service.saveActivityGeneral(dto)).resolves.toEqual(dto);

      const call = (upsert.mock.calls as unknown[][])[0][0] as {
        where: { key: string };
      };
      expect(call.where.key).toBe(ACTIVITY_GENERAL_KEY);
    });
  });

  describe('UpdateActivityGeneralDto', () => {
    const errorsFor = async (payload: Record<string, unknown>) =>
      validate(plainToInstance(UpdateActivityGeneralDto, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('accepts the shipped defaults', async () => {
      await expect(
        errorsFor({ ...ACTIVITY_GENERAL_DEFAULTS }),
      ).resolves.toEqual([]);
    });

    it('rejects an unknown reminder time', async () => {
      const errors = await errorsFor({
        ...ACTIVITY_GENERAL_DEFAULTS,
        reminderTime: 'THREE_DAYS_BEFORE',
      });
      expect(errors.map((error) => error.property)).toContain('reminderTime');
    });

    it('rejects an unknown overdue mode', async () => {
      const errors = await errorsFor({
        ...ACTIVITY_GENERAL_DEFAULTS,
        overdueMode: 'AFTER_A_WHILE',
      });
      expect(errors.map((error) => error.property)).toContain('overdueMode');
    });

    it('rejects an overdue span the dropdown does not offer', async () => {
      const errors = await errorsFor({
        ...ACTIVITY_GENERAL_DEFAULTS,
        overdueAfterMinutes: 20,
      });
      expect(errors.map((error) => error.property)).toContain(
        'overdueAfterMinutes',
      );
    });

    it('rejects a field the screen does not have', async () => {
      const errors = await errorsFor({
        ...ACTIVITY_GENERAL_DEFAULTS,
        escalateToManager: true,
      });
      expect(errors.map((error) => error.property)).toContain(
        'escalateToManager',
      );
    });
  });

  describe('getFollowUpTypes', () => {
    it('seeds Call, Meeting and Task on first read, with a real timestamp', async () => {
      const { service, findUnique, upsert } = makeService();
      findUnique.mockResolvedValue(null);

      const types = await service.getFollowUpTypes();

      expect(types.map((type) => type.name)).toEqual([
        'Call',
        'Meeting',
        'Task',
      ]);
      expect(types.map((type) => type.activityType)).toEqual([
        'CALL',
        'MEETING',
        'TASK',
      ]);
      // Stored, not synthesised: the table's Date and Time column reads a real row.
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(Number.isNaN(Date.parse(types[0].createdAt))).toBe(false);
    });

    it('gives a Call no End Time or Location, and a Meeting both', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue(null);

      const [call, meeting] = await service.getFollowUpTypes();

      expect(call.fields.map((field) => field.key)).not.toContain('END_TIME');
      expect(call.fields.map((field) => field.key)).not.toContain('LOCATION');
      expect(meeting.fields.map((field) => field.key)).toContain('END_TIME');
      expect(meeting.fields.map((field) => field.key)).toContain('LOCATION');
    });

    it('does not reseed once the row exists', async () => {
      const { service, findUnique, upsert } = makeService();
      findUnique.mockResolvedValue({ value: [] });

      await expect(service.getFollowUpTypes()).resolves.toEqual([]);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('drops an entry that is not a usable configuration', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: [
          {
            id: 'a',
            name: 'Kept',
            fields: [{ key: 'DESCRIPTION', position: 1 }],
          },
          { id: 'b', name: '', fields: [{ key: 'DESCRIPTION', position: 1 }] },
          { id: 'c', name: 'No fields', fields: [] },
          'not an object',
        ],
      });

      const types = await service.getFollowUpTypes();

      expect(types.map((type) => type.name)).toEqual(['Kept']);
    });

    it('renumbers stored positions contiguously and drops unknown keys', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: [
          {
            id: 'a',
            name: 'Odd',
            fields: [
              { key: 'START_TIME', position: 90 },
              { key: 'NOT_A_FIELD', position: 2 },
              { key: 'DESCRIPTION', position: 4 },
              { key: 'DESCRIPTION', position: 5 },
            ],
          },
        ],
      });

      const [type] = await service.getFollowUpTypes();

      expect(type.fields).toEqual([
        { key: 'DESCRIPTION', position: 1 },
        { key: 'START_TIME', position: 2 },
      ]);
    });
  });

  describe('createFollowUpType', () => {
    it('appends the type, names its creator and returns the whole list', async () => {
      const { service, findUnique, upsert, userFindUnique } = makeService();
      findUnique.mockResolvedValue({ value: [] });

      const types = await service.createFollowUpType(validType(), 'user-1');

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Site Visit');
      expect(types[0].createdBy).toBe('Emarath Admin');
      // A custom type has no ActivityType to be stored as.
      expect(types[0].activityType).toBeNull();
      expect(userFindUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { name: true },
      });
      expect(written(upsert)).toEqual(types);
    });

    it('persists the field order the builder sent, renumbered from 1', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({ value: [] });

      const types = await service.createFollowUpType(
        {
          ...validType(),
          fields: [
            { key: 'START_TIME', position: 9 },
            { key: 'DESCRIPTION', position: 11 },
            { key: 'ASSIGNED_TO', position: 12 },
            { key: 'LEAD_NAME', position: 13 },
            { key: 'DUE_DATE', position: 14 },
          ],
        },
        'user-1',
      );

      expect(types[0].fields).toEqual([
        { key: 'START_TIME', position: 1 },
        { key: 'DESCRIPTION', position: 2 },
        { key: 'ASSIGNED_TO', position: 3 },
        { key: 'LEAD_NAME', position: 4 },
        { key: 'DUE_DATE', position: 5 },
      ]);
    });

    it('refuses a duplicate name, whatever its case', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: [
          {
            id: 'a',
            name: 'Site Visit',
            fields: [{ key: 'DESCRIPTION', position: 1 }],
          },
        ],
      });

      await expect(
        service.createFollowUpType({ ...validType(), name: 'SITE VISIT' }, 'u'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a selection missing a field the create API requires', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({ value: [] });

      await expect(
        service.createFollowUpType(
          {
            ...validType(),
            fields: coreFields().filter((field) => field.key !== 'DUE_DATE'),
          },
          'u',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses the same field selected twice', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({ value: [] });

      await expect(
        service.createFollowUpType(
          {
            ...validType(),
            fields: [...coreFields(), { key: 'DESCRIPTION', position: 6 }],
          },
          'u',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to grow the row without bound', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue({
        value: Array.from({ length: MAX_FOLLOW_UP_TYPES }, (_, index) => ({
          id: String(index),
          name: `Type ${index}`,
          fields: [{ key: 'DESCRIPTION', position: 1 }],
        })),
      });

      await expect(
        service.createFollowUpType(validType(), 'u'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateFollowUpType', () => {
    const stored = () => ({
      value: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Meeting',
          isActive: true,
          activityType: 'MEETING',
          createdBy: 'ADMIN',
          createdAt: '2026-02-04T18:31:45.000Z',
          fields: [
            { key: 'DESCRIPTION', position: 1 },
            { key: 'ASSIGNED_TO', position: 2 },
            { key: 'LEAD_NAME', position: 3 },
            { key: 'DUE_DATE', position: 4 },
            { key: 'START_TIME', position: 5 },
          ],
        },
      ],
    });

    it('edits the name, the status and the field order, and nothing else', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue(stored());

      const [type] = await service.updateFollowUpType(
        '11111111-1111-4111-8111-111111111111',
        {
          name: 'Site Meeting',
          isActive: false,
          fields: [
            { key: 'START_TIME', position: 1 },
            { key: 'DESCRIPTION', position: 2 },
            { key: 'ASSIGNED_TO', position: 3 },
            { key: 'LEAD_NAME', position: 4 },
            { key: 'DUE_DATE', position: 5 },
            { key: 'LOCATION', position: 6 },
          ],
        },
      );

      expect(type.name).toBe('Site Meeting');
      expect(type.isActive).toBe(false);
      expect(type.fields[0]).toEqual({ key: 'START_TIME', position: 1 });
      expect(type.fields.at(-1)).toEqual({ key: 'LOCATION', position: 6 });
      // Identity is not configuration: these survive every edit.
      expect(type.activityType).toBe('MEETING');
      expect(type.createdBy).toBe('ADMIN');
      expect(type.createdAt).toBe('2026-02-04T18:31:45.000Z');
    });

    it('404s an id that is no longer configured', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue(stored());

      await expect(
        service.updateFollowUpType('22222222-2222-4222-8222-222222222222', {
          name: 'Ghost',
          isActive: true,
          fields: coreFields(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteFollowUpType', () => {
    const meetingId = '11111111-1111-4111-8111-111111111111';
    const stored = (activityType: string | null) => ({
      value: [
        {
          id: meetingId,
          name: 'Meeting',
          isActive: true,
          activityType,
          createdBy: 'ADMIN',
          createdAt: '2026-02-04T18:31:45.000Z',
          fields: [{ key: 'DESCRIPTION', position: 1 }],
        },
      ],
    });

    it('removes a type nothing is filed under', async () => {
      const { service, findUnique, activityCount } = makeService();
      findUnique.mockResolvedValue(stored('MEETING'));
      activityCount.mockResolvedValue(0);

      await expect(service.deleteFollowUpType(meetingId)).resolves.toEqual([]);
      expect(activityCount).toHaveBeenCalledWith({
        where: { type: 'MEETING', deletedAt: null },
      });
    });

    it('refuses to orphan live follow-ups, and says to deactivate instead', async () => {
      const { service, findUnique, activityCount } = makeService();
      findUnique.mockResolvedValue(stored('MEETING'));
      activityCount.mockResolvedValue(3);

      await expect(service.deleteFollowUpType(meetingId)).rejects.toThrow(
        /used by 3 follow-ups/,
      );
      await expect(service.deleteFollowUpType(meetingId)).rejects.toThrow(
        /Inactive/,
      );
    });

    it('does not count activities for a custom type — none can exist', async () => {
      const { service, findUnique, activityCount } = makeService();
      findUnique.mockResolvedValue(stored(null));

      await expect(service.deleteFollowUpType(meetingId)).resolves.toEqual([]);
      expect(activityCount).not.toHaveBeenCalled();
    });

    it('404s an unknown id', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockResolvedValue(stored('MEETING'));

      await expect(
        service.deleteFollowUpType('22222222-2222-4222-8222-222222222222'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getActivityWorkflow', () => {
    it('carries the switches and the active types only', async () => {
      const { service, findUnique } = makeService();
      findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
        if (where.key === ACTIVITY_GENERAL_KEY) {
          return Promise.resolve({
            value: { ...ACTIVITY_GENERAL_DEFAULTS, remindersEnabled: false },
          });
        }
        if (where.key === ACTIVITY_FOLLOW_UP_TYPES_KEY) {
          return Promise.resolve({
            value: [
              {
                id: 'a',
                name: 'Call',
                isActive: true,
                fields: [{ key: 'DESCRIPTION', position: 1 }],
              },
              {
                id: 'b',
                name: 'Retired',
                isActive: false,
                fields: [{ key: 'DESCRIPTION', position: 1 }],
              },
            ],
          });
        }
        return Promise.resolve(null);
      });

      const workflow = await service.getActivityWorkflow();

      expect(workflow.general.remindersEnabled).toBe(false);
      expect(workflow.followUpTypes.map((type) => type.name)).toEqual(['Call']);
    });
  });

  describe('SaveFollowUpTypeDto', () => {
    const errorsFor = async (payload: Record<string, unknown>) =>
      validate(plainToInstance(SaveFollowUpTypeDto, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('accepts a valid payload', async () => {
      await expect(errorsFor({ ...validType() })).resolves.toEqual([]);
    });

    it('rejects a whitespace-only name', async () => {
      const errors = await errorsFor({ ...validType(), name: '   ' });
      expect(errors.map((error) => error.property)).toContain('name');
    });

    it('rejects a field key that is not in the catalogue', async () => {
      const errors = await errorsFor({
        ...validType(),
        fields: [{ key: 'INVOICE_NUMBER', position: 1 }],
      });
      expect(errors.map((error) => error.property)).toContain('fields');
    });

    it('rejects an empty selection', async () => {
      const errors = await errorsFor({ ...validType(), fields: [] });
      expect(errors.map((error) => error.property)).toContain('fields');
    });

    it('rejects a field the form does not have', async () => {
      const errors = await errorsFor({ ...validType(), colour: 'green' });
      expect(errors.map((error) => error.property)).toContain('colour');
    });
  });
});
