import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { LeadCustomFieldsService } from './lead-custom-fields.service';
import {
  CUSTOM_FIELD_TYPES,
  CreateLeadCustomFieldDto,
  ListLeadCustomFieldsQueryDto,
  UpdateLeadCustomFieldDto,
} from './dto/lead-custom-field.dto';

/**
 * Settings > Data & Schema Management > Custom Field (ADR-0072), over the definition
 * store that LEAD-05.1 already shipped.
 */
function makeService() {
  const findMany = jest.fn().mockResolvedValue([]);
  const findFirst = jest.fn();
  const findUnique = jest.fn().mockResolvedValue(null);
  const findUniqueOrThrow = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const count = jest.fn().mockResolvedValue(0);
  const aggregate = jest.fn().mockResolvedValue({ _max: { position: 4 } });

  const valueCount = jest.fn().mockResolvedValue(0);
  const valueFindMany = jest.fn().mockResolvedValue([]);
  const optionDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const formFieldDeleteMany = jest.fn().mockResolvedValue({ count: 0 });

  const $transaction = jest.fn((ops: unknown) =>
    Array.isArray(ops) ? Promise.all(ops) : Promise.resolve(ops),
  );

  const prisma = {
    leadCustomField: {
      findMany,
      findFirst,
      findUnique,
      findUniqueOrThrow,
      create,
      update,
      count,
      aggregate,
    },
    leadCustomFieldValue: { count: valueCount, findMany: valueFindMany },
    leadCustomFieldOption: { deleteMany: optionDeleteMany },
    leadFormField: { deleteMany: formFieldDeleteMany },
    $transaction,
  } as unknown as PrismaService;

  return {
    service: new LeadCustomFieldsService(prisma),
    findMany,
    findFirst,
    findUniqueOrThrow,
    create,
    update,
    count,
    valueCount,
    valueFindMany,
    optionDeleteMany,
    formFieldDeleteMany,
    $transaction,
  };
}

const options = (...labels: string[]) =>
  labels.map((label, index) => ({ label, position: index + 1 }));

const validCreate = (): CreateLeadCustomFieldDto => ({
  name: 'National Code',
  type: 'TEXT',
});

