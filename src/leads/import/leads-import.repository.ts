import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadAuditContext, recordLeadsCreated } from '../lead-audit';

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
   * Inserts one batch of leads and their creator-assignments in a single
   * transaction, so a batch either lands whole or not at all. Ids are pre-generated
   * (see the descriptor), which is what lets both the leads and their assignments
   * go in as `createMany` rather than row-by-row. Each lead's creation is recorded in
   * the same transaction (ADR-0083).
   */
  async insertLeads(
    records: PreparedLead[],
    audit: LeadAuditContext,
  ): Promise<void> {
    if (records.length === 0) return;

    const assignments = records
      .filter((record) => record.assignToUserId)
      .map((record) => ({
        leadId: record.data.id,
        userId: record.assignToUserId as string,
      }));

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.createMany({ data: records.map((record) => record.data) });
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
