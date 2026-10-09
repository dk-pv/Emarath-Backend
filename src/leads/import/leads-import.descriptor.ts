import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { CurrentUser } from '../../auth/current-user';
import { userActor } from '../../audit/audit-events';
import {
  ImportDescriptor,
  ImportField,
} from '../../common/import/import-descriptor';
import { LookupsService } from '../../lookups/lookups.service';
import { SettingsService } from '../../settings/settings.service';
import { StagesService } from '../../stages/stages.service';
import { LEADS_IMPORT_FIELDS } from './leads-import.fields';
import { LeadsImportRepository, PreparedLead } from './leads-import.repository';

/** What one Leads import run carries into row-building and persistence. */
export interface LeadsImportContext {
  pipeline: string;
  /** The pipeline's first stage — the status of a row whose Lead Status is blank. */
  defaultStatus: string;
  user: CurrentUser;
  /** The run's ImportJob, named on each created lead's audit events (ADR-0083). */
  jobId: string;
}

/** A run's field catalog, with every dropdown-backed field's allowed values filled in. */
export interface LeadsImportRun {
  fields: ImportField[];
  defaultStatus: string;
}

/**
 * The lookup each dropdown-backed field takes its values from — the lists the New Lead
 * form offers (ADR-0088). Lead Status is absent: its values are the chosen pipeline's
 * stages, read per run.
 */
const OPTION_LOOKUPS: Record<string, string> = {
  source: 'sources',
  category: 'categories',
  product: 'products',
  product2: 'products',
  paymentMethod: 'paymentMethods',
  callStatus: 'callStatus',
  language: 'languages',
};

/** The roles that see only assigned leads (their own, or their team's). */
const ASSIGNMENT_SCOPED_ROLES: readonly UserRole[] = [
  UserRole.SALES_AGENT,
  UserRole.SALES_MANAGER,
];

const PHONE_KEY = 'phone ';
const EMAIL_KEY = 'email ';

/**
 * The Leads descriptor (LEAD-07.1): the only module-specific half of an import.
 *
 * It turns a validated, mapped row into a `Lead` create row — applying the same
 * defaults as `LeadsService.create` — checks values against the same lists the New
 * Lead form's dropdowns offer, and delegates dedupe and the batch write to the
 * repository. The engine drives everything else.
 */
@Injectable()
export class LeadsImportDescriptor implements ImportDescriptor<
  PreparedLead,
  LeadsImportContext
