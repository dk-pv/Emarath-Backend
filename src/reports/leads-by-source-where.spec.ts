import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadsBySourceWhere } from './leads-by-source-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('buildLeadsBySourceWhere', () => {
  it('is just the scoped leads where when no team is given', () => {
    const where = buildLeadsBySourceWhere(admin, {});
    // No team → no AND wrapper, just the reused leads where (org-wide for admin).
    expect(where.AND).toBeUndefined();
    expect(where.deletedAt).toBeNull();
  });

  it('ANDs the reused team predicate on top of the scoped leads where', () => {
    const where = buildLeadsBySourceWhere(admin, { team: ['Sales'] });
    expect(where.AND).toHaveLength(2);
    expect(where.AND?.[1]).toEqual({
      assignments: { some: { user: { team: { in: ['Sales'] } } } },
    });
  });

  it('threads the period window into the reused createdAt filter', () => {
    const from = '2026-07-01T00:00:00.000Z';
    const where = buildLeadsBySourceWhere(admin, { from });
    expect(JSON.stringify(where)).toContain('createdAt');
    expect(JSON.stringify(where)).toContain(from.slice(0, 10));
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    const where = buildLeadsBySourceWhere(agent, { team: ['Sales'] });
    expect(JSON.stringify(where)).toContain('"userId":"agent-1"');
  });
});
