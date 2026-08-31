import { CallDirection, UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import {
  HOT_LEAD_STATUSES,
  hotLeadsWhere,
  KPI_KEYS,
  outboundCallsWhere,
  overdueFollowUpsWhere,
  QUALIFIED_LEADS_PENDING,
  todaysFollowUpsWhere,
  todaysLeadsWhere,
  type KpiPeriod,
} from './dashboard-kpis';

const AGENT: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };
const MANAGER: CurrentUser = {
  id: 'mgr-1',
  role: UserRole.SALES_MANAGER,
  team: 'Team A',
};
const ADMIN: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };

const TODAY_START = '2026-08-29T00:00:00.000Z';
const FROM = '2026-08-01T00:00:00.000Z';
const TO = '2026-09-01T00:00:00.000Z';

const period = (overrides: Partial<KpiPeriod> = {}): KpiPeriod => ({
  todayStart: TODAY_START,
  from: FROM,
  to: TO,
  ...overrides,
});

/** Flattens an AND-tree so a fragment can be asserted wherever it was composed. */
function flatten(where: unknown): Record<string, unknown>[] {
  if (!where || typeof where !== 'object') return [];
  const node = where as Record<string, unknown>;
  if (Array.isArray(node.AND)) return node.AND.flatMap(flatten);
  return [node, ...(Array.isArray(node.AND) ? [] : [])];
}

const json = (value: unknown) => JSON.stringify(value);

