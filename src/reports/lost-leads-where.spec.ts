import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { LOST_STATUS, buildLostLeadsWhere } from './lost-leads-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('buildLostLeadsWhere', () => {
  it('always constrains status to LOST (and never another negative status)', () => {
    const json = JSON.stringify(buildLostLeadsWhere(admin, {}));
    expect(LOST_STATUS).toBe('LOST');
    expect(json).toContain('"status":{"in":["LOST"]}');
    for (const other of [
      'NOT ANSWER',
      'NOT REACHEBLE',
      'Cancel',
      'SALES REJECTED',
      'QC NOT APPROVED',
    ]) {
      expect(json).not.toContain(other);
    }
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    const json = JSON.stringify(buildLostLeadsWhere(agent, {}));
    expect(json).toContain('"userId":"agent-1"');
    expect(json).toContain('"status":{"in":["LOST"]}');
  });

  it('adds the team predicate (assignee team) only when teams are given', () => {
    const withTeam = buildLostLeadsWhere(admin, { team: ['Sales'] });
    expect(JSON.stringify(withTeam)).toContain(
      '"assignments":{"some":{"user":{"team":{"in":["Sales"]}}}}',
    );
    // No team → no team fragment beyond the base where.
    const noTeam = JSON.stringify(buildLostLeadsWhere(admin, {}));
    expect(noTeam).not.toContain('"team":{"in"');
  });

  it('maps the period to a half-open createdAt window (no lost timestamp exists)', () => {
    // With no team, buildLostLeadsWhere returns buildLeadWhere directly, so createdAt is a
    // direct fragment of its AND — the same shape RPT-02.6 asserts.
    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-08-01T00:00:00.000Z';
    const where = buildLostLeadsWhere(admin, { from, to });
    const createdAt = (where.AND as { createdAt?: unknown }[]).find(
      (fragment) => fragment.createdAt,
    )?.createdAt as { gte?: Date; lt?: Date } | undefined;
    expect(createdAt?.gte).toEqual(new Date(from));
    expect(createdAt?.lt).toEqual(new Date(to));
  });

  it('applies the window to statusChangedAt when dateField is statusChanged', () => {
    const where = buildLostLeadsWhere(admin, {
      from: '2026-07-01T00:00:00.000Z',
      dateField: 'statusChanged',
    });
    const json = JSON.stringify(where);
    expect(json).toContain('statusChangedAt');
    expect(json).toContain('LOST');
    expect(JSON.stringify(where.AND?.[0])).not.toContain('createdAt');
  });

  it('passes agent, source and pipeline through to the reused leads where', () => {
    const json = JSON.stringify(
      buildLostLeadsWhere(admin, {
        agent: ['11111111-1111-4111-8111-111111111111'],
        source: ['Broadcast'],
        pipeline: 'LOGISTICS',
      }),
    );
    expect(json).toContain('11111111-1111-4111-8111-111111111111');
    expect(json).toContain('Broadcast');
    expect(json).toContain('LOGISTICS');
  });

  it('narrows to reason buckets, mapping the `none` value to a null lostReason', () => {
    const json = JSON.stringify(
      buildLostLeadsWhere(admin, { reason: ['Price too high', 'none'] }),
    );
    expect(json).toContain('"lostReason":"Price too high"');
    expect(json).toContain('"lostReason":null');
  });
});
