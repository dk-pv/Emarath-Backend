import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadFirstResponseWhere } from './lead-first-response-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('buildLeadFirstResponseWhere', () => {
  it('is just the scoped leads where when no tab or type filter is given', () => {
    const where = buildLeadFirstResponseWhere(admin, {});
    expect(where.AND).toBeUndefined();
    expect(where.deletedAt).toBeNull();
  });

  it('reads the untouched tab as the shared no-engagement predicate', () => {
    const where = buildLeadFirstResponseWhere(admin, { contact: 'untouched' });
    const added = where.AND?.[1] as Record<string, unknown>;
    expect(added.activities).toEqual({
      none: { deletedAt: null, completedAt: { not: null } },
    });
    expect(added.calls).toEqual({ none: { deletedAt: null, startedAt: {} } });
  });

  it('reads the contacted tab as its negation, so the two tabs partition the set', () => {
    const where = buildLeadFirstResponseWhere(admin, { contact: 'contacted' });
    expect(where.AND?.[1]).toHaveProperty('NOT');
  });

  it('threads search, source and agent through the reused leads where', () => {
    const json = JSON.stringify(
      buildLeadFirstResponseWhere(admin, {
        search: 'ali',
        source: ['Broadcast'],
        agent: ['11111111-1111-4111-8111-111111111111'],
      }),
    );
    expect(json).toContain('Broadcast');
    expect(json).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    expect(JSON.stringify(buildLeadFirstResponseWhere(agent, {}))).toContain(
      '"userId":"agent-1"',
    );
  });

  it("ORs one predicate per kind, in the reference's vocabulary", () => {
    const where = buildLeadFirstResponseWhere(admin, {
      activityType: ['CALL', 'NOTE', 'FOLLOW_UP'],
    });
    expect(where.AND?.[1]).toEqual({
      OR: [
        {
          OR: [
            { calls: { some: { deletedAt: null } } },
            { activities: { some: { deletedAt: null, type: 'CALL' } } },
          ],
        },
        { notes: { some: { deletedAt: null } } },
        { activities: { some: { deletedAt: null } } },
      ],
    });
  });

  it('matches the change kinds by the ids the service resolved in SQL', () => {
    const where = buildLeadFirstResponseWhere(admin, {
      activityType: ['STATUS_CHANGED', 'LEAD_EDITED'],
      changedIds: ['a', 'b'],
    });
    expect(where.AND?.[1]).toEqual({ id: { in: ['a', 'b'] } });
  });

  it('skips the change kinds when the caller resolved no ids', () => {
    const where = buildLeadFirstResponseWhere(admin, {
      activityType: ['STATUS_CHANGED'],
    });
    expect(where.AND).toBeUndefined();
  });
});
