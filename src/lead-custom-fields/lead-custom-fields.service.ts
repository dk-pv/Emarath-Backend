import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadCustomFieldType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLeadCustomFieldDto,
  LeadCustomFieldDto,
  LeadCustomFieldOptionDto,
  LeadCustomFieldPage,
  ListLeadCustomFieldsQueryDto,
  MAX_FIELD_OPTIONS,
  UpdateLeadCustomFieldDto,
} from './dto/lead-custom-field.dto';
import { CustomFieldValueDto } from '../leads/dto/custom-field-value.dto';

/** At most this many custom columns — matches the view-preference column cap so a
 * saved layout can always carry every field. */
const MAX_FIELDS = 100;
/** "cf_" + slug, kept within the view-preference COLUMN_KEY 64-char budget. */
const KEY_MAX = 64;

const DEFAULT_PAGE_SIZE = 10;

/** Definition + its options, in the one shape every route answers with. */
const FIELD_SELECT = {
  id: true,
  key: true,
  name: true,
  type: true,
  position: true,
  isActive: true,
  options: {
    orderBy: { position: 'asc' },
    select: { id: true, label: true, position: true },
  },
} satisfies Prisma.LeadCustomFieldSelect;

/**
 * Custom-field definitions, their dropdown options, and per-lead value validation
 * (LEAD-05.1 / ADR-0051, extended by Settings > Data & Schema Management / ADR-0072).
 *
 * App-global: the platform is single-tenant, so a field defined once is available to
 * everyone; per-user visibility/order lives in UserViewPreference and per-form
 * visibility/order in LeadFormField — never here.
 */
