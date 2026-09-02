import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { DuplicateEnquiriesQueryDto } from './dto/duplicate-enquiries-query.dto';
import { DuplicateEnquiriesService } from './duplicate-enquiries.service';

/** A lead as the report's projection returns it. */
function lead(
  id: string,
  primaryPhone: string,
  createdAt: string,
  extra: Partial<{
    name: string;
    source: string | null;
    email: string | null;
    secondaryPhone: string | null;
    agents: { id: string; name: string }[];
  }> = {},
) {
  return {
    id,
    name: extra.name ?? `Lead ${id}`,
    primaryPhone,
    secondaryPhone: extra.secondaryPhone ?? null,
    email: extra.email ?? null,
    source: extra.source ?? null,
    createdAt: new Date(createdAt),
    assignments: (extra.agents ?? []).map((user) => ({ user })),
  };
}

function makeService(rows: ReturnType<typeof lead>[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = { lead: { findMany } } as unknown as PrismaService;
  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: 'u1', role: UserRole.SUPERADMIN }),
  } as unknown as CurrentUserService;
  return new DuplicateEnquiriesService(prisma, currentUser);
}

const query = (over: Partial<DuplicateEnquiriesQueryDto> = {}) =>
  ({ page: 1, size: 100, ...over }) as DuplicateEnquiriesQueryDto;

describe('DuplicateEnquiriesService', () => {
  it('groups leads that share a primary phone and ignores the singletons', async () => {
    const service = makeService([
      lead('a', '971500000001', '2026-08-03T10:00:00.000Z'),
      lead('b', '971500000001', '2026-08-01T10:00:00.000Z'),
      lead('c', '971500000002', '2026-08-02T10:00:00.000Z'),
    ]);

    const { rows, total } = await service.list(query());
    expect(total).toBe(1);
    expect(rows[0].primaryPhone).toBe('971500000001');
    expect(rows[0].duplicateCount).toBe(2);
  });

  it('leads the group with its most recent enquiry and collects sources and assignees', async () => {
    const service = makeService([
      lead('old', '9715', '2026-08-01T10:00:00.000Z', {
        name: 'First try',
        source: 'Broadcast',
        agents: [{ id: 'u1', name: 'Ann' }],
      }),
      lead('new', '9715', '2026-08-09T10:00:00.000Z', {
        name: 'Latest try',
        source: 'Website',
        email: 'x@y.z',
        secondaryPhone: '9716',
        agents: [
          { id: 'u1', name: 'Ann' },
          { id: 'u2', name: 'Bob' },
        ],
      }),
    ]);

    const [row] = (await service.list(query())).rows;
    expect(row.name).toBe('Latest try');
    expect(row.latestEnquiryAt).toBe('2026-08-09T10:00:00.000Z');
    expect(row.primaryEmail).toBe('x@y.z');
    expect(row.secondaryPhone).toBe('9716');
    // `Lead` carries one email address, so there is never a second one to show.
    expect(row.secondaryEmail).toBeNull();
    expect(row.sources).toEqual(['Broadcast', 'Website']);
    expect(row.assignedTo.map((a) => a.id).sort()).toEqual(['u1', 'u2']);
  });

  it('counts a card by the leads sitting in a group large enough to clear its bar', async () => {
    // One pair (each member has 1 duplicate) and one trio (each has 2).
    const service = makeService([
      lead('p1', 'PAIR', '2026-08-01T00:00:00.000Z'),
      lead('p2', 'PAIR', '2026-08-02T00:00:00.000Z'),
      lead('t1', 'TRIO', '2026-08-01T00:00:00.000Z'),
      lead('t2', 'TRIO', '2026-08-02T00:00:00.000Z'),
      lead('t3', 'TRIO', '2026-08-03T00:00:00.000Z'),
    ]);

    const { kpis } = await service.summary(query());
    // 1+: both groups (2 + 3 leads). 2+: only the trio. 3+ and beyond: none.
    expect(kpis.leadsWithAtLeast).toEqual({
      '1': 5,
      '2': 3,
      '3': 0,
      '4': 0,
      '5': 0,
    });
  });

  it('pages the groups it found, newest enquiry first', async () => {
    const service = makeService([
      lead('a1', 'A', '2026-08-01T00:00:00.000Z'),
      lead('a2', 'A', '2026-08-02T00:00:00.000Z'),
      lead('b1', 'B', '2026-08-05T00:00:00.000Z'),
      lead('b2', 'B', '2026-08-06T00:00:00.000Z'),
    ]);

    const first = await service.list(query({ size: 1 }));
    expect(first.total).toBe(2);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].primaryPhone).toBe('B');

    const second = await service.list(query({ page: 2, size: 1 }));
    expect(second.rows[0].primaryPhone).toBe('A');
  });

  it('returns nothing when no phone repeats', async () => {
    const service = makeService([
      lead('a', '1', '2026-08-01T00:00:00.000Z'),
      lead('b', '2', '2026-08-02T00:00:00.000Z'),
    ]);

    expect((await service.list(query())).total).toBe(0);
    expect((await service.summary(query())).kpis.leadsWithAtLeast['1']).toBe(0);
  });
});
