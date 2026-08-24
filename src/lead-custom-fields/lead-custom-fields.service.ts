import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadCustomFieldType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLeadCustomFieldDto,
  LeadCustomFieldDto,
} from './dto/lead-custom-field.dto';
import { CustomFieldValueDto } from '../leads/dto/custom-field-value.dto';

/** At most this many custom columns — matches the view-preference column cap so a
 * saved layout can always carry every field. */
const MAX_FIELDS = 100;
/** "cf_" + slug, kept within the view-preference COLUMN_KEY 64-char budget. */
const KEY_MAX = 64;

/**
 * Custom-column definitions and per-lead value validation (LEAD-05.1, ADR-0051).
 *
 * App-global: the platform is single-tenant, so a field defined once is available to
 * everyone; per-user visibility/order lives in UserViewPreference, not here. Injects
 * PrismaService directly — the store is a handful of statements over two tables, and
 * a repository here would be the speculative abstraction the standards forbid.
 */
@Injectable()
export class LeadCustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active custom fields in display order. */
  async list(): Promise<LeadCustomFieldDto[]> {
    return this.prisma.leadCustomField.findMany({
      where: { deletedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, key: true, name: true, type: true, position: true },
    });
  }

  /**
   * Creates a custom column: a unique display name, a derived stable "cf_<slug>" key,
   * and the next position. Duplicate active names are rejected (409); the key is made
   * unique against every row, including soft-deleted ones, so it never resurrects a
   * deleted field's data.
   */
  async create(dto: CreateLeadCustomFieldDto): Promise<LeadCustomFieldDto> {
    const name = dto.name.trim();

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
      data: { key, name, type: dto.type, position },
      select: { id: true, key: true, name: true, type: true, position: true },
    });
  }

  /**
   * Soft-deletes a custom column. Its values are left in place but no longer projected
   * onto rows; the client's reconcileLayout drops the missing key from saved layouts
   * on the next load, so no user is stranded with a dead column.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.leadCustomField.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('That custom column does not exist.');
    }
    await this.prisma.leadCustomField.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Validates and normalises the custom values on a lead create/update against their
   * definitions: an unknown/inactive field id, a duplicate, or a type-wrong value (a
   * non-number in a NUMBER field, an unparseable DATE) is a 400. Blank values are
   * dropped, so an empty field simply has no row — and on update the full-replace
   * clears a value the user emptied. Returns the rows to write.
   */
  async prepareValues(
    values: CustomFieldValueDto[] | undefined,
  ): Promise<{ customFieldId: string; value: string }[]> {
    if (!values?.length) return [];

    const ids = [...new Set(values.map((v) => v.fieldId))];
    const fields = await this.prisma.leadCustomField.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true, type: true },
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

      assertValueType(field.name, field.type, value);
      prepared.push({ customFieldId: field.id, value });
    }
    return prepared;
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