describe('LeadCustomFieldsService', () => {
  describe('the six field types', () => {
    it('offers exactly the reference dropdown, in its order', () => {
      expect(CUSTOM_FIELD_TYPES.map((type) => type.label)).toEqual([
        'Text',
        'Text Box',
        'Number',
        'Date',
        'Date Time',
        'Drop Down',
      ]);
    });

    it('keeps Text and Text Box distinct', () => {
      const values = CUSTOM_FIELD_TYPES.map((type) => type.value);
      expect(values).toContain('TEXT');
      expect(values).toContain('TEXTBOX');
      expect(new Set(values).size).toBe(6);
    });
  });

  describe('list', () => {
    it('offers only active, undeleted fields', async () => {
      const { service, findMany } = makeService();

      await service.list();

      const args = (findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).toEqual({ deletedAt: null, isActive: true });
    });
  });

  describe('page', () => {
    it('pages in the database, not the browser', async () => {
      const { service, findMany, count, $transaction } = makeService();
      findMany.mockResolvedValue([]);
      count.mockResolvedValue(42);
      $transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      await expect(service.page({ page: 3, size: 10 })).resolves.toEqual({
        rows: [],
        total: 42,
      });

      const args = (findMany.mock.calls as unknown[][])[0][0] as {
        skip: number;
        take: number;
      };
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });

    it('folds the search box and the Field Type filter into one where', async () => {
      const { service, findMany, $transaction } = makeService();
      $transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      await service.page({ search: 'payment', type: 'DROP_DOWN' });

      const args = (findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).toEqual({
        deletedAt: null,
        type: 'DROP_DOWN',
        name: { contains: 'payment', mode: 'insensitive' },
      });
    });
  });

  describe('create', () => {
    it('derives a stable cf_ key the client never sends', async () => {
      const { service, create } = makeService();
      create.mockResolvedValue({});

      await service.create({ name: 'National Code', type: 'TEXT' });

      const args = (create.mock.calls as unknown[][])[0][0] as {
        data: { key: string; position: number; isActive: boolean };
      };
      expect(args.data.key).toBe('cf_national_code');
      expect(args.data.position).toBe(5);
      expect(args.data.isActive).toBe(true);
    });

    it('stores a dropdown’s options, renumbered from 1', async () => {
      const { service, create } = makeService();
      create.mockResolvedValue({});

      await service.create({
        name: 'Payment Method',
        type: 'DROP_DOWN',
        options: [
          { label: 'Quick Link', position: 30 },
          { label: 'COD', position: 10 },
          { label: 'Account Transfer', position: 20 },
        ],
      });

      const args = (create.mock.calls as unknown[][])[0][0] as {
        data: { options: { create: { label: string; position: number }[] } };
      };
      expect(args.data.options.create).toEqual([
        { label: 'COD', position: 1 },
        { label: 'Account Transfer', position: 2 },
        { label: 'Quick Link', position: 3 },
      ]);
    });

    it('refuses a dropdown with no options', async () => {
      const { service } = makeService();

      await expect(
        service.create({ name: 'Solution', type: 'DROP_DOWN' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses options on a type that has none', async () => {
      const { service } = makeService();

      await expect(
        service.create({
          name: 'QTY',
          type: 'NUMBER',
          options: options('one'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a blank option', async () => {
      const { service } = makeService();

      await expect(
        service.create({
          name: 'Solution',
          type: 'DROP_DOWN',
          options: [{ label: '   ', position: 1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses the same option twice, whatever its case', async () => {
      const { service } = makeService();

      await expect(
        service.create({
          name: 'Solution',
          type: 'DROP_DOWN',
          options: options('Refund', 'REFUND'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a duplicate label', async () => {
      const { service, findMany } = makeService();
      findMany.mockResolvedValue([{ name: 'National Code' }]);

      await expect(
        service.create({ name: 'national code', type: 'TEXT' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    const existing = {
      id: 'f1',
      name: 'National Code',
      type: 'TEXT' as const,
    };

    const dto = (
      over: Partial<UpdateLeadCustomFieldDto> = {},
    ): UpdateLeadCustomFieldDto => ({
      name: 'Customer National Code',
      type: 'TEXT',
      isActive: true,
      ...over,
    });

    it('renames without touching the key that stored values point at', async () => {
      const { service, findFirst, findUniqueOrThrow, $transaction } =
        makeService();
      findFirst
        .mockResolvedValueOnce(existing) // the field itself
        .mockResolvedValueOnce(null); // no name clash
      findUniqueOrThrow.mockResolvedValue({ id: 'f1' });
      $transaction.mockResolvedValue([]);

      await service.update('f1', dto());

      const ops = ($transaction.mock.calls as unknown[][])[0][0] as unknown[];
      // The definition update and the option replacement travel together.
      expect(ops).toHaveLength(2);
      const written = JSON.stringify(
        ($transaction.mock.calls as unknown[][])[0][0],
      );
      expect(written).not.toContain('"key"');
    });

    it('404s a field that no longer exists', async () => {
      const { service, findFirst } = makeService();
      findFirst.mockResolvedValueOnce(null);

      await expect(service.update('f1', dto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses a label another field already uses', async () => {
      const { service, findFirst } = makeService();
      findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ id: 'f2' });

      await expect(service.update('f1', dto())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a type change once the field holds values', async () => {
      const { service, findFirst, valueCount } = makeService();
      findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
      valueCount.mockResolvedValue(7);

      await expect(
        service.update('f1', dto({ type: 'NUMBER' })),
      ).rejects.toThrow(/field type cannot be changed/);
    });

    it('allows a type change while the field is empty', async () => {
      const {
        service,
        findFirst,
        findUniqueOrThrow,
        valueCount,
        $transaction,
      } = makeService();
      findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
      valueCount.mockResolvedValue(0);
      findUniqueOrThrow.mockResolvedValue({ id: 'f1' });
      $transaction.mockResolvedValue([]);

      await expect(
        service.update('f1', dto({ type: 'NUMBER' })),
      ).resolves.toEqual({ id: 'f1' });
    });

    it('refuses to drop an option leads have already chosen', async () => {
      const { service, findFirst, valueCount, valueFindMany } = makeService();
      findFirst
        .mockResolvedValueOnce({ ...existing, type: 'DROP_DOWN' })
        .mockResolvedValueOnce(null);
      valueCount.mockResolvedValue(3);
      valueFindMany.mockResolvedValue([
        { value: 'COD' },
        { value: 'Quick Link' },
      ]);

      await expect(
        service.update(
          'f1',
          dto({ type: 'DROP_DOWN', options: options('COD') }),
        ),
      ).rejects.toThrow(/Quick Link/);
    });
  });

  describe('remove', () => {
    it('refuses to destroy lead data, and names the alternative', async () => {
      const { service, findFirst, valueCount } = makeService();
      findFirst.mockResolvedValue({ id: 'f1', name: 'National Code' });
      valueCount.mockResolvedValue(12);

      await expect(service.remove('f1')).rejects.toThrow(
        /holds 12 lead values/,
      );
      await expect(service.remove('f1')).rejects.toThrow(/Inactive/);
    });

    it('soft-deletes a field nothing has been filed under', async () => {
      const { service, findFirst, valueCount, update, $transaction } =
        makeService();
      findFirst.mockResolvedValue({ id: 'f1', key: 'cf_spare', name: 'Spare' });
      valueCount.mockResolvedValue(0);
      update.mockResolvedValue({});
      $transaction.mockResolvedValue([]);

      await service.remove('f1');

      const args = (update.mock.calls as unknown[][])[0][0] as {
        data: { deletedAt: Date };
      };
      expect(args.data.deletedAt).toBeInstanceOf(Date);
    });

    it('takes the field off every form it was placed on', async () => {
      const { service, findFirst, valueCount, update, formFieldDeleteMany } =
        makeService();
      findFirst.mockResolvedValue({ id: 'f1', key: 'cf_spare', name: 'Spare' });
      valueCount.mockResolvedValue(0);
      update.mockResolvedValue({});

      await service.remove('f1');

      // Otherwise the form would reference a key that no longer exists, and the form
      // builder would refuse to save it — locking a form over an unrelated delete.
      expect(formFieldDeleteMany).toHaveBeenCalledWith({
        where: { fieldKey: 'cf_spare' },
      });
    });

    it('404s an unknown id', async () => {
      const { service, findFirst } = makeService();
      findFirst.mockResolvedValue(null);

      await expect(service.remove('f1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('prepareValues', () => {
    it('accepts a dropdown value the field offers', async () => {
      const { service, findMany } = makeService();
      findMany.mockResolvedValue([
        {
          id: 'f1',
          name: 'Payment Method',
          type: 'DROP_DOWN',
          options: [{ label: 'COD' }, { label: 'Quick Link' }],
        },
      ]);

      await expect(
        service.prepareValues([{ fieldId: 'f1', value: 'COD' }]),
      ).resolves.toEqual([{ customFieldId: 'f1', value: 'COD' }]);
    });

    it('rejects a dropdown value the field does not offer', async () => {
      const { service, findMany } = makeService();
      findMany.mockResolvedValue([
        {
          id: 'f1',
          name: 'Payment Method',
          type: 'DROP_DOWN',
          options: [{ label: 'COD' }],
        },
      ]);

      await expect(
        service.prepareValues([{ fieldId: 'f1', value: 'Crypto' }]),
      ).rejects.toThrow(/is not an option of "Payment Method"/);
    });

    it('rejects a value for a deactivated field', async () => {
      const { service, findMany } = makeService();
      findMany.mockResolvedValue([]);

      await expect(
        service.prepareValues([{ fieldId: 'f1', value: 'x' }]),
      ).rejects.toBeInstanceOf(BadRequestException);

      const args = (findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).toMatchObject({ deletedAt: null, isActive: true });
    });

    it('still rejects a non-number in a NUMBER field', async () => {
      const { service, findMany } = makeService();
      findMany.mockResolvedValue([
        { id: 'f1', name: 'QTY', type: 'NUMBER', options: [] },
      ]);

      await expect(
        service.prepareValues([{ fieldId: 'f1', value: 'three' }]),
      ).rejects.toThrow(/must be a number/);
    });
  });
});

describe('Custom field DTOs', () => {
  const errorsFor = async (
    cls: new () => object,
    payload: Record<string, unknown>,
  ) =>
    validate(plainToInstance(cls, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts a valid create', async () => {
    await expect(
      errorsFor(CreateLeadCustomFieldDto, { ...validCreate() }),
    ).resolves.toEqual([]);
  });

  it('rejects a whitespace-only label', async () => {
    const errors = await errorsFor(CreateLeadCustomFieldDto, {
      ...validCreate(),
      name: '   ',
    });
    expect(errors.map((error) => error.property)).toContain('name');
  });

  it('rejects a field type the screen does not offer', async () => {
    const errors = await errorsFor(CreateLeadCustomFieldDto, {
      ...validCreate(),
      type: 'CURRENCY',
    });
    expect(errors.map((error) => error.property)).toContain('type');
  });

  it('rejects an unknown body field', async () => {
    const errors = await errorsFor(CreateLeadCustomFieldDto, {
      ...validCreate(),
      key: 'cf_forged',
    });
    expect(errors.map((error) => error.property)).toContain('key');
  });

  it('rejects a blank option label', async () => {
    const errors = await errorsFor(CreateLeadCustomFieldDto, {
      name: 'Solution',
      type: 'DROP_DOWN',
      options: [{ label: '', position: 1 }],
    });
    expect(errors.map((error) => error.property)).toContain('options');
  });

  it('rejects an unsupported page size on the list query', async () => {
    const errors = await errorsFor(ListLeadCustomFieldsQueryDto, { size: 7 });
    expect(errors.map((error) => error.property)).toContain('size');
  });

  it('coerces the paging query from strings', async () => {
    const query = plainToInstance(ListLeadCustomFieldsQueryDto, {
      page: '2',
      size: '25',
      isActive: 'true',
    });
    await expect(validate(query)).resolves.toEqual([]);
    expect(query.page).toBe(2);
    expect(query.size).toBe(25);
    expect(query.isActive).toBe(true);
  });
});
