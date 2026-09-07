import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LEAD_SYSTEM_FIELDS,
  REQUIRED_LEAD_FIELD_KEYS,
} from './lead-system-fields';
import {
  AvailableFormField,
  FormModule,
  LeadFormFieldDto,
  LeadFormFieldItem,
  LeadFormItem,
  LeadFormPage,
  LeadFormSectionDto,
  ListLeadFormsQueryDto,
  MAX_FORM_NAME,
  MAX_FORM_SECTIONS,
  SaveLeadFormDto,
} from './dto/lead-form.dto';

const DEFAULT_PAGE_SIZE = 10;
const MAX_FORMS = 100;

const FORM_SELECT = {
  id: true,
  name: true,
  module: true,
  isActive: true,
  isDefault: true,
  createdByName: true,
  createdAt: true,
  updatedAt: true,
  fields: {
    orderBy: { position: 'asc' },
    select: {
      fieldKey: true,
      position: true,
      isVisible: true,
      section: { select: { name: true } },
    },
  },
  sections: {
    orderBy: { position: 'asc' },
    select: { name: true, position: true },
  },
} satisfies Prisma.LeadFormSelect;

type FormRow = Prisma.LeadFormGetPayload<{ select: typeof FORM_SELECT }>;

/**
 * Configured lead forms (Settings > Data & Schema Management > Form Customization,
 * ADR-0072).
 *
 * A form is an *arrangement*, never a definition: it references fields by stable key —
 * a system field's own form-state key, or a custom field's "cf_<slug>" — and stores
 * where each one sits and whether it is shown. Renaming a custom field therefore leaves
 * every form untouched, and hiding a field on one form says nothing about any other.
 */
@Injectable()
export class LeadFormsService {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of the Settings list, newest first, with each form's field configuration. */
  async page(query: ListLeadFormsQueryDto): Promise<LeadFormPage> {
    const page = query.page ?? 1;
    const size = query.size ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.LeadFormWhereInput = {
      deletedAt: null,
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [rows, total, labels] = await this.prisma.$transaction([
      this.prisma.leadForm.findMany({
        where,
        // The default first, then newest — the reference lists it last, but its own
        // ordering is not evidenced, and a stable key breaks ties either way.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * size,
        take: size,
        select: FORM_SELECT,
      }),
      this.prisma.leadForm.count({ where }),
      this.prisma.leadCustomField.findMany({
        where: { deletedAt: null },
        select: { key: true, name: true },
      }),
    ]);

    const custom = new Map(labels.map((field) => [field.key, field.name]));
    return { rows: rows.map((row) => toItem(row, custom)), total };
  }

  /** One form's complete configuration, for the Edit dialog. */
  async byId(id: string): Promise<LeadFormItem> {
    const row = await this.prisma.leadForm.findFirst({
      where: { id, deletedAt: null },
      select: FORM_SELECT,
    });
    if (!row) throw new NotFoundException('That form does not exist.');
    return toItem(row, await this.customLabels());
  }

  /**
   * The module's default form — the arrangement the Lead drawer renders.
   *
   * Readable by any signed-in user: an agent's own New Lead drawer has to honour the
   * configured order and visibility, and it cannot honour what it may not read. Null when
   * no form has been made default, which the drawer treats as "use the shipped order".
   */
  async defaultForm(module: FormModule): Promise<LeadFormItem | null> {
    const row = await this.prisma.leadForm.findFirst({
      where: { deletedAt: null, module, isDefault: true, isActive: true },
      select: FORM_SELECT,
    });
    if (!row) return null;
    return toItem(row, await this.customLabels());
  }

  /**
   * Every field a form may arrange: the Lead record's own fields plus the active custom
   * fields. Custom fields are appended in their column order, so the builder's list reads
   * the way the Leads table does.
   */
  async availableFields(): Promise<AvailableFormField[]> {
    const custom = await this.prisma.leadCustomField.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { position: 'asc' },
      select: {
        key: true,
        name: true,
        type: true,
        options: { orderBy: { position: 'asc' }, select: { label: true } },
      },
    });

