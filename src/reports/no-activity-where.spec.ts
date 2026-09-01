import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import {
  buildNoActivityWhere,
  noRecentActivityWhere,
} from './no-activity-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('noRecentActivityWhere', () => {
  it('defaults to "no completed activity and no logged call ever" when no window is given', () => {
    expect(noRecentActivityWhere({})).toEqual({
      activities: { none: { deletedAt: null, completedAt: { not: null } } },
      calls: { none: { deletedAt: null, startedAt: {} } },
    });
  });

  it('bounds the window lower with `from` (no completed activity since then)', () => {
    const from = '2026-01-01T00:00:00.000Z';
    const where = noRecentActivityWhere({ from });
    expect(where.activities?.none).toMatchObject({
      deletedAt: null,
      completedAt: { not: null, gte: new Date(from) },
    });
  });

  it('bounds the window upper with `to`', () => {
    const to = '2026-02-01T00:00:00.000Z';
    const where = noRecentActivityWhere({ to });
    expect(where.activities?.none).toMatchObject({
      completedAt: { not: null, lt: new Date(to) },
    });
  });
});

describe('buildNoActivityWhere', () => {
  it('ANDs role scope with the no-recent-activity predicate', () => {
    const where = buildNoActivityWhere(admin, {});
    expect(where.AND).toHaveLength(2);
    // Second fragment is always the no-engagement predicate.
    expect(where.AND?.[1]).toEqual({
      activities: { none: { deletedAt: null, completedAt: { not: null } } },
      calls: { none: { deletedAt: null, startedAt: {} } },
    });
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    // An agent's scope restricts to leads assigned to them; buildLeadWhere owns that rule,
    // so the report can never widen it. Encoded as a JSON snippet check to avoid coupling
    // to the exact fragment shape.
    const where = buildNoActivityWhere(agent, {});
    expect(JSON.stringify(where)).toContain('"userId":"agent-1"');
  });

  it('threads source and agent filters through the reused leads where', () => {
    const where = buildNoActivityWhere(admin, {
      source: ['DoubleTick'],
      agent: ['11111111-1111-1111-1111-111111111111'],
    });
    const json = JSON.stringify(where);
    expect(json).toContain('DoubleTick');
    expect(json).toContain('11111111-1111-1111-1111-111111111111');
  });

  it('passes the pipeline filter through to the lead where (toolbar "Pipeline")', () => {
    const where = buildNoActivityWhere(admin, { pipeline: 'LOGISTICS' });
    // The lead fragment is the first of the two ANDed halves.
    expect(JSON.stringify(where.AND?.[0])).toContain('LOGISTICS');
  });

  it('leaves the pipeline predicate out entirely when no pipeline is selected', () => {
    const where = buildNoActivityWhere(admin, {});
    expect(JSON.stringify(where.AND?.[0])).not.toContain('pipeline');
  });

  it("passes the unassigned flag through (the summary's Unassigned drill-through)", () => {
    const where = buildNoActivityWhere(admin, { unassigned: true });
    // `unassigned` compiles to a "no assignments" predicate on the lead fragment.
    expect(JSON.stringify(where.AND?.[0])).toContain('assignments');
  });

  it('keeps an agent scope narrower than the whole org for a sales agent', () => {
    const where = buildNoActivityWhere(agent, { pipeline: 'QC' });
    const lead = JSON.stringify(where.AND?.[0]);
    expect(lead).toContain('QC');
    expect(lead).toContain('agent-1');
  });

  it('also requires no logged call in the window (the call log never writes activities)', () => {
    const from = '2026-08-01T00:00:00.000Z';
    const where = noRecentActivityWhere({ from });
    expect(where.calls).toEqual({
      none: { deletedAt: null, startedAt: { gte: new Date(from) } },
    });
  });

  it('reads "never called" for the call predicate when no window is given', () => {
    expect(noRecentActivityWhere({}).calls).toEqual({
      none: { deletedAt: null, startedAt: {} },
    });
  });
});
