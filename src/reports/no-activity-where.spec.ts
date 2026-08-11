import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import {
  buildNoActivityWhere,
  noRecentActivityWhere,
} from './no-activity-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('noRecentActivityWhere', () => {
  it('defaults to "no completed activity ever" when no window is given', () => {
    expect(noRecentActivityWhere({})).toEqual({
      activities: { none: { deletedAt: null, completedAt: { not: null } } },
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
    // Second fragment is always the activity predicate.
    expect(where.AND?.[1]).toEqual({
      activities: { none: { deletedAt: null, completedAt: { not: null } } },
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
});