    return [
      ...LEAD_SYSTEM_FIELDS.map((field) => ({
        fieldKey: field.key,
        label: field.label,
        isRequired: field.required,
        source: 'SYSTEM' as const,
        type: field.control,
        options: [],
      })),
      ...custom.map((field) => ({
        fieldKey: field.key,
        label: field.name,
        isRequired: false,
        source: 'CUSTOM' as const,
        type: field.type,
        options: field.options.map((option) => option.label),
      })),
    ];
  }

  /**
   * Every key a form is *allowed* to reference: the system fields plus every custom field
   * that still exists, active or not.
   *
   * Deliberately wider than `availableFields`, which only *offers* the active ones. A form
   * saved while a field was active must stay saveable after that field is deactivated —
   * otherwise deactivating one field would lock every form that mentions it.
   */
  private async knownFieldKeys(): Promise<Set<string>> {
    const custom = await this.prisma.leadCustomField.findMany({
      where: { deletedAt: null },
      select: { key: true },
    });
    return new Set<string>([
      ...LEAD_SYSTEM_FIELDS.map((field) => field.key),
      ...custom.map((field) => field.key),
    ]);
  }

  async create(
    dto: SaveLeadFormDto,
    createdByName: string,
  ): Promise<LeadFormItem> {
    const name = dto.name.trim();
    await this.assertNameFree(name, null);

    const count = await this.prisma.leadForm.count({
      where: { deletedAt: null },
    });
    if (count >= MAX_FORMS) {
      throw new BadRequestException(`You can have at most ${MAX_FORMS} forms.`);
    }

    const sections = normaliseSections(dto.sections);
    const fields = await this.normaliseFields(dto.fields, sections);

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await clearDefault(tx, dto.module, null);
      const form = await tx.leadForm.create({
        data: {
          name,
          module: dto.module,
          isActive: dto.isActive,
          isDefault: dto.isDefault,
          createdByName,
          sections: { create: sections },
        },
        select: { id: true },
      });
      await writeFields(tx, form.id, fields);
      return tx.leadForm.findUniqueOrThrow({
        where: { id: form.id },
        select: FORM_SELECT,
      });
    });

    return toItem(created, await this.customLabels());
  }

  /**
   * Updates the existing form rather than creating a second one: the id is the identity,
   * so a renamed form keeps every user assignment that points at it.
   */
  async update(id: string, dto: SaveLeadFormDto): Promise<LeadFormItem> {
    const existing = await this.prisma.leadForm.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, isDefault: true, module: true },
    });
    if (!existing) throw new NotFoundException('That form does not exist.');

    const name = dto.name.trim();
    await this.assertNameFree(name, id);

    // A module always has a default: the way to move it is to make another form the
    // default, which clears this one — not to switch this one off and leave none.
    if (existing.isDefault && !dto.isDefault) {
      throw new ConflictException(
        'Make another form the default instead of clearing this one.',
      );
    }
    if (dto.isDefault && !dto.isActive) {
      throw new BadRequestException('The default form must stay Active.');
    }

    const sections = normaliseSections(dto.sections);
    const fields = await this.normaliseFields(dto.fields, sections);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await clearDefault(tx, dto.module, id);
      // Fields go first: a section cannot be dropped while a field still points at it.
      await tx.leadFormField.deleteMany({ where: { formId: id } });
      await tx.leadFormSection.deleteMany({ where: { formId: id } });
      await tx.leadForm.update({
        where: { id },
        data: {
          name,
          module: dto.module,
          isActive: dto.isActive,
          isDefault: dto.isDefault,
          sections: { create: sections },
        },
        select: { id: true },
      });
      await writeFields(tx, id, fields);
      return tx.leadForm.findUniqueOrThrow({
        where: { id },
        select: FORM_SELECT,
      });
    });

    return toItem(updated, await this.customLabels());
  }

  /**
   * Soft-deletes a form. The default is never deletable, and neither is a form users are
   * still assigned to — deleting it would leave those accounts pointing at nothing.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.leadForm.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        isDefault: true,
        _count: { select: { users: true } },
      },
    });
    if (!existing) throw new NotFoundException('That form does not exist.');

    if (existing.isDefault) {
      throw new ConflictException(
        'The default form cannot be deleted. Make another form the default first.',
      );
    }
    const assigned = existing._count.users;
    if (assigned > 0) {
      throw new ConflictException(
        `${existing.name} is assigned to ${assigned} team member${assigned === 1 ? '' : 's'}. Reassign them before deleting it.`,
      );
    }

    /*
      `name` is unique at the database level, and a unique index does not know about soft
      delete: leaving the name on the deleted row would reserve it forever, and the next
      form to claim it would fail on the constraint rather than on our own check. The name
      is released by suffixing the row's own id — a deleted form is never listed, so the
      suffixed name is never read by anyone.
    */
    await this.prisma.leadForm.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        name: `${existing.name.slice(0, MAX_FORM_NAME - 40)} (deleted ${id.slice(0, 8)})`,
      },
    });
  }

  /** The custom fields' current labels, so a stored key can be rendered as a name. */
  private async customLabels(): Promise<Map<string, string>> {
    const rows = await this.prisma.leadCustomField.findMany({
      where: { deletedAt: null },
      select: { key: true, name: true },
    });
    return new Map(rows.map((row) => [row.key, row.name]));
  }

  private async assertNameFree(
    name: string,
    ignoreId: string | null,
  ): Promise<void> {
    if (name.length > MAX_FORM_NAME) {
      throw new BadRequestException('That form name is too long.');
    }
    const clash = await this.prisma.leadForm.findFirst({
      where: {
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(`${name} is already a form name.`);
    }
  }

  /**
   * The builder's cross-field rules: every key must be a real field, no key twice, the
   * four fields a lead cannot be created without must be present and visible, and
   * positions are renumbered 1..n so the stored order is contiguous whatever was sent.
   */
  private async normaliseFields(
    fields: LeadFormFieldDto[],
    sections: { name: string; position: number }[],
  ): Promise<
    {
      fieldKey: string;
      position: number;
      isVisible: boolean;
      sectionName: string | null;
    }[]
  > {
    const known = await this.knownFieldKeys();
    const labels = new Map<string, string>(
      LEAD_SYSTEM_FIELDS.map((field) => [field.key, field.label]),
    );

    const keys = fields.map((field) => field.fieldKey);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('A field can appear on a form only once.');
    }

    for (const key of keys) {
      if (!known.has(key)) {
        throw new BadRequestException(
          `"${key}" is not a field of this module.`,
        );
      }
    }

    for (const required of REQUIRED_LEAD_FIELD_KEYS) {
      const entry = fields.find((field) => field.fieldKey === required);
      const label = labels.get(required) ?? required;
      if (!entry) {
        throw new BadRequestException(
          `${label} is required to create a lead, so it must stay on the form.`,
        );
      }
      if (!entry.isVisible) {
        throw new BadRequestException(
          `${label} is required to create a lead, so it cannot be hidden.`,
        );
      }
    }

    // Every section a field claims must be one the same payload declares — otherwise a
    // field would land in a group the form does not have.
    const declared = new Set(sections.map((section) => section.name));
    for (const field of fields) {
      const section = field.sectionName ?? null;
      if (section !== null && !declared.has(section)) {
        throw new BadRequestException(
          `"${section}" is not a section of this form.`,
        );
      }
    }

    return [...fields]
      .map((field, index) => ({ field, index }))
      .sort((a, b) => a.field.position - b.field.position || a.index - b.index)
      .map(({ field }, index) => ({
        fieldKey: field.fieldKey,
        position: index + 1,
        isVisible: field.isVisible,
        sectionName: field.sectionName ?? null,
      }));
  }
}

