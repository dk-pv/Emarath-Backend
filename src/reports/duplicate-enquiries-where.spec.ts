import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/current-user';
import { buildDuplicateEnquiriesWhere } from './duplicate-enquiries-where';

const admin: CurrentUser = { id: 'admin-1', role: UserRole.SUPERADMIN };
const agent: CurrentUser = { id: 'agent-1', role: UserRole.SALES_AGENT };

describe('buildDuplicateEnquiriesWhere', () => {
  it('is the scoped leads where when no filter is given', () => {
    const where = buildDuplicateEnquiriesWhere(admin, {});
    expect(where.deletedAt).toBeNull();
  });

  it('threads the enquiry window, assignee and source through the reused leads where', () => {
    const json = JSON.stringify(
      buildDuplicateEnquiriesWhere(admin, {
        from: '2026-07-01T00:00:00.000Z',
        agent: ['11111111-1111-4111-8111-111111111111'],
        source: ['Broadcast'],
      }),
    );
    expect(json).toContain('createdAt');
    expect(json).toContain('11111111-1111-4111-8111-111111111111');
    expect(json).toContain('Broadcast');
  });

  it('carries the caller role scope so an agent is limited to their own leads', () => {
    expect(JSON.stringify(buildDuplicateEnquiriesWhere(agent, {}))).toContain(
      '"userId":"agent-1"',
    );
  });
});
