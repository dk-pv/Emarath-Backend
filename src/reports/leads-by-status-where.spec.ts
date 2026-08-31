import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadsByStatusWhere, teamWhere } from './leads-by-status-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('teamWhere', () => {
  it('matches leads assigned to a user on one of the given teams', () => {
    expect(teamWhere(['Sales', 'Support'])).toEqual({
      assignments: { some: { user: { team: { in: ['Sales', 'Support'] } } } },
    });
  });
});

describe('buildLeadsByStatusWhere', () => {
  it('is just the scoped leads where when no team is given', () => {
    const where = buildLeadsByStatusWhere(admin, {});
    // No team → no AND wrapper, just the reused leads where (org-wide for admin).
    expect(where.AND).toBeUndefined();
    expect(where.deletedAt).toBeNull();
  });

  it('ANDs the team predicate on top of the scoped leads where', () => {
    const where = buildLeadsByStatusWhere(admin, { team: ['Sales'] });
    expect(where.AND).toHaveLength(2);
    expect(where.AND?.[1]).toEqual({
      assignments: { some: { user: { team: { in: ['Sales'] } } } },
    });
  });

  it('threads the period window into the reused createdAt filter', () => {
    const from = '2026-07-01T00:00:00.000Z';
    const where = buildLeadsByStatusWhere(admin, { from });
    expect(JSON.stringify(where)).toContain('createdAt');
    expect(JSON.stringify(where)).toContain(from.slice(0, 10));
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    const where = buildLeadsByStatusWhere(agent, { team: ['Sales'] });
    expect(JSON.stringify(where)).toContain('"userId":"agent-1"');
  });

  it('passes agent, status and pipeline through to the reused leads where', () => {
    const where = buildLeadsByStatusWhere(admin, {
      agent: ['11111111-1111-4111-8111-111111111111'],
      status: ['HOT', 'Cold'],
      pipeline: 'LOGISTICS',
    });
    const json = JSON.stringify(where);
    expect(json).toContain('11111111-1111-4111-8111-111111111111');
    expect(json).toContain('HOT');
    expect(json).toContain('Cold');
    expect(json).toContain('LOGISTICS');
  });

  it('moves the window onto statusChangedAt for the status-change date', () => {
    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-08-01T00:00:00.000Z';
    const json = JSON.stringify(
      buildLeadsByStatusWhere(admin, { from, to, dateField: 'statusChanged' }),
    );
    expect(json).toContain('"statusChangedAt"');
    expect(json).toContain(from);
    expect(json).toContain(to);
    expect(json).not.toContain('createdAt');
  });

  it('threads the condition builder payload into the reused leads where', () => {
    const conditions = JSON.stringify([
      { field: 'source', operator: 'is', values: ['Facebook'] },
    ]);
    const json = JSON.stringify(buildLeadsByStatusWhere(admin, { conditions }));
    expect(json).toContain('Facebook');
  });

  it('leaves the new predicates out entirely when none is selected', () => {
    const json = JSON.stringify(buildLeadsByStatusWhere(admin, {}));
    expect(json).not.toContain('pipeline');
    expect(json).not.toContain('"status"');
  });
});
