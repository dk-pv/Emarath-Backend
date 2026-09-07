import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { LeadFormsService } from './lead-forms.service';
import {
  LEAD_SYSTEM_FIELDS,
  REQUIRED_LEAD_FIELD_KEYS,
} from './lead-system-fields';
import { SaveLeadFormDto } from './dto/lead-form.dto';

/** Settings > Data & Schema Management > Form Customization (ADR-0072). */
function makeService() {
  const formFindMany = jest.fn().mockResolvedValue([]);
  const formFindFirst = jest.fn().mockResolvedValue(null);
  const formCount = jest.fn().mockResolvedValue(0);
  const formCreate = jest.fn();
  const formUpdate = jest.fn();
  const formUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const fieldDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const fieldCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const sectionDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const sectionFindMany = jest.fn().mockResolvedValue([]);
  // The write path re-reads the form once its sections and fields exist; a bare row is
  // enough for the tests that assert on the *arguments* rather than the answer.
  const formFindUniqueOrThrow = jest.fn().mockResolvedValue({
    id: 'form-1',
    name: 'Custom Lead Form',
    module: 'LEAD',
    isActive: true,
    isDefault: true,
    createdByName: 'Emarath Admin',
    createdAt: new Date('2026-02-04T18:31:45.000Z'),
    updatedAt: new Date('2026-06-08T19:45:39.000Z'),
    fields: [],
    sections: [],
  });
  const customFindMany = jest.fn().mockResolvedValue([]);

  const tx = {
    leadForm: {
      create: formCreate,
      update: formUpdate,
      updateMany: formUpdateMany,
      findUniqueOrThrow: formFindUniqueOrThrow,
    },
    leadFormField: {
      deleteMany: fieldDeleteMany,
      createMany: fieldCreateMany,
    },
    leadFormSection: {
      deleteMany: sectionDeleteMany,
      findMany: sectionFindMany,
    },
  };

  const $transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg)
      : (arg as (client: typeof tx) => Promise<unknown>)(tx),
  );

  const prisma = {
    leadForm: {
      findMany: formFindMany,
      findFirst: formFindFirst,
      count: formCount,
      create: formCreate,
      update: formUpdate,
      updateMany: formUpdateMany,
    },
    leadFormField: {
      deleteMany: fieldDeleteMany,
      createMany: fieldCreateMany,
    },
    leadFormSection: {
      deleteMany: sectionDeleteMany,
      findMany: sectionFindMany,
    },
    leadCustomField: { findMany: customFindMany },
    $transaction,
  } as unknown as PrismaService;

  return {
    service: new LeadFormsService(prisma),
    formFindMany,
    formFindFirst,
    formCount,
    formCreate,
    formUpdate,
    formUpdateMany,
    fieldDeleteMany,
    fieldCreateMany,
    sectionDeleteMany,
    sectionFindMany,
    formFindUniqueOrThrow,
    customFindMany,
    $transaction,
  };
}

/** A stored row in the shape FORM_SELECT returns. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'form-1',
  name: 'Custom Lead Form',
  module: 'LEAD',
  isActive: true,
  isDefault: true,
  createdByName: 'Emarath Admin',
  createdAt: new Date('2026-02-04T18:31:45.000Z'),
  updatedAt: new Date('2026-06-08T19:45:39.000Z'),
  fields: [
    { fieldKey: 'name', position: 1, isVisible: true, section: null },
    { fieldKey: 'primaryPhone', position: 2, isVisible: true, section: null },
    { fieldKey: 'status', position: 3, isVisible: true, section: null },
    { fieldKey: 'pipeline', position: 4, isVisible: true, section: null },
  ],
  sections: [],
  ...over,
});

/** The four a lead cannot be created without, plus whatever else the test needs. */
const fields = (
  extra: { fieldKey: string; position: number; isVisible: boolean }[] = [],
) => [
  ...REQUIRED_LEAD_FIELD_KEYS.map((fieldKey, index) => ({
    fieldKey,
    position: index + 1,
    isVisible: true,
  })),
  ...extra,
];

const dto = (over: Partial<SaveLeadFormDto> = {}): SaveLeadFormDto => ({
  name: 'CS Complaint',
  module: 'LEAD',
  isActive: true,
  isDefault: false,
  fields: fields(),
  ...over,
});

