import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CallSummaryService } from './call-summary.service';

/**
 * Historical call retention (CALL-08.1). The retention + trend mechanisms already
 * exist — records persist (no purge/TTL, AC1) and CALL-01.1's date/time + agent
 * indexes keep period-bounded aggregations fast as the log grows (AC3/AC5). This
 * locks in the piece those depend on: that a period is compared against the
 * immediately-preceding **retained** period of equal length (AC2), and that the
 * boundaries are computed correctly against a sample (AC4).
 */
const USER_ID = '22222222-2222-2222-2222-222222222222';
const FROM = '2026-07-27T00:00:00.000Z';
const TO = '2026-07-28T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

type Range = { gte: Date; lt: Date };

describe('Historical call retention (CALL-08.1)', () => {
  it('compares the requested period against the immediately preceding retained period (AC2/AC4)', async () => {
    const windows: Range[] = [];
    const count = jest.fn((args: { where: { startedAt: Range } }) => {
      windows.push(args.where.startedAt);
      return Promise.resolve(0);
    });
    const prisma = {
      call: {
        count,
        aggregate: jest.fn().mockResolvedValue({ _sum: { duration: 0 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const currentUser = {
      resolve: jest.fn().mockResolvedValue({
        id: USER_ID,
        role: UserRole.SUPERADMIN,
      }),
    } as unknown as CurrentUserService;

    await new CallSummaryService(prisma, currentUser).getSummary({
      from: FROM,
      to: TO,
    });

    const current = windows.find(
      (w) => w.gte.getTime() === new Date(FROM).getTime(),
    );
    const prior = windows.find(
      (w) => w.lt.getTime() === new Date(FROM).getTime(),
    );

    // Current window is exactly [FROM, TO)…
    expect(current).toBeDefined();
    expect(current?.lt.getTime()).toBe(new Date(TO).getTime());
    // …and the prior window is the equal-length span immediately before it,
    // proving day-over-day reads retained prior-period data.
    expect(prior).toBeDefined();
    expect(prior?.gte.getTime()).toBe(new Date(FROM).getTime() - DAY_MS);
    expect(prior?.lt.getTime()).toBe(new Date(FROM).getTime());
  });
});