@Injectable()
export class LeadCustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Active custom fields in display order — the Leads list's custom columns and the
   * lead form's custom inputs.
   *
   * Deactivating a field removes it from here, so it stops being offered as a column or
   * a form input, while every value it already holds stays in the database (ADR-0072).
   */
  async list(): Promise<LeadCustomFieldDto[]> {
    return this.prisma.leadCustomField.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { position: 'asc' },
      select: FIELD_SELECT,
    });
  }

  /**
   * One page of the Settings list, filtered by the reference's Search box and Field Type
   * control. Paged in the database rather than the browser: the reference's own data has
   * fields with 800 options, and a settings screen must not read the catalogue to show
   * ten rows of it.
   */
  async page(
    query: ListLeadCustomFieldsQueryDto,
  ): Promise<LeadCustomFieldPage> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.LeadCustomFieldWhereInput = {
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    // One transaction, so the total can never disagree with the page it labels.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leadCustomField.findMany({
        where,
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * size,
        take: size,
        select: FIELD_SELECT,
      }),
      this.prisma.leadCustomField.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * Creates a custom field: a unique display label, a derived stable "cf_<slug>" key,
   * the next position, and (for a dropdown) its options. Duplicate active labels are
   * rejected (409); the key is made unique against every row, including soft-deleted
   * ones, so it never resurrects a deleted field's data.
   */
  async create(dto: CreateLeadCustomFieldDto): Promise<LeadCustomFieldDto> {
    const name = dto.name.trim();
    const options = normaliseOptions(dto.type, dto.options);

    const active = await this.prisma.leadCustomField.findMany({
      where: { deletedAt: null },
      select: { name: true },
    });
    if (active.length >= MAX_FIELDS) {
      throw new BadRequestException(
        `You can have at most ${MAX_FIELDS} custom columns.`,
      );
    }
    if (active.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(
        'A custom column with that name already exists.',
      );
    }

    const key = await this.uniqueKey(name);
    const max = await this.prisma.leadCustomField.aggregate({
      _max: { position: true },
    });
    const position = (max._max.position ?? -1) + 1;

    return this.prisma.leadCustomField.create({
      data: {
        key,
        name,
        type: dto.type,
        position,
        isActive: dto.isActive ?? true,
        options: options.length ? { create: options } : undefined,
      },
      select: FIELD_SELECT,
    });
  }

  /**
   * Edits a field's label, status, type and options. **The key never changes**, so every
   * stored value, every saved column layout and every form that references this field
   * keeps pointing at it — renaming a field is a label change and nothing else.
   */
  async update(
    id: string,
    dto: UpdateLeadCustomFieldDto,
  ): Promise<LeadCustomFieldDto> {
    const existing = await this.prisma.leadCustomField.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, type: true },
    });
    if (!existing) {
      throw new NotFoundException('That custom field does not exist.');
    }

    const name = dto.name.trim();
    const clash = await this.prisma.leadCustomField.findFirst({
      where: {
        deletedAt: null,
        id: { not: id },
        name: { equals: name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        'A custom column with that name already exists.',
      );
    }

    const inUse = await this.prisma.leadCustomFieldValue.count({
      where: { customFieldId: id },
    });

    // The type is how every stored value is read back. Changing it once values exist
    // would reinterpret them, so it is refused rather than silently applied.
    if (dto.type !== existing.type && inUse > 0) {
      throw new ConflictException(
        `"${existing.name}" already holds ${inUse} value${inUse === 1 ? '' : 's'}, so its field type cannot be changed. Create a new field instead.`,
      );
    }

    const options = normaliseOptions(dto.type, dto.options);
    if (inUse > 0 && dto.type === LeadCustomFieldType.DROP_DOWN) {
      await this.assertOptionsStillCoverValues(id, options);
    }

    // Options are replaced wholesale in the same transaction as the definition, so a
    // half-applied option list is never observable.
    await this.prisma.$transaction([
      this.prisma.leadCustomFieldOption.deleteMany({
        where: { customFieldId: id },
      }),
      this.prisma.leadCustomField.update({
        where: { id },
        data: {
          name,
          type: dto.type,
          isActive: dto.isActive,
          options: options.length ? { create: options } : undefined,
        },
      }),
    ]);

    const updated = await this.prisma.leadCustomField.findUniqueOrThrow({
      where: { id },
      select: FIELD_SELECT,
    });
    return updated;
  }

  /**
   * Soft-deletes a custom field — but only one nothing has been filed under.
   *
   * A field holding values is refused with a 409 that names the count and points at the
   * Inactive status instead, so a settings screen can never destroy lead data. A field
   * with no values is soft-deleted; its key is retired and the client's reconcileLayout
   * drops it from saved layouts on the next load.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.leadCustomField.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, key: true, name: true },
    });
    if (!existing) {
      throw new NotFoundException('That custom field does not exist.');
    }

    const inUse = await this.prisma.leadCustomFieldValue.count({
      where: { customFieldId: id },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `"${existing.name}" holds ${inUse} lead value${inUse === 1 ? '' : 's'}. Set it to Inactive instead of deleting it.`,
      );
    }

    /*
      The field's place on every configured form goes with it. Leaving those rows behind
      would leave a form referencing a key that no longer exists, and the form builder
      would then refuse to save it — locking a form because of an unrelated delete.
    */
    await this.prisma.$transaction([
      this.prisma.leadFormField.deleteMany({
        where: { fieldKey: existing.key },
      }),
      this.prisma.leadCustomField.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    ]);
  }

  /**
   * Validates and normalises the custom values on a lead create/update against their
   * definitions: an unknown/inactive field id, a duplicate, a type-wrong value (a
   * non-number in a NUMBER field, an unparseable DATE) or a dropdown value that is not
   * one of the field's own options is a 400. Blank values are dropped, so an empty field
   * simply has no row — and on update the full-replace clears a value the user emptied.
   */
  async prepareValues(
    values: CustomFieldValueDto[] | undefined,
  ): Promise<{ customFieldId: string; value: string }[]> {
    if (!values?.length) return [];

    const ids = [...new Set(values.map((v) => v.fieldId))];
    const fields = await this.prisma.leadCustomField.findMany({
      where: { id: { in: ids }, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        options: { select: { label: true } },
      },
    });
    const byId = new Map(fields.map((f) => [f.id, f]));

    const prepared: { customFieldId: string; value: string }[] = [];
    const seen = new Set<string>();
    for (const entry of values) {
      const field = byId.get(entry.fieldId);
      if (!field) {
        throw new BadRequestException(
          'One or more custom fields do not exist.',
        );
      }
      if (seen.has(entry.fieldId)) {
        throw new BadRequestException(
          `Duplicate value for custom field "${field.name}".`,
        );
      }
      seen.add(entry.fieldId);

      const value = entry.value.trim();
      if (value === '') continue;

      if (field.type === LeadCustomFieldType.DROP_DOWN) {
        if (!field.options.some((option) => option.label === value)) {
          throw new BadRequestException(
            `"${value}" is not an option of "${field.name}".`,
          );
        }
      } else {
        assertValueType(field.name, field.type, value);
      }
      prepared.push({ customFieldId: field.id, value });
    }
    return prepared;
  }

  /**
   * An option a lead already holds cannot be renamed away underneath it: the value *is*
   * the label, so dropping the option would leave a lead pointing at a choice the field
   * no longer offers.
   */
  private async assertOptionsStillCoverValues(
    id: string,
    options: { label: string; position: number }[],
  ): Promise<void> {
    const used = await this.prisma.leadCustomFieldValue.findMany({
      where: { customFieldId: id },
      select: { value: true },
      distinct: ['value'],
    });
    const offered = new Set(options.map((option) => option.label));
    const orphaned = used
      .map((row) => row.value)
      .filter((value) => !offered.has(value));

    if (orphaned.length > 0) {
      throw new ConflictException(
        `${orphaned.slice(0, 3).join(', ')} ${orphaned.length === 1 ? 'is' : 'are'} still selected on existing leads, so ${orphaned.length === 1 ? 'that option' : 'those options'} cannot be removed or renamed.`,
      );
    }
  }

  /** "cf_<slug>", unique across all rows; suffixes `_2`, `_3`, … on collision. */
  private async uniqueKey(name: string): Promise<string> {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, KEY_MAX - 3);
    const base = `cf_${slug || 'field'}`.slice(0, KEY_MAX);

    for (let n = 0; n < 1000; n++) {
      const candidate =
        n === 0 ? base : `${base.slice(0, KEY_MAX - 5)}_${n + 1}`;
      const clash = await this.prisma.leadCustomField.findUnique({
        where: { key: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new BadRequestException('Could not generate a unique column key.');
  }
}

/**
 * The option list's cross-field rules: a dropdown needs options, nothing else may carry
 * them, no label repeats, and positions are renumbered 1..n so the stored order is
 * contiguous whatever the client sent.
 */
function normaliseOptions(
  type: LeadCustomFieldType,
  options: LeadCustomFieldOptionDto[] | undefined,
): { label: string; position: number }[] {
  const rows = options ?? [];

  if (type !== LeadCustomFieldType.DROP_DOWN) {
    if (rows.length > 0) {
      throw new BadRequestException('Only a Drop Down field has options.');
    }
    return [];
  }

  if (rows.length === 0) {
    throw new BadRequestException(
      'A Drop Down field needs at least one option.',
    );
  }
  if (rows.length > MAX_FIELD_OPTIONS) {
    throw new BadRequestException(
      `A Drop Down field can have at most ${MAX_FIELD_OPTIONS} options.`,
    );
  }

  const labels = rows.map((row) => row.label.trim());
  if (labels.some((label) => label === '')) {
    throw new BadRequestException('An option cannot be blank.');
  }
  const lowered = labels.map((label) => label.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    throw new BadRequestException('An option cannot be listed twice.');
  }

  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.position - b.row.position || a.index - b.index)
    .map(({ row }, index) => ({
      label: row.label.trim(),
      position: index + 1,
    }));
}

/** TEXT/TEXTBOX accept any string; NUMBER must parse as a number; DATE/DATETIME must
 * parse as a date. Empty values never reach here (they are dropped upstream). */
function assertValueType(
  name: string,
  type: LeadCustomFieldType,
  value: string,
): void {
  switch (type) {
    case 'NUMBER':
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        throw new BadRequestException(`"${name}" must be a number.`);
      }
      return;
    case 'DATE':
    case 'DATETIME':
      if (Number.isNaN(Date.parse(value))) {
        throw new BadRequestException(`"${name}" must be a valid date.`);
      }
      return;
    default:
      return;
  }
}
