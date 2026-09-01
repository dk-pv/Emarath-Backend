import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import {
  buildTodayLeadsWhere,
  recentlyContactedWhere,
} from './today-leads-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('recentlyContactedWhere', () => {
  it('defaults to "ever contacted" (a non-deleted answered call) when no window is given', () => {
    expect(recentlyContactedWhere({})).toEqual({
      calls: { some: { deletedAt: null, outcome: 'ANSWERED' } },
    });
  });

  it('bounds the window lower with `from` (contacted on/after then)', () => {
    const from = '2026-08-11T00:00:00.000Z';
    const where = recentlyContactedWhere({ from });
    expect(where.calls?.some).toMatchObject({
      deletedAt: null,
      outcome: 'ANSWERED',
      startedAt: { gte: new Date(from) },
    });
  });

  it('bounds the window upper with `to`', () => {
    const to = '2026-08-12T00:00:00.000Z';
    const where = recentlyContactedWhere({ to });
    expect(where.calls?.some).toMatchObject({
      startedAt: { lt: new Date(to) },
    });
  });
});

describe('buildTodayLeadsWhere', () => {
  it('ANDs role scope with the recently-contacted predicate', () => {
    const where = buildTodayLeadsWhere(admin, {});
    expect(where.AND).toHaveLength(2);
    // Second fragment is always the contact predicate.
    expect(where.AND?.[1]).toEqual({
      calls: { some: { deletedAt: null, outcome: 'ANSWERED' } },
    });
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    // An agent's scope restricts to leads assigned to them; buildLeadWhere owns that rule,
    // so the report can never widen it. Encoded as a JSON snippet check to avoid coupling
    // to the exact fragment shape.
    const where = buildTodayLeadsWhere(agent, {});
    expect(JSON.stringify(where)).toContain('"userId":"agent-1"');
  });

  it('threads source and agent filters through the reused leads where', () => {
    const where = buildTodayLeadsWhere(admin, {
      source: ['DoubleTick'],
      agent: ['11111111-1111-1111-1111-111111111111'],
    });
    const json = JSON.stringify(where);
    expect(json).toContain('DoubleTick');
    expect(json).toContain('11111111-1111-1111-1111-111111111111');
  });

  it('passes the pipeline filter through to the lead where (toolbar "Pipeline")', () => {
    const where = buildTodayLeadsWhere(admin, { pipeline: 'LOGISTICS' });
    expect(JSON.stringify(where.AND?.[0])).toContain('LOGISTICS');
  });

  it('leaves the pipeline predicate out entirely when none is selected', () => {
    const where = buildTodayLeadsWhere(admin, {});
    expect(JSON.stringify(where.AND?.[0])).not.toContain('pipeline');
  });
});
