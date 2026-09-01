import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadsByOwnershipWhere } from './leads-by-ownership-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('buildLeadsByOwnershipWhere', () => {
  it('is just the scoped leads where when no team is given', () => {
    const where = buildLeadsByOwnershipWhere(admin, {});
    // No team → no AND wrapper, just the reused leads where (org-wide for admin).
    expect(where.AND).toBeUndefined();
    expect(where.deletedAt).toBeNull();
  });

  it('ANDs the reused team predicate on top of the scoped leads where', () => {
    const where = buildLeadsByOwnershipWhere(admin, { team: ['Sales'] });
    expect(where.AND).toHaveLength(2);
    expect(where.AND?.[1]).toEqual({
      assignments: { some: { user: { team: { in: ['Sales'] } } } },
    });
  });

  it('threads the period window into the reused createdAt filter', () => {
    const from = '2026-07-01T00:00:00.000Z';
    const where = buildLeadsByOwnershipWhere(admin, { from });
    expect(JSON.stringify(where)).toContain('createdAt');
    expect(JSON.stringify(where)).toContain(from.slice(0, 10));
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    const where = buildLeadsByOwnershipWhere(agent, { team: ['Sales'] });
    expect(JSON.stringify(where)).toContain('"userId":"agent-1"');
  });

  it('passes agent, source, pipeline and the status-changed window through', () => {
    const json = JSON.stringify(
      buildLeadsByOwnershipWhere(admin, {
        agent: ['11111111-1111-4111-8111-111111111111'],
        source: ['Broadcast'],
        pipeline: 'LOGISTICS',
        from: '2026-07-01T00:00:00.000Z',
        dateField: 'statusChanged',
      }),
    );
    expect(json).toContain('11111111-1111-4111-8111-111111111111');
    expect(json).toContain('Broadcast');
    expect(json).toContain('LOGISTICS');
    expect(json).toContain('statusChangedAt');
  });

  it("passes the unassigned flag through (the legend's Unassigned drill-down)", () => {
    const json = JSON.stringify(
      buildLeadsByOwnershipWhere(admin, { unassigned: true }),
    );
    expect(json).toContain('"none"');
  });
});