describe('DASH-02.1 counter definitions', () => {
  it('defines exactly the six backlog counters (AC1)', () => {
    expect([...KPI_KEYS].sort()).toEqual(
      [
        'overdueFollowUps',
        'hotLeads',
        'todaysLeads',
        'todaysFollowUps',
        'qualifiedLeads',
        'outboundCalls',
      ].sort(),
    );
  });

  describe('Overdue Follow-ups', () => {
    it('reuses the Activities overdue predicate rather than restating it', () => {
      const parts = flatten(overdueFollowUpsWhere(ADMIN, period()));
      // completedAt: null AND dueAt < todayStart — activityBucketWhere('overdue').
      expect(parts).toContainEqual(
        expect.objectContaining({
          completedAt: null,
          dueAt: { lt: new Date(TODAY_START) },
        }),
      );
    });

    it('applies the widget period to createdAt, the reports convention', () => {
      const parts = flatten(overdueFollowUpsWhere(ADMIN, period()));
      expect(parts).toContainEqual({
        createdAt: { gte: new Date(FROM), lt: new Date(TO) },
      });
    });

    it('adds no date predicate for the All period', () => {
      const parts = flatten(
        overdueFollowUpsWhere(
          ADMIN,
          period({ from: undefined, to: undefined }),
        ),
      );
      expect(parts.some((p) => 'createdAt' in p)).toBe(false);
    });

    it('scopes to the caller for a sales agent (AC3)', () => {
      expect(json(overdueFollowUpsWhere(AGENT, period()))).toContain(AGENT.id);
    });
  });

  describe("Today's Follow-ups", () => {
    it('counts open follow-ups DUE in the period — never call activity', () => {
      const parts = flatten(todaysFollowUpsWhere(ADMIN, period()));
      expect(parts).toContainEqual({ completedAt: null });
      expect(parts).toContainEqual({
        dueAt: { gte: new Date(FROM), lt: new Date(TO) },
      });
      // The definition must not reach into Calls.
      expect(json(todaysFollowUpsWhere(ADMIN, period()))).not.toContain(
        'calls',
      );
    });

    it('matches the Activities "Today" tab when the period is the caller\'s today', () => {
      const todayEnd = '2026-08-30T00:00:00.000Z';
      const parts = flatten(
        todaysFollowUpsWhere(
          ADMIN,
          period({ from: TODAY_START, to: todayEnd }),
        ),
      );
      // activityBucketWhere('today') is completedAt null + dueAt [start, end).
      expect(parts).toContainEqual({ completedAt: null });
      expect(parts).toContainEqual({
        dueAt: { gte: new Date(TODAY_START), lt: new Date(todayEnd) },
      });
    });

    it('drops the due window for the All period', () => {
      const parts = flatten(
        todaysFollowUpsWhere(ADMIN, period({ from: undefined, to: undefined })),
      );
      expect(parts.some((p) => 'dueAt' in p)).toBe(false);
    });

    it('scopes to the caller for a sales agent (AC3)', () => {
      expect(json(todaysFollowUpsWhere(AGENT, period()))).toContain(AGENT.id);
    });
  });

  describe("Today's Leads", () => {
    it('counts leads ASSIGNED in the period (lead_assignments.createdAt)', () => {
      const parts = flatten(todaysLeadsWhere(ADMIN, period()));
      expect(parts).toContainEqual({
        assignments: {
          some: { createdAt: { gte: new Date(FROM), lt: new Date(TO) } },
        },
      });
    });

    it('is NOT the RPT-02.2 "recently contacted" metric — no call predicate', () => {
      expect(json(todaysLeadsWhere(ADMIN, period()))).not.toContain('calls');
    });

    it('counts any assigned lead for the All period', () => {
      const parts = flatten(
        todaysLeadsWhere(ADMIN, period({ from: undefined, to: undefined })),
      );
      expect(parts).toContainEqual({ assignments: { some: {} } });
    });

    it('scopes to the caller for a sales agent, and by team for a manager (AC3)', () => {
      expect(json(todaysLeadsWhere(AGENT, period()))).toContain(AGENT.id);
      expect(json(todaysLeadsWhere(MANAGER, period()))).toContain('Team A');
    });

    it('excludes soft-deleted leads through the shared scope', () => {
      const parts = flatten(todaysLeadsWhere(ADMIN, period()));
      expect(parts).toContainEqual(
        expect.objectContaining({ deletedAt: null }),
      );
    });
  });

  describe('Hot Leads', () => {
    it('counts only the canonical HOT and SUPER HOT statuses', () => {
      expect(HOT_LEAD_STATUSES).toEqual(['HOT', 'SUPER HOT']);
      const parts = flatten(hotLeadsWhere(ADMIN, period()));
      expect(parts).toContainEqual({ status: { in: ['HOT', 'SUPER HOT'] } });
    });

    it('applies the widget period to createdAt as a half-open range', () => {
      const parts = flatten(hotLeadsWhere(ADMIN, period()));
      expect(parts).toContainEqual({
        createdAt: { gte: new Date(FROM), lt: new Date(TO) },
      });
    });

    it('adds no date predicate for the All period', () => {
      const parts = flatten(
        hotLeadsWhere(ADMIN, period({ from: undefined, to: undefined })),
      );
      expect(parts.some((p) => 'createdAt' in p)).toBe(false);
    });

    it('scopes to the caller for a sales agent (AC3)', () => {
      expect(json(hotLeadsWhere(AGENT, period()))).toContain(AGENT.id);
    });
  });

  describe('Outbound Calls', () => {
    it('counts OUTBOUND calls started in the period', () => {
      const where = outboundCallsWhere(ADMIN, period());
      expect(where.direction).toBe(CallDirection.OUTBOUND);
      expect(where.startedAt).toEqual({
        gte: new Date(FROM),
        lt: new Date(TO),
      });
    });

    it('reuses the Call scope, which excludes soft-deleted calls', () => {
      expect(outboundCallsWhere(ADMIN, period()).deletedAt).toBeNull();
    });

    it('adds no date predicate for the All period', () => {
      const where = outboundCallsWhere(
        ADMIN,
        period({ from: undefined, to: undefined }),
      );
      expect(where.startedAt).toBeUndefined();
    });

    it('scopes through the lead scope for a sales agent (AC3)', () => {
      expect(json(outboundCallsWhere(AGENT, period()))).toContain(AGENT.id);
    });
  });

  describe('Qualified Leads', () => {
    it('reports a pending definition instead of a fabricated number', () => {
      expect(QUALIFIED_LEADS_PENDING.value).toBeNull();
      expect(QUALIFIED_LEADS_PENDING.status).toBe('pending-definition');
      expect(QUALIFIED_LEADS_PENDING.reason).toMatch(/Qualified/i);
    });

    it('is not silently mapped onto any existing status', () => {
      const serialized = json(QUALIFIED_LEADS_PENDING);
      for (const status of ['HOT', 'SUPER HOT', 'WON', 'Converted']) {
        expect(serialized).not.toContain(`"${status}"`);
      }
    });
  });

  describe('period boundaries', () => {
    it('are half-open [from, to) everywhere, so adjacent periods never double-count', () => {
      const boundary = '2026-09-01T00:00:00.000Z';
      const august = period({ from: FROM, to: boundary });
      const september = period({
        from: boundary,
        to: '2026-10-01T00:00:00.000Z',
      });

      const augustHot = flatten(hotLeadsWhere(ADMIN, august)).find(
        (p) => 'createdAt' in p,
      ) as { createdAt: { lt: Date } };
      const septemberHot = flatten(hotLeadsWhere(ADMIN, september)).find(
        (p) => 'createdAt' in p,
      ) as { createdAt: { gte: Date } };

      // The shared instant is excluded above and included below — never both.
      expect(augustHot.createdAt.lt).toEqual(new Date(boundary));
      expect(septemberHot.createdAt.gte).toEqual(new Date(boundary));
    });

    it('accepts an open-ended lower bound without inventing an upper one', () => {
      const where = outboundCallsWhere(ADMIN, period({ to: undefined }));
      expect(where.startedAt).toEqual({ gte: new Date(FROM) });
    });
  });
});
