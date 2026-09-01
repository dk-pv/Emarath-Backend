import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import {
  CONVERTED_STATUS,
  buildConvertedLeadsWhere,
} from './converted-leads-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('buildConvertedLeadsWhere', () => {
  it('always constrains status to WON (and never "Converted" or both)', () => {
    const json = JSON.stringify(buildConvertedLeadsWhere(admin, {}));
    expect(CONVERTED_STATUS).toBe('WON');
    expect(json).toContain('"status":{"in":["WON"]}');
    expect(json).not.toContain('Converted');
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    // buildLeadWhere owns the scope rule; the report can never widen it. Encoded as a JSON
    // snippet check to avoid coupling to the exact fragment shape.
    const json = JSON.stringify(buildConvertedLeadsWhere(agent, {}));
    expect(json).toContain('"userId":"agent-1"');
    expect(json).toContain('"status":{"in":["WON"]}');
  });

  it('threads source and agent filters through the reused leads where', () => {
    const json = JSON.stringify(
      buildConvertedLeadsWhere(admin, {
        source: ['DoubleTick'],
        agent: ['11111111-1111-1111-1111-111111111111'],
      }),
    );
    expect(json).toContain('DoubleTick');
    expect(json).toContain('11111111-1111-1111-1111-111111111111');
  });

  it('maps the period to a half-open createdAt window (no conversion timestamp exists)', () => {
    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-08-01T00:00:00.000Z';
    const where = buildConvertedLeadsWhere(admin, { from, to });
    const createdAt = (where.AND as { createdAt?: unknown }[]).find(
      (fragment) => fragment.createdAt,
    )?.createdAt as { gte?: Date; lt?: Date } | undefined;
    expect(createdAt?.gte).toEqual(new Date(from));
    expect(createdAt?.lt).toEqual(new Date(to));
  });

  it('applies the window to statusChangedAt when dateField is statusChanged', () => {
    const where = buildConvertedLeadsWhere(admin, {
      from: '2026-07-01T00:00:00.000Z',
      dateField: 'statusChanged',
    });
    const json = JSON.stringify(where);
    expect(json).toContain('statusChangedAt');
    expect(json).toContain('WON');
    expect(JSON.stringify(where.AND?.[0])).not.toContain('createdAt');
  });
});