describe('LeadFormsService', () => {
  describe('availableFields', () => {
    it('offers the Lead record’s own fields plus the active custom ones', async () => {
      const { service, customFindMany } = makeService();
      customFindMany.mockResolvedValue([
        {
          key: 'cf_national_code',
          name: 'National Code',
          type: 'DROP_DOWN',
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ]);

      const available = await service.availableFields();

      expect(available).toHaveLength(LEAD_SYSTEM_FIELDS.length + 1);
      expect(available[0]).toEqual({
        fieldKey: 'name',
        label: 'Customer Name',
        isRequired: true,
        source: 'SYSTEM',
        type: 'TEXT',
        options: [],
      });
      expect(available.at(-1)).toEqual({
        fieldKey: 'cf_national_code',
        label: 'National Code',
        isRequired: false,
        source: 'CUSTOM',
        type: 'DROP_DOWN',
        options: ['A', 'B'],
      });
    });

    it('does not offer a deactivated custom field', async () => {
      const { service, customFindMany } = makeService();

      await service.availableFields();

      const args = (customFindMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).toEqual({ deletedAt: null, isActive: true });
    });
  });

  describe('page', () => {
    it('pages in the database and resolves each key to its label', async () => {
      const { service, formFindMany, formCount, customFindMany, $transaction } =
        makeService();
      formFindMany.mockResolvedValue([
        row({
          fields: [
            {
              fieldKey: 'cf_national_code',
              position: 1,
              isVisible: false,
              section: { name: 'Contact' },
            },
          ],
          sections: [{ name: 'Contact', position: 1 }],
        }),
      ]);
      formCount.mockResolvedValue(3);
      customFindMany.mockResolvedValue([
        { key: 'cf_national_code', name: 'National Code' },
      ]);
      $transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      const result = await service.page({ page: 2, size: 10 });

      expect(result.total).toBe(3);
      expect(result.rows[0].fields[0]).toEqual({
        fieldKey: 'cf_national_code',
        label: 'National Code',
        position: 1,
        isVisible: false,
        isRequired: false,
        source: 'CUSTOM',
        sectionName: 'Contact',
      });
      expect(result.rows[0].sections).toEqual([
        { name: 'Contact', position: 1 },
      ]);
      const args = (formFindMany.mock.calls as unknown[][])[0][0] as {
        skip: number;
      };
      expect(args.skip).toBe(10);
    });
  });

  describe('defaultForm', () => {
    it('reads the module’s active default only', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst.mockResolvedValue(row());

      await service.defaultForm('LEAD');

      const args = (formFindFirst.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).toEqual({
        deletedAt: null,
        module: 'LEAD',
        isDefault: true,
        isActive: true,
      });
    });

    it('is null when nothing has been made default', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst.mockResolvedValue(null);

      await expect(service.defaultForm('LEAD')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('stores the field order renumbered from 1', async () => {
      const { service, formCreate, fieldCreateMany } = makeService();
      formCreate.mockResolvedValue(row());

      await service.create(
        dto({
          fields: [
            { fieldKey: 'pipeline', position: 40, isVisible: true },
            { fieldKey: 'name', position: 10, isVisible: true },
            { fieldKey: 'status', position: 30, isVisible: true },
            { fieldKey: 'primaryPhone', position: 20, isVisible: true },
          ],
        }),
        'Emarath Admin',
      );

      const args = (formCreate.mock.calls as unknown[][])[0][0] as {
        data: { createdByName: string };
      };
      expect(args.data.createdByName).toBe('Emarath Admin');

      // Field rows are written after their sections exist, so they carry a section id.
      const written = (fieldCreateMany.mock.calls as unknown[][])[0][0] as {
        data: { fieldKey: string; position: number }[];
      };
      expect(written.data.map((f) => f.fieldKey)).toEqual([
        'name',
        'primaryPhone',
        'status',
        'pipeline',
      ]);
      expect(written.data.map((f) => f.position)).toEqual([1, 2, 3, 4]);
    });

    it('clears the previous default in the same transaction', async () => {
      const { service, formCreate, formUpdateMany } = makeService();
      formCreate.mockResolvedValue(row());

      await service.create(dto({ isDefault: true }), 'Admin');

      expect(formUpdateMany).toHaveBeenCalledWith({
        where: { deletedAt: null, module: 'LEAD', isDefault: true },
        data: { isDefault: false },
      });
    });

    it('leaves the default alone when the new form is not one', async () => {
      const { service, formCreate, formUpdateMany } = makeService();
      formCreate.mockResolvedValue(row());

      await service.create(dto(), 'Admin');

      expect(formUpdateMany).not.toHaveBeenCalled();
    });

    it('refuses a duplicate name, whatever its case', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst.mockResolvedValue({ id: 'other' });

      await expect(service.create(dto(), 'Admin')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('still accepts a field that has since been deactivated', async () => {
      const { service, formCreate, customFindMany } = makeService();
      // `availableFields` offers active fields only; validation must be wider, or
      // deactivating one field would lock every form that already mentions it.
      customFindMany.mockResolvedValue([
        { key: 'cf_retired', name: 'Retired' },
      ]);
      formCreate.mockResolvedValue(row());

      await expect(
        service.create(
          dto({
            fields: fields([
              { fieldKey: 'cf_retired', position: 9, isVisible: true },
            ]),
          }),
          'Admin',
        ),
      ).resolves.toBeDefined();
    });

    it('refuses a field that is not a field of this module', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          dto({
            fields: fields([
              { fieldKey: 'invoiceNumber', position: 9, isVisible: true },
            ]),
          }),
          'Admin',
        ),
      ).rejects.toThrow(/is not a field of this module/);
    });

    it('refuses the same field twice', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          dto({
            fields: fields([
              { fieldKey: 'name', position: 9, isVisible: true },
            ]),
          }),
          'Admin',
        ),
      ).rejects.toThrow(/only once/);
    });

    it('refuses a form missing a field a lead cannot be created without', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          dto({
            fields: fields().filter((field) => field.fieldKey !== 'pipeline'),
          }),
          'Admin',
        ),
      ).rejects.toThrow(/Lead Pipeline is required/);
    });

    it('refuses to hide a field a lead cannot be created without', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          dto({
            fields: fields().map((field) =>
              field.fieldKey === 'status'
                ? { ...field, isVisible: false }
                : field,
            ),
          }),
          'Admin',
        ),
      ).rejects.toThrow(/Lead Status is required/);
    });
  });

  describe('sections', () => {
    it('stores the sections renumbered from 1, and puts each field in its own', async () => {
      const { service, formCreate, fieldCreateMany, sectionFindMany } =
        makeService();
      formCreate.mockResolvedValue({ id: 'form-1' });
      sectionFindMany.mockResolvedValue([
        { id: 'sec-contact', name: 'Contact' },
        { id: 'sec-sales', name: 'Sales' },
      ]);

      await service.create(
        dto({
          sections: [
            { name: 'Sales', position: 20 },
            { name: 'Contact', position: 10 },
          ],
          fields: fields().map((field) =>
            field.fieldKey === 'primaryPhone'
              ? { ...field, sectionName: 'Contact' }
              : field,
          ),
        }),
        'Admin',
      );

      const created = (formCreate.mock.calls as unknown[][])[0][0] as {
        data: { sections: { create: { name: string; position: number }[] } };
      };
      expect(created.data.sections.create).toEqual([
        { name: 'Contact', position: 1 },
        { name: 'Sales', position: 2 },
      ]);

      const written = (fieldCreateMany.mock.calls as unknown[][])[0][0] as {
        data: { fieldKey: string; sectionId: string | null }[];
      };
      expect(
        written.data.find((f) => f.fieldKey === 'primaryPhone')?.sectionId,
      ).toBe('sec-contact');
      expect(written.data.find((f) => f.fieldKey === 'name')?.sectionId).toBe(
        null,
      );
    });

    it('refuses a field pointing at a section the form does not declare', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          dto({
            sections: [{ name: 'Contact', position: 1 }],
            fields: fields().map((field) =>
              field.fieldKey === 'name'
                ? { ...field, sectionName: 'Nowhere' }
                : field,
            ),
          }),
          'Admin',
        ),
      ).rejects.toThrow(/is not a section of this form/);
    });

    it('refuses a blank section name', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          dto({ sections: [{ name: '   ', position: 1 }] }),
          'Admin',
        ),
      ).rejects.toThrow(/Section Name is required/);
    });

    it('refuses the same section name twice, whatever its case', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          dto({
            sections: [
              { name: 'Contact', position: 1 },
              { name: 'contact', position: 2 },
            ],
          }),
          'Admin',
        ),
      ).rejects.toThrow(/used twice/);
    });

    it('drops the old sections before writing the new ones, fields first', async () => {
      const { service, formFindFirst, fieldDeleteMany, sectionDeleteMany } =
        makeService();
      formFindFirst
        .mockResolvedValueOnce({
          id: 'form-1',
          name: 'CS Complaint',
          isDefault: false,
          module: 'LEAD',
        })
        .mockResolvedValueOnce(null);

      await service.update('form-1', dto());

      // A section cannot be deleted while a field still points at it.
      expect(fieldDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        sectionDeleteMany.mock.invocationCallOrder[0],
      );
    });
  });

  describe('update', () => {
    it('updates the existing form rather than creating a second one', async () => {
      const { service, formFindFirst, formUpdate, formCreate } = makeService();
      formFindFirst
        .mockResolvedValueOnce({
          id: 'form-1',
          name: 'CS Complaint',
          isDefault: false,
          module: 'LEAD',
        })
        .mockResolvedValueOnce(null);
      formUpdate.mockResolvedValue(row());

      await service.update('form-1', dto({ name: 'CS Complaint v2' }));

      expect(formCreate).not.toHaveBeenCalled();
      const args = (formUpdate.mock.calls as unknown[][])[0][0] as {
        where: { id: string };
      };
      expect(args.where.id).toBe('form-1');
    });

    it('replaces the field list wholesale, in one transaction', async () => {
      const { service, formFindFirst, formUpdate, fieldDeleteMany } =
        makeService();
      formFindFirst
        .mockResolvedValueOnce({
          id: 'form-1',
          name: 'CS Complaint',
          isDefault: false,
          module: 'LEAD',
        })
        .mockResolvedValueOnce(null);
      formUpdate.mockResolvedValue(row());

      await service.update('form-1', dto());

      expect(fieldDeleteMany).toHaveBeenCalledWith({
        where: { formId: 'form-1' },
      });
    });

    it('refuses to leave the module with no default', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst
        .mockResolvedValueOnce({
          id: 'form-1',
          name: 'Custom Lead Form',
          isDefault: true,
          module: 'LEAD',
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.update('form-1', dto({ isDefault: false })),
      ).rejects.toThrow(/Make another form the default/);
    });

    it('refuses an inactive default', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst
        .mockResolvedValueOnce({
          id: 'form-1',
          name: 'Custom Lead Form',
          isDefault: true,
          module: 'LEAD',
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.update('form-1', dto({ isDefault: true, isActive: false })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s an unknown id', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst.mockResolvedValueOnce(null);

      await expect(service.update('nope', dto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('never deletes the default', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst.mockResolvedValue({
        id: 'form-1',
        name: 'Custom Lead Form',
        isDefault: true,
        _count: { users: 0 },
      });

      await expect(service.remove('form-1')).rejects.toThrow(
        /default form cannot be deleted/,
      );
    });

    it('refuses to strand the team members assigned to it', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst.mockResolvedValue({
        id: 'form-2',
        name: 'CS Complaint',
        isDefault: false,
        _count: { users: 4 },
      });

      await expect(service.remove('form-2')).rejects.toThrow(
        /assigned to 4 team members/,
      );
    });

    it('soft-deletes a form nothing points at, and frees its name', async () => {
      const { service, formFindFirst, formUpdate } = makeService();
      formFindFirst.mockResolvedValue({
        id: 'form-2',
        name: 'test',
        isDefault: false,
        _count: { users: 0 },
      });
      formUpdate.mockResolvedValue({});

      await service.remove('form-2');

      const args = (formUpdate.mock.calls as unknown[][])[0][0] as {
        data: { deletedAt: Date; name: string };
      };
      expect(args.data.deletedAt).toBeInstanceOf(Date);
      // `name` is unique in the database, which knows nothing about soft delete: the
      // deleted row must not reserve the name against the next form to claim it.
      expect(args.data.name).not.toBe('test');
      expect(args.data.name).toContain('test');
    });

    it('404s an unknown id', async () => {
      const { service, formFindFirst } = makeService();
      formFindFirst.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe('SaveLeadFormDto', () => {
  const errorsFor = async (payload: Record<string, unknown>) =>
    validate(plainToInstance(SaveLeadFormDto, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts a valid payload', async () => {
    await expect(errorsFor({ ...dto() })).resolves.toEqual([]);
  });

  it('rejects a whitespace-only name', async () => {
    const errors = await errorsFor({ ...dto(), name: '   ' });
    expect(errors.map((error) => error.property)).toContain('name');
  });

  it('rejects an unknown module', async () => {
    const errors = await errorsFor({ ...dto(), module: 'DEAL' });
    expect(errors.map((error) => error.property)).toContain('module');
  });

  it('rejects an empty field list', async () => {
    const errors = await errorsFor({ ...dto(), fields: [] });
    expect(errors.map((error) => error.property)).toContain('fields');
  });

  it('rejects an unknown body field', async () => {
    const errors = await errorsFor({ ...dto(), createdByName: 'forged' });
    expect(errors.map((error) => error.property)).toContain('createdByName');
  });
});
