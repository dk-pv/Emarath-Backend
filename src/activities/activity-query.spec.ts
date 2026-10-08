import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { leadScopeWhere } from '../leads/lead-scope';
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
  // ADR-0086: every role's activity rule is ANDed with that caller's own lead scope.
  const leadOf = (user: CurrentUser) => ({ lead: leadScopeWhere(user) });

  it('excludes soft-deleted activities for every role', () => {
    for (const role of Object.values(UserRole)) {
      expect(activityScopeWhere({ id: 'u1', role })).toMatchObject({
        deletedAt: null,
      });
    }
  });

  it("requires the linked lead to be inside the caller's lead scope, for every role", () => {
    for (const role of Object.values(UserRole)) {
      const user = { id: 'u1', role, team: 'Sales' };
      expect(activityScopeWhere(user)).toMatchObject(leadOf(user));
    }
  });

  it('hides an archived lead’s follow-ups (the lead scope keeps only live leads)', () => {
    const where = activityScopeWhere({ id: 'u1', role: UserRole.SUPERADMIN });
    expect(where.lead).toMatchObject({ deletedAt: null });
  });

  it('restricts a sales agent to activities they are assigned to, on leads they own', () => {
    const user = { id: 'u1', role: UserRole.SALES_AGENT };
    expect(activityScopeWhere(user)).toEqual({
      deletedAt: null,
      ...leadOf(user),
      assignees: { some: { userId: 'u1' } },
    });
  });

  // AUTH-02.1 / ADR-0030: a manager sees their team's activities.
  it('restricts a sales manager to activities assigned to a same-team user', () => {
    const user = { id: 'mgr-1', role: UserRole.SALES_MANAGER, team: 'Sales' };
    expect(activityScopeWhere(user)).toEqual({
      deletedAt: null,
      ...leadOf(user),
      assignees: { some: { user: { team: 'Sales' } } },
    });
  });

  it('falls a null-team manager back to own-only (ADR-0030 §7)', () => {
    const user = { id: 'mgr-1', role: UserRole.SALES_MANAGER, team: null };
    expect(activityScopeWhere(user)).toEqual({
      deletedAt: null,
      ...leadOf(user),
      assignees: { some: { userId: 'mgr-1' } },
    });
  });

  it('leaves admin / customer-service / marketing organization-wide', () => {
    for (const role of [
      UserRole.SUPERADMIN,
      UserRole.CUSTOMER_SERVICE_AGENT,
      UserRole.MARKETING_ANALYST,
    ]) {
      const user = { id: 'u1', role };
      expect(activityScopeWhere(user)).toEqual({
        deletedAt: null,
        ...leadOf(user),
      });
    }
  });

  it('drops the not-deleted filter but keeps both scopes when includeDeleted', () => {
    const agent = { id: 'u1', role: UserRole.SALES_AGENT };
    expect(activityScopeWhere(agent, { includeDeleted: true })).toEqual({
      ...leadOf(agent),
      assignees: { some: { userId: 'u1' } },
    });
    // A manager keeps the team predicate; only the delete filter drops.
    const manager = {
      id: 'mgr-1',
      role: UserRole.SALES_MANAGER,
      team: 'Sales',
    };
    expect(activityScopeWhere(manager, { includeDeleted: true })).toEqual({
      ...leadOf(manager),
      assignees: { some: { user: { team: 'Sales' } } },
    });
    const admin = { id: 'u1', role: UserRole.SUPERADMIN };
    expect(activityScopeWhere(admin, { includeDeleted: true })).toEqual(
      leadOf(admin),
    );
  });

  it.each([
    UserRole.LOGISTICS_MANAGER,
    UserRole.LOGISTICS_EXECUTIVE,
    UserRole.ACCOUNTS_EXECUTIVE,
    UserRole.QC,
  ])('gives %s no activity at all (ADR-0084)', (role) => {
    expect(activityScopeWhere({ id: 'u1', role })).toMatchObject({
      deletedAt: null,
      id: { in: [] },
    });
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
