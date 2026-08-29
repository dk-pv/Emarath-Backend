import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { DEFAULT_PIPELINE } from '../stages/stage.constants';

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env['DATABASE_URL_UNPOOLED'] ?? '',
    }),
  });
  const P = (label: string, ok: boolean, detail = '') =>
    console.log(
      `[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`,
    );
  try {
    const activeLeads = await prisma.lead.count({ where: { deletedAt: null } });
    const softDeleted = await prisma.lead.count({
      where: { deletedAt: { not: null } },
    });
    const activities = await prisma.activity.count({
      where: { deletedAt: null },
    });
    P('Active leads', activeLeads === 280, String(activeLeads));
    P(
      'Pre-existing QA leads soft-deleted (reversible)',
      softDeleted >= 262,
      String(softDeleted),
    );
    // At least the fixture's 420 — a follow-up created through the UI on top of the
    // dataset is healthy data, not a failure.
    P(
      'Active activities (at least the fixture 420)',
      activities >= 420,
      String(activities),
    );

    const orphanActivities = await prisma.activity.count({
      where: { deletedAt: null, lead: { deletedAt: { not: null } } },
    });
    P(
      'No active activity points at a retired lead',
      orphanActivities === 0,
      String(orphanActivities),
    );

    const noAssignee = await prisma.activity.count({
      where: { deletedAt: null, assignees: { none: {} } },
    });
    P(
      'Every activity has at least one assignee',
      noAssignee === 0,
      String(noAssignee),
    );

    // Scoped to the live dataset: soft-deleting a lead does not cascade its join
    // rows, so an unscoped count would include links on retired leads.
    const assigneeRows = await prisma.activityAssignee.count({
      where: { activity: { deletedAt: null } },
    });
    const leadAssignmentRows = await prisma.leadAssignment.count({
      where: { lead: { deletedAt: null } },
    });
    const leadTagRows = await prisma.leadTag.count({
      where: { lead: { deletedAt: null } },
    });
    console.log(
      `      ActivityAssignee=${assigneeRows} LeadAssignment=${leadAssignmentRows} LeadTag=${leadTagRows}`,
    );

    const agentsOnActivities = await prisma.activityAssignee.groupBy({
      by: ['userId'],
      where: { activity: { deletedAt: null } },
      _count: true,
    });
    const agentsOnLeads = await prisma.leadAssignment.groupBy({
      by: ['userId'],
      where: { lead: { deletedAt: null } },
      _count: true,
    });
    P(
      'Activities spread across many agents',
      agentsOnActivities.length >= 15,
      `${agentsOnActivities.length} agents`,
    );
    P(
      'Leads spread across many agents',
      agentsOnLeads.length >= 15,
      `${agentsOnLeads.length} agents`,
    );
    const max = Math.max(...agentsOnLeads.map((a) => a._count));
    P(
      'No single agent holds most leads',
      max < activeLeads * 0.25,
      `busiest agent holds ${max}`,
    );

    const unassignedLeads = await prisma.lead.count({
      where: { deletedAt: null, assignments: { none: {} } },
    });
    P(
      'Every active lead is assigned',
      unassignedLeads === 0,
      String(unassignedLeads),
    );

    const taggedLeads = await prisma.lead.count({
      where: { deletedAt: null, tags: { some: {} } },
    });
    console.log(`      tagged leads=${taggedLeads}`);

    const stages = await prisma.stage.findMany({
      where: { pipeline: DEFAULT_PIPELINE },
      select: { name: true },
    });
    const names = new Set(stages.map((s) => s.name));
    const leads = await prisma.lead.findMany({
      where: { deletedAt: null },
      select: { status: true, pipeline: true },
    });
    const badCombo = leads.filter(
      (l) => l.pipeline !== DEFAULT_PIPELINE || !names.has(l.status),
    );
    P(
      'No invalid pipeline/status combination',
      badCombo.length === 0,
      `${badCombo.length} bad`,
    );

    const callsWithEnd = await prisma.activity.count({
      where: { deletedAt: null, type: 'CALL', endAt: { not: null } },
    });
    P('No CALL carries an endAt', callsWithEnd === 0, String(callsWithEnd));

    const withEnd = await prisma.activity.count({
      where: { deletedAt: null, endAt: { not: null } },
    });
    console.log(`      MEETING/TASK with endAt=${withEnd}`);

    const perLead = await prisma.activity.groupBy({
      by: ['leadId'],
      where: { deletedAt: null },
      _count: true,
    });
    const counts = perLead.map((p) => p._count);
    P(
      'Leads carrying activities',
      perLead.length === 180,
      `${perLead.length} leads, ${Math.min(...counts)}–${Math.max(...counts)} each`,
    );
    P(
      'Leads deliberately without activities',
      activeLeads - perLead.length === 100,
      String(activeLeads - perLead.length),
    );

    const dupIds = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
      'SELECT count(*)::bigint AS c FROM (SELECT id FROM activities GROUP BY id HAVING count(*) > 1) t',
    );
    P('No duplicate activity ids', Number(dupIds[0]?.c ?? 0) === 0);

    const invalidDates = await prisma.activity.count({
      where: { deletedAt: null, dueAt: { lt: new Date('2000-01-01') } },
    });
    P('No invalid dueAt', invalidDates === 0, String(invalidDates));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
