import { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, toSalesCrmGeneral } from './settings.service';
import {
  SALES_CRM_GENERAL_DEFAULTS,
  SALES_CRM_GENERAL_KEY,
  SalesCrmGeneralSettings,
  UpdateSalesCrmGeneralDto,
} from './dto/sales-crm-general.dto';

/**
 * Mocks held as locals so assertions never reference an unbound class method — the
 * pattern the view-preferences and leads specs use.
 */
function makeService() {
  const findUnique = jest.fn();
  const upsert = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    appSetting: { findUnique, upsert },
  } as unknown as PrismaService;

  return { service: new SettingsService(prisma), findUnique, upsert };
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
