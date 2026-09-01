import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildLeadAgingWhere } from './lead-aging-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('buildLeadAgingWhere', () => {
  it('excludes closed-lost leads from the tracked set by default', () => {
    const where = buildLeadAgingWhere(admin, {});
    expect(where.AND).toHaveLength(2);
    expect(where.AND?.[1]).toEqual({ NOT: { status: 'LOST' } });
  });

  it('tracks closed-lost leads when the caller asks for them', () => {
    const where = buildLeadAgingWhere(admin, { includeLost: true });
    expect(JSON.stringify(where)).not.toContain('LOST');
    expect(where.deletedAt).toBeNull();
  });

  it('threads the agent, status and creation window through the reused leads where', () => {
    const json = JSON.stringify(
      buildLeadAgingWhere(admin, {
        agent: ['11111111-1111-4111-8111-111111111111'],
        status: ['HOT'],
        from: '2026-07-01T00:00:00.000Z',
      }),
    );
    expect(json).toContain('11111111-1111-4111-8111-111111111111');
    expect(json).toContain('HOT');
    expect(json).toContain('createdAt');
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    expect(JSON.stringify(buildLeadAgingWhere(agent, {}))).toContain(
      '"userId":"agent-1"',
    );
  });

  it('intersects the row-click owner with the toolbar agent filter', () => {
    const where = buildLeadAgingWhere(admin, {
      agent: ['11111111-1111-4111-8111-111111111111'],
      owner: '22222222-2222-4222-8222-222222222222',
    });
    const json = JSON.stringify(where);
    // Both ids survive: the toolbar's OR, then the owner ANDed on top.
    expect(json).toContain('11111111-1111-4111-8111-111111111111');
    expect(json).toContain('22222222-2222-4222-8222-222222222222');
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          assignments: {
            some: { userId: '22222222-2222-4222-8222-222222222222' },
          },
        },
      ]),
    );
  });
});
