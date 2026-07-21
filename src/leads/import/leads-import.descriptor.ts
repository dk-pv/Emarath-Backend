import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { CurrentUser } from '../../auth/current-user';
import { ImportDescriptor } from '../../common/import/import-descriptor';
import { LEADS_IMPORT_FIELDS } from './leads-import.fields';
import { LeadsImportRepository, PreparedLead } from './leads-import.repository';

/** What one Leads import run carries into row-building and persistence. */
export interface LeadsImportContext {
  pipeline: string;
  user: CurrentUser;
}

/**
 * The Leads descriptor (LEAD-07.1): the only module-specific half of an import.
 *
 * It turns a validated, mapped row into a `Lead` create row — applying the same
 * Workpex defaults and the same sales-agent auto-assignment as `LeadsService.create`
 * (an agent must be able to see the leads they imported) — and delegates dedupe and
 * the batch write to the repository. The engine drives everything else.
 */
@Injectable()
export class LeadsImportDescriptor implements ImportDescriptor<
  PreparedLead,
  LeadsImportContext
> {
  readonly module = 'leads';
  readonly fields = LEADS_IMPORT_FIELDS;
  readonly dedupeField = 'primaryPhone';

  constructor(private readonly repository: LeadsImportRepository) {}

  findExistingDuplicates(values: string[]): Promise<Set<string>> {
    return this.repository.existingPhones(values);
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
      language: mapped.language ?? null,
      country: mapped.country ?? null,
      source: mapped.source ?? null,
      // Defaults mirror LeadsService.create so imported and hand-entered leads agree.
      status: mapped.status || 'New',
      pipeline: context.pipeline,
      product: mapped.product ?? null,
      productQty: mapped.productQty ?? null,
      product2: mapped.product2 ?? null,
      product2Qty: mapped.product2Qty ?? null,
      bookingDate: mapped.bookingDate
        ? new Date(`${mapped.bookingDate}T00:00:00.000Z`)
        : null,
      category: mapped.category ?? null,
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

    const assignToUserId =
      context.user.role === UserRole.SALES_AGENT ? context.user.id : null;

    return { data, assignToUserId };
  }

  // The context is unused here — the pipeline/user were already baked into each
  // record by buildRecord — so the method takes only what it needs.
  persistBatch(records: PreparedLead[]): Promise<void> {
    return this.repository.insertLeads(records);
  }
}
