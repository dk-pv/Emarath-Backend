import { UserRole } from '../generated/prisma/client';
import { activityScopeWhere } from './activity-scope';
import {
  ACTIVITY_BUCKETS,
  activityBucketWhere,
  DayBoundaries,
} from './activity-buckets';

const b: DayBoundaries = {
  todayStart: new Date('2026-07-24T00:00:00.000Z'),
  todayEnd: new Date('2026-07-25T00:00:00.000Z'),
  tomorrowEnd: new Date('2026-07-26T00:00:00.000Z'),
};

describe('activityScopeWhere', () => {
  it('excludes soft-deleted for every role', () => {
    for (const role of Object.values(UserRole)) {
      expect(activityScopeWhere({ id: 'u1', role })).toMatchObject({
        deletedAt: null,
      });
    }
  });

  it('restricts a sales agent to activities they are assigned to', () => {
    expect(
      activityScopeWhere({ id: 'u1', role: UserRole.SALES_AGENT }),
    ).toEqual({ deletedAt: null, assignees: { some: { userId: 'u1' } } });
  });

  // AUTH-02.1 / ADR-0030: a manager sees their team's activities.
  it('restricts a sales manager to activities assigned to a same-team user', () => {
    expect(
      activityScopeWhere({
        id: 'mgr-1',
        role: UserRole.SALES_MANAGER,
        team: 'Sales',
      }),
    ).toEqual({
      deletedAt: null,
      assignees: { some: { user: { team: 'Sales' } } },
    });
  });

  it('falls a null-team manager back to own-only (ADR-0030 §7)', () => {
    expect(
      activityScopeWhere({
        id: 'mgr-1',
        role: UserRole.SALES_MANAGER,
        team: null,
      }),
    ).toEqual({ deletedAt: null, assignees: { some: { userId: 'mgr-1' } } });
  });

  it('leaves admin / customer-service / marketing organization-wide', () => {
    for (const role of [
      UserRole.SUPERADMIN,
      UserRole.CUSTOMER_SERVICE_AGENT,
      UserRole.MARKETING_ANALYST,
    ]) {
      expect(activityScopeWhere({ id: 'u1', role })).toEqual({
        deletedAt: null,
      });
    }
  });

  it('drops the not-deleted filter but keeps role scope when includeDeleted', () => {
    expect(
      activityScopeWhere(
        { id: 'u1', role: UserRole.SALES_AGENT },
        { includeDeleted: true },
      ),
    ).toEqual({ assignees: { some: { userId: 'u1' } } });
    // A manager keeps the team predicate; only the delete filter drops.
    expect(
      activityScopeWhere(
        { id: 'mgr-1', role: UserRole.SALES_MANAGER, team: 'Sales' },
        { includeDeleted: true },
      ),
    ).toEqual({ assignees: { some: { user: { team: 'Sales' } } } });
    expect(
      activityScopeWhere(
        { id: 'u1', role: UserRole.SUPERADMIN },
        { includeDeleted: true },
      ),
    ).toEqual({});
  });

  it('returns a scope for every role the enum defines', () => {
    for (const role of Object.values(UserRole)) {
      expect(activityScopeWhere({ id: 'u1', role })).toBeDefined();
    }
  });
});

describe('activityBucketWhere', () => {
  it('overdue = open items due before today', () => {
    expect(activityBucketWhere('overdue', b)).toEqual({
      completedAt: null,
      dueAt: { lt: b.todayStart },
    });
  });

  it("today = open items in today's window", () => {
    expect(activityBucketWhere('today', b)).toEqual({
      completedAt: null,
      dueAt: { gte: b.todayStart, lt: b.todayEnd },
    });
  });

  it("tomorrow = open items in tomorrow's window", () => {
    expect(activityBucketWhere('tomorrow', b)).toEqual({
      completedAt: null,
      dueAt: { gte: b.todayEnd, lt: b.tomorrowEnd },
    });
  });

  it('completed = anything done', () => {
    expect(activityBucketWhere('completed', b)).toEqual({
      completedAt: { not: null },
    });
  });

  it('all = no extra predicate', () => {
    expect(activityBucketWhere('all', b)).toEqual({});
  });

  it('covers every bucket', () => {
    for (const bucket of ACTIVITY_BUCKETS) {
      expect(activityBucketWhere(bucket, b)).toBeDefined();
    }
  });
});