> {
  readonly module = 'leads';
  readonly fields = LEADS_IMPORT_FIELDS;

  constructor(
    private readonly repository: LeadsImportRepository,
    private readonly lookups: LookupsService,
    private readonly stages: StagesService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The run's fields for `pipeline`. Refuses a pipeline that does not exist or has no
   * stages: its leads would sit in no Kanban column.
   */
  async prepare(pipeline: string): Promise<LeadsImportRun> {
    const [pipelines, options] = await Promise.all([
      this.lookups.byType('pipelines'),
      this.optionsFor(pipeline),
    ]);
    if (!pipelines.some((option) => option.value === pipeline)) {
      throw new BadRequestException(`Pipeline "${pipeline}" does not exist.`);
    }
    const [defaultStatus] = options.status;
    if (!defaultStatus) {
      throw new BadRequestException(
        `The "${pipeline}" pipeline has no stages yet. Add its stages in Settings before importing into it.`,
      );
    }
    return {
      fields: LEADS_IMPORT_FIELDS.map((field) =>
        options[field.value]
          ? { ...field, options: options[field.value] }
          : field,
      ),
      defaultStatus,
    };
  }

  /**
   * Example rows for the sample file, valid as written for the default pipeline: the
   * first full, the second only what is required (blank cells take the defaults).
   */
  async sampleRows(): Promise<Record<string, string>[]> {
    const [defaultPipeline] = await this.lookups.byType('pipelines');
    const options = await this.optionsFor(defaultPipeline?.value ?? '');
    const first = (field: string) => options[field]?.[0] ?? '';

    return [
      {
        name: 'Ahmed Ali',
        primaryPhone: '971501234567',
        actualAmount: '1500.00',
        paymentMethod: first('paymentMethod'),
        firstName: 'Ahmed',
        secondaryPhone: '971551234567',
        email: 'ahmed.ali@example.com',
        language: first('language'),
        country: 'United Arab Emirates',
        source: first('source'),
        status: first('status'),
        category: first('category'),
        product: first('product'),
        productQty: '1',
        forecastedAmount: '1500.00',
        callStatus: first('callStatus'),
        callAttempts: '1',
        msgAttempts: '0',
        bookingDate: '2026-10-15',
        state: 'Dubai',
        street: 'Sheikh Zayed Road',
        city: 'Dubai',
      },
      { name: 'Sara Khan', primaryPhone: '971559876543' },
    ];
  }

  dedupeKeys(mapped: Record<string, string>): string[] {
    const keys = [mapped.primaryPhone, mapped.secondaryPhone]
      .filter(Boolean)
      .map((phone) => PHONE_KEY + phone);
    if (mapped.email) keys.push(EMAIL_KEY + mapped.email.toLowerCase());
    return keys;
  }

  async findExistingDuplicates(keys: string[]): Promise<Set<string>> {
    const valuesOf = (prefix: string) =>
      keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    const { checkArchivedLeads } = await this.settings.getSalesCrmDuplicate();
    const found = await this.repository.existingContacts(
      valuesOf(PHONE_KEY),
      valuesOf(EMAIL_KEY),
      checkArchivedLeads,
    );
    return new Set([
      ...[...found.phones].map((phone) => PHONE_KEY + phone),
      ...[...found.emails].map((email) => EMAIL_KEY + email),
    ]);
  }

  buildRecord(
    mapped: Record<string, string>,
    context: LeadsImportContext,
  ): PreparedLead {
    // Pre-generated so both the lead and its assignment can go in as createMany.
    const id = randomUUID();

    const data: Prisma.LeadCreateManyInput & { id: string } = {
      id,
      name: mapped.name,
      firstName: mapped.firstName ?? null,
      primaryPhone: mapped.primaryPhone,
      secondaryPhone: mapped.secondaryPhone ?? null,
      email: mapped.email ?? null,
      language: mapped.language ?? null,
      country: mapped.country ?? null,
      source: mapped.source ?? null,
      // Defaults mirror LeadsService.create so imported and hand-entered leads agree.
      status: mapped.status || context.defaultStatus,
      pipeline: context.pipeline,
      product: mapped.product ?? null,
      productQty: mapped.productQty ?? null,
      product2: mapped.product2 ?? null,
      product2Qty: mapped.product2Qty ?? null,
      bookingDate: mapped.bookingDate
        ? new Date(`${mapped.bookingDate}T00:00:00.000Z`)
        : null,
      category: mapped.category || 'Default',
      actualAmount: mapped.actualAmount ?? null,
      forecastedAmount: mapped.forecastedAmount ?? null,
      paymentMethod: mapped.paymentMethod ?? null,
      state: mapped.state ?? null,
      street: mapped.street ?? null,
      city: mapped.city ?? null,
      nationalCode: mapped.nationalCode ?? null,
      callStatus: mapped.callStatus ?? null,
      callAttempts: mapped.callAttempts ? Number(mapped.callAttempts) : 0,
      whatsappAttempts: mapped.msgAttempts ? Number(mapped.msgAttempts) : 0,
    };

    // The New Lead form assigns its creator. An agent or manager sees only assigned
    // leads, so their imports are assigned to them the same way — otherwise the
    // importer could never see what they imported. Org-wide roles leave them unassigned.
    const assignToUserId = ASSIGNMENT_SCOPED_ROLES.includes(context.user.role)
      ? context.user.id
      : null;

    return { data, assignToUserId };
  }

  // The pipeline was already baked into each record by buildRecord; the context here
  // only says who ran the import and which run it was, for the audit events.
  persistBatch(
    records: PreparedLead[],
    context: LeadsImportContext,
  ): Promise<void> {
    return this.repository.insertLeads(records, {
      actor: userActor(context.user),
      source: 'leads.import',
      metadata: { importJobId: context.jobId },
    });
  }

  /** Field value → its allowed values: the pipeline's stages and the form's lookups. */
  private async optionsFor(
    pipeline: string,
  ): Promise<Record<string, string[]>> {
    const types = [...new Set(Object.values(OPTION_LOOKUPS))];
    const [stages, ...lists] = await Promise.all([
      this.stages.list(pipeline),
      ...types.map((type) => this.lookups.byType(type)),
    ]);
    const byType = new Map(
      types.map((type, index) => [
        type,
        lists[index].map((option) => option.value),
      ]),
    );

    const options: Record<string, string[]> = {
      status: stages.map((stage) => stage.name),
    };
    for (const [field, type] of Object.entries(OPTION_LOOKUPS)) {
      options[field] = byType.get(type) ?? [];
    }
    return options;
  }
}
