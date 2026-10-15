import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadAuditContext, recordLeadsCreated } from '../lead-audit';
import { DuplicateMatchCandidate, pickOriginal } from '../lead-duplicates';

/** One import-ready lead: the create-many row plus, for a sales-agent or sales-manager
 * import, the assignment that keeps the lead inside the importer's scope. */
export interface PreparedLead {
  data: Prisma.LeadCreateManyInput & { id: string };
  assignToUserId: string | null;
}

/** Postgres caps the `IN` list; chunk the dedupe lookup well under it. */
const LOOKUP_CHUNK = 1000;

/**
 * The Leads side of the import (LEAD-07.1): the duplicate lookup and the batch
 * insert. Kept separate from `LeadsRepository` (reads) so the import's write path
 * and the list's read path never entangle.
 */
@Injectable()
export class LeadsImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Which of these phones and emails an existing lead already holds — the matching
   * rule of the New Lead form's duplicate check (`duplicateWhere`): a phone matches
   * either phone column, an email matches ignoring case, and archived leads count only
   * when Duplicate Settings says so.
   *
   * Global, not scoped: a phone that exists for any agent is still a duplicate, so
   * the import must not create a second lead for it. Only the contact values come
   * back — never the owning lead — so dedupe never leaks another agent's data.
   * Emails come back lower-cased.
   */
  async existingContacts(
    phones: string[],
    emails: string[],
    includeArchived: boolean,
  ): Promise<{ phones: Set<string>; emails: Set<string> }> {
    const archived = includeArchived ? {} : { deletedAt: null };
    const found = { phones: new Set<string>(), emails: new Set<string>() };

    for (let start = 0; start < phones.length; start += LOOKUP_CHUNK) {
      const chunk = phones.slice(start, start + LOOKUP_CHUNK);
      const rows = await this.prisma.lead.findMany({
        where: {
          ...archived,
          OR: [
            { primaryPhone: { in: chunk } },
            { secondaryPhone: { in: chunk } },
          ],
        },
        select: { primaryPhone: true, secondaryPhone: true },
      });
      for (const row of rows) {
        found.phones.add(row.primaryPhone);
        if (row.secondaryPhone) found.phones.add(row.secondaryPhone);
      }
    }

    for (let start = 0; start < emails.length; start += LOOKUP_CHUNK) {
      const chunk = emails.slice(start, start + LOOKUP_CHUNK);
      const rows = await this.prisma.lead.findMany({
        where: { ...archived, email: { in: chunk, mode: 'insensitive' } },
        select: { email: true },
      });
      for (const row of rows) {
        if (row.email) found.emails.add(row.email.toLowerCase());
      }
    }

    return found;
  }

  /**
   * Which lead each record duplicates (ADR-0092), by record id. A record is a duplicate of the
   * original (`pickOriginal`) among the existing leads sharing any of its phones or its email
   * — and, failing that, of an earlier record in this same batch, whose id is already known
   * because ids are pre-generated. Earlier batches of the same run are already in the table, so
   * they are found as existing leads. A record with no match is absent from the map.
   *
   * One chunked lookup for the whole batch rather than one per row, the same shape as
   * `existingContacts`.
   */
  async originalsFor(
    records: PreparedLead[],
    includeArchived: boolean,
  ): Promise<Map<string, string>> {
    const phonesOf = (record: PreparedLead) =>
      [record.data.primaryPhone, record.data.secondaryPhone].filter(
        (phone): phone is string => Boolean(phone),
      );
    const emailOf = (record: PreparedLead) =>
      record.data.email?.toLowerCase() ?? null;

    const phones = [...new Set(records.flatMap(phonesOf))];
    const emails = [
      ...new Set(
        records.map(emailOf).filter((email): email is string => email !== null),
      ),
    ];

    const existing = await this.matchingLeads(phones, emails, includeArchived);
    const byPhone = new Map<string, DuplicateMatchCandidate[]>();
    const byEmail = new Map<string, DuplicateMatchCandidate[]>();
    const push = (
      index: Map<string, DuplicateMatchCandidate[]>,
      value: string | null,
      lead: DuplicateMatchCandidate,
    ) => {
      if (value) index.set(value, [...(index.get(value) ?? []), lead]);
    };
    for (const row of existing) {
      const lead = {
        id: row.id,
        createdAt: row.createdAt,
        duplicateOfId: row.duplicateOfId,
      };
      push(byPhone, row.primaryPhone, lead);
      push(byPhone, row.secondaryPhone, lead);
      push(byEmail, row.email?.toLowerCase() ?? null, lead);
    }

    const originals = new Map<string, string>();
    const earlierByPhone = new Map<string, DuplicateMatchCandidate[]>();
    const earlierByEmail = new Map<string, DuplicateMatchCandidate[]>();
    // Later than every existing lead, and in file order among themselves.
    const stamp = Date.now();

    records.forEach((record, position) => {
      const email = emailOf(record);
      const lookup = (
        phoneIndex: Map<string, DuplicateMatchCandidate[]>,
        emailIndex: Map<string, DuplicateMatchCandidate[]>,
      ) => [
        ...phonesOf(record).flatMap((phone) => phoneIndex.get(phone) ?? []),
        ...(email ? (emailIndex.get(email) ?? []) : []),
      ];

      // Existing leads are older than anything in this batch, so they win when present.
      const original =
        pickOriginal(lookup(byPhone, byEmail)) ??
        pickOriginal(lookup(earlierByPhone, earlierByEmail));
      if (original) originals.set(record.data.id, original);

      const self: DuplicateMatchCandidate = {
        id: record.data.id,
        createdAt: new Date(stamp + position),
        duplicateOfId: original ?? null,
      };
      phonesOf(record).forEach((phone) => push(earlierByPhone, phone, self));
      push(earlierByEmail, email, self);
    });
    return originals;
  }

  /** Existing leads holding any of these phones (either column) or emails (any case). */
  private async matchingLeads(
    phones: string[],
    emails: string[],
    includeArchived: boolean,
  ) {
    const archived = includeArchived ? {} : { deletedAt: null };
    const select = {
      id: true,
      createdAt: true,
      duplicateOfId: true,
      primaryPhone: true,
      secondaryPhone: true,
      email: true,
    } satisfies Prisma.LeadSelect;
    const rows = new Map<
      string,
      Prisma.LeadGetPayload<{ select: typeof select }>
    >();

    for (let start = 0; start < phones.length; start += LOOKUP_CHUNK) {
      const chunk = phones.slice(start, start + LOOKUP_CHUNK);
      const found = await this.prisma.lead.findMany({
        where: {
          ...archived,
          OR: [
            { primaryPhone: { in: chunk } },
            { secondaryPhone: { in: chunk } },
          ],
        },
        select,
      });
      found.forEach((row) => rows.set(row.id, row));
    }
    for (let start = 0; start < emails.length; start += LOOKUP_CHUNK) {
      const chunk = emails.slice(start, start + LOOKUP_CHUNK);
      const found = await this.prisma.lead.findMany({
        where: { ...archived, email: { in: chunk, mode: 'insensitive' } },
        select,
      });
      found.forEach((row) => rows.set(row.id, row));
    }
    return [...rows.values()];
  }

  /**
   * Inserts one batch of leads and their creator-assignments in a single
   * transaction, so a batch either lands whole or not at all. Ids are pre-generated
   * (see the descriptor), which is what lets both the leads and their assignments
   * go in as `createMany` rather than row-by-row. Each lead's creation is recorded in
   * the same transaction (ADR-0083), and a lead that duplicates another is written with
   * the link to it (ADR-0092) — it is created either way, never skipped.
   */
  async insertLeads(
    records: PreparedLead[],
    audit: LeadAuditContext,
    includeArchived = false,
  ): Promise<void> {
    if (records.length === 0) return;

    const originals = await this.originalsFor(records, includeArchived);

    const assignments = records
      .filter((record) => record.assignToUserId)
      .map((record) => ({
        leadId: record.data.id,
        userId: record.assignToUserId as string,
      }));

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.createMany({
        data: records.map((record) => ({
          ...record.data,
          duplicateOfId: originals.get(record.data.id) ?? null,
        })),
      });
      if (assignments.length) {
        await tx.leadAssignment.createMany({
          data: assignments,
          skipDuplicates: true,
        });
      }
      await recordLeadsCreated(
        tx,
        records.map((record) => record.data.id),
        audit,
      );
    });
  }
}
