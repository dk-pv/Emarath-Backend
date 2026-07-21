import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** One import-ready lead: the create-many row plus, for a sales-agent import, the
 * assignment that keeps the lead inside the importer's scope. */
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
   * The Primary Phone values already present on a non-deleted lead.
   *
   * Global, not scoped: a phone that exists for any agent is still a duplicate, so
   * the import must not create a second lead for it. Only the phone comes back —
   * never the owning lead — so dedupe never leaks another agent's data.
   */
  async existingPhones(phones: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let start = 0; start < phones.length; start += LOOKUP_CHUNK) {
      const chunk = phones.slice(start, start + LOOKUP_CHUNK);
      const rows = await this.prisma.lead.findMany({
        where: { deletedAt: null, primaryPhone: { in: chunk } },
        select: { primaryPhone: true },
      });
      for (const row of rows) found.add(row.primaryPhone);
    }
    return found;
  }

  /**
   * Inserts one batch of leads and their creator-assignments in a single
   * transaction, so a batch either lands whole or not at all. Ids are pre-generated
   * (see the descriptor), which is what lets both the leads and their assignments
   * go in as `createMany` rather than row-by-row.
   */
  async insertLeads(records: PreparedLead[]): Promise<void> {
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
    });
  }
}