/**
 * The form's sections: no blank name, no name twice, renumbered 1..n so the stored order
 * is contiguous whatever the client sent.
 */
function normaliseSections(
  sections: LeadFormSectionDto[] | undefined,
): { name: string; position: number }[] {
  const rows = sections ?? [];
  if (rows.length > MAX_FORM_SECTIONS) {
    throw new BadRequestException(
      `A form can have at most ${MAX_FORM_SECTIONS} sections.`,
    );
  }

  const names = rows.map((section) => section.name.trim());
  if (names.some((name) => name === '')) {
    throw new BadRequestException('Section Name is required.');
  }
  const lowered = names.map((name) => name.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    throw new BadRequestException('A section name is used twice.');
  }

  return [...rows]
    .map((section, index) => ({ section, index }))
    .sort(
      (a, b) => a.section.position - b.section.position || a.index - b.index,
    )
    .map(({ section }, index) => ({
      name: section.name.trim(),
      position: index + 1,
    }));
}

/**
 * Writes the field rows once their sections exist, resolving each field's section name to
 * the row that was just created. A name is the stable address here: section ids are minted
 * inside this transaction, so the client cannot have sent one.
 */
async function writeFields(
  tx: Prisma.TransactionClient,
  formId: string,
  fields: {
    fieldKey: string;
    position: number;
    isVisible: boolean;
    sectionName: string | null;
  }[],
): Promise<void> {
  const sections = await tx.leadFormSection.findMany({
    where: { formId },
    select: { id: true, name: true },
  });
  const byName = new Map(sections.map((section) => [section.name, section.id]));

  await tx.leadFormField.createMany({
    data: fields.map((field) => ({
      formId,
      fieldKey: field.fieldKey,
      position: field.position,
      isVisible: field.isVisible,
      sectionId:
        field.sectionName === null
          ? null
          : (byName.get(field.sectionName) ?? null),
    })),
  });
}

/** Clears the module's current default so exactly one form ever holds it. */
function clearDefault(
  tx: Prisma.TransactionClient,
  module: string,
  exceptId: string | null,
): Promise<unknown> {
  return tx.leadForm.updateMany({
    where: {
      deletedAt: null,
      module,
      isDefault: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { isDefault: false },
  });
}

/** A stored row into the response shape, resolving each key to its current label. */
function toItem(row: FormRow, customLabels: Map<string, string>): LeadFormItem {
  const system = new Map(
    LEAD_SYSTEM_FIELDS.map((field) => [field.key as string, field]),
  );

  const fields: LeadFormFieldItem[] = row.fields.map((field) => {
    const builtIn = system.get(field.fieldKey);
    return {
      fieldKey: field.fieldKey,
      label:
        builtIn?.label ?? customLabels.get(field.fieldKey) ?? field.fieldKey,
      position: field.position,
      isVisible: field.isVisible,
      isRequired: builtIn?.required ?? false,
      source: builtIn ? 'SYSTEM' : 'CUSTOM',
      sectionName: field.section?.name ?? null,
    };
  });

  return {
    id: row.id,
    name: row.name,
    module: row.module as FormModule,
    isActive: row.isActive,
    isDefault: row.isDefault,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    fields,
    sections: row.sections.map((section) => ({
      name: section.name,
      position: section.position,
    })),
  };
}
