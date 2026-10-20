import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { LogisticsStatus, Prisma } from '../generated/prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  addDays,
  assertRequestedDeliveryDay,
  BusinessDay,
  businessDay,
  DELIVERY_BUCKETS,
  DeliveryBucket,
  deliveryBucketOf,
  deliveryBucketWhere,
  fromDbDate,
  isDateOnly,
  toDbDate,
} from './delivery-date';

/*
  GCC countries do not share a clock: Asia/Dubai and Asia/Muscat are UTC+4, Asia/Riyadh — Saudi
  Arabia, Qatar, Kuwait and Bahrain — UTC+3, none with daylight saving. So for one hour each night
  the business day differs between them, and every bucket with it.
*/
describe('the business day', () => {
  it.each([
    // Dubai's midnight: the 15th there, still the 14th in Riyadh.
    ['2026-10-14T20:00:00.000Z', 'Asia/Dubai', '2026-10-15', '2026-10-16'],
    ['2026-10-14T20:00:00.000Z', 'Asia/Muscat', '2026-10-15', '2026-10-16'],
    ['2026-10-14T20:00:00.000Z', 'Asia/Riyadh', '2026-10-14', '2026-10-15'],
    // A second before it, the 14th everywhere.
    ['2026-10-14T19:59:59.999Z', 'Asia/Dubai', '2026-10-14', '2026-10-15'],
    // Riyadh's midnight, an hour later.
    ['2026-10-14T20:59:59.999Z', 'Asia/Riyadh', '2026-10-14', '2026-10-15'],
    ['2026-10-14T21:00:00.000Z', 'Asia/Riyadh', '2026-10-15', '2026-10-16'],
    // Month, year and leap-day ends.
    ['2026-10-31T21:00:00.000Z', 'Asia/Riyadh', '2026-11-01', '2026-11-02'],
    ['2026-12-31T20:30:00.000Z', 'Asia/Dubai', '2027-01-01', '2027-01-02'],
    ['2026-12-31T20:30:00.000Z', 'Asia/Riyadh', '2026-12-31', '2027-01-01'],
    ['2028-02-28T10:00:00.000Z', 'Asia/Dubai', '2028-02-28', '2028-02-29'],
    ['2027-02-28T10:00:00.000Z', 'Asia/Dubai', '2027-02-28', '2027-03-01'],
  ])('at %s in %s is %s, tomorrow %s', (now, timeZone, today, tomorrow) => {
    expect(businessDay(timeZone, new Date(now))).toEqual({
      timeZone,
      today,
      tomorrow,
    });
  });
});

/*
  The one rule for a day someone asks for (Sales' date, and later the conversion's): a real
  YYYY-MM-DD day, not before the business day's today — the UAE's (Asia/Dubai, UTC+4, no daylight
  saving), worked out from the instant, never the server's clock or timezone.
*/
describe('a requested delivery day', () => {
  const at = (instant: string) => businessDay('Asia/Dubai', new Date(instant));
  const refusal = (day: string, business: BusinessDay) => {
    try {
      assertRequestedDeliveryDay(day, business);
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as Error).message;
    }
  };

  it.each([
    // A millisecond before Dubai's midnight (19:59:59.999 UTC) it is still the 14th there.
    ['2026-10-14T19:59:59.999Z', '2026-10-14', null],
    [
      '2026-10-14T19:59:59.999Z',
      '2026-10-13',
      'The delivery date can’t be before today, 14-10-2026 (Asia/Dubai).',
    ],
    // At Dubai's midnight (20:00 UTC) the 14th becomes a past day — though UTC still says the 14th.
    [
      '2026-10-14T20:00:00.000Z',
      '2026-10-14',
      'The delivery date can’t be before today, 15-10-2026 (Asia/Dubai).',
    ],
    ['2026-10-14T20:00:00.000Z', '2026-10-15', null],
    ['2026-10-14T20:00:00.000Z', '2026-10-16', null],
    // Year end: 20:30 UTC on 31 December is already New Year's Day in Dubai.
    [
      '2026-12-31T20:30:00.000Z',
      '2026-12-31',
      'The delivery date can’t be before today, 01-01-2027 (Asia/Dubai).',
    ],
    ['2026-12-31T20:30:00.000Z', '2027-01-01', null],
    // Midday: far from either edge.
    ['2026-10-15T08:00:00.000Z', '2026-10-15', null],
    ['2026-10-15T08:00:00.000Z', '2099-12-31', null],
  ])('at %s, %s is refused with %j', (instant, day, expected) => {
    expect(refusal(day, at(instant))).toBe(expected);
  });

  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-2-3',
    '15-10-2026',
    '2026-10-15T00:00:00.000Z',
    '1999-12-31',
    '2100-01-01',
    '',
    ' 2026-10-20',
  ])('refuses %j, which is not a real YYYY-MM-DD day', (day) => {
    expect(refusal(day, at('2026-10-15T08:00:00.000Z'))).toBe(
      'Delivery Date must be a real date written YYYY-MM-DD (years 2000-2099)',
    );
  });

  it('accepts a leap day in a leap year', () => {
    expect(refusal('2028-02-29', at('2028-02-28T10:00:00.000Z'))).toBeNull();
  });

  it('names the timezone the day was measured in', () => {
    expect(
      refusal(
        '2026-10-14',
        businessDay('Asia/Riyadh', new Date('2026-10-15T08:00:00.000Z')),
      ),
    ).toBe(
      'The delivery date can’t be before today, 15-10-2026 (Asia/Riyadh).',
    );
  });
});

/*
  A delivery date is a calendar day. It travels as YYYY-MM-DD and is stored as its UTC midnight,
  which the DATE column keeps as the day itself — never through local time, so the process
  timezone cannot move it.
*/
describe('date-only values', () => {
  it.each(['2026-10-15', '2028-02-29', '2000-01-01', '2099-12-31'])(
    'accepts %s',
    (value) => {
      expect(isDateOnly(value)).toBe(true);
    },
  );

  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-2-3',
    '26-10-15',
    '15-10-2026',
    '2026-10-15T00:00:00Z',
    ' 2026-10-15',
    '1999-12-31',
    '2100-01-01',
    '',
  ])('refuses %j', (value) => {
    expect(isDateOnly(value)).toBe(false);
  });

  it.each(['2026-10-15', '2026-01-01', '2026-12-31', '2028-02-29'])(
    'round-trips %s through the column unchanged',
    (value) => {
      const stored = toDbDate(value);
      expect(stored.toISOString()).toBe(`${value}T00:00:00.000Z`);
      expect(fromDbDate(stored)).toBe(value);
    },
  );

  it.each([
    ['2026-10-15', 0, '2026-10-15'],
    ['2026-10-15', 13, '2026-10-28'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2027-02-28', 1, '2027-03-01'],
  ])('counts %s plus %i days as %s, on the calendar', (day, count, next) => {
    expect(addDays(day, count)).toBe(next);
  });
});

/*
  The buckets, two ways: as the database filter (`deliveryBucketWhere`) and as the bucket each
  returned order is labelled with (`deliveryBucketOf`). A small evaluator runs the filter against
  a grid of dates and statuses, so the two can never disagree about an order.
*/
describe('the delivery buckets', () => {
  const DAY: BusinessDay = {
    timeZone: 'Asia/Dubai',
    today: '2026-10-15',
    tomorrow: '2026-10-16',
  };

  type Row = { deliveryDate: Date | null; status: LogisticsStatus };
  type Term = Prisma.LogisticsOrderWhereInput;

  /** Just the operators the bucket terms use, evaluated as Postgres would. */
  function matches(row: Row, term: Term): boolean {
    if (term.OR) return term.OR.some((each) => matches(row, each));
    const date = term.deliveryDate as
      Date | null | { gt?: Date; lt?: Date } | undefined;
    if (date === null && row.deliveryDate !== null) return false;
    if (date instanceof Date) {
      if (row.deliveryDate?.getTime() !== date.getTime()) return false;
    } else if (date) {
      if (row.deliveryDate === null) return false;
      if (date.gt && !(row.deliveryDate > date.gt)) return false;
      if (date.lt && !(row.deliveryDate < date.lt)) return false;
    }
    const status = term.status as { notIn: LogisticsStatus[] } | undefined;
    if (status && status.notIn.includes(row.status)) return false;
    return true;
  }

  const DATES = [
    null,
    '2026-09-30',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2027-01-01',
  ];
  const rows: Row[] = DATES.flatMap((date) =>
    Object.values(LogisticsStatus).map((status) => ({
      deliveryDate: date === null ? null : toDbDate(date),
      status,
    })),
  );

  it('puts every order in exactly the bucket it is labelled with, or in none', () => {
    for (const row of rows) {
      const label = deliveryBucketOf(
        row.deliveryDate && fromDbDate(row.deliveryDate),
        row.status,
        DAY,
      );
      const inBuckets = DELIVERY_BUCKETS.filter((bucket) =>
        matches(row, deliveryBucketWhere([bucket], DAY)),
      );
      expect(inBuckets).toEqual(label === null ? [] : [label]);
    }
  });

  it.each([
    ['today', '2026-10-15', true],
    ['today', '2026-10-16', false],
    ['tomorrow', '2026-10-16', true],
    ['tomorrow', '2026-10-15', false],
    ['tomorrow', '2026-10-17', false],
    ['future', '2026-10-17', true],
    ['future', '2026-10-16', false],
    ['overdue', '2026-10-14', true],
    ['overdue', '2026-10-15', false],
  ] as const)(
    '%s holds a dispatched order dated %s: %s',
    (bucket, date, held) => {
      const row = {
        deliveryDate: toDbDate(date),
        status: LogisticsStatus.DISPATCHED,
      };
      expect(matches(row, deliveryBucketWhere([bucket], DAY))).toBe(held);
    },
  );

  it.each([
    LogisticsStatus.DELIVERED,
    LogisticsStatus.CANCELLED,
    LogisticsStatus.RTO,
  ])('never calls a past %s order overdue', (status) => {
    const row = { deliveryDate: toDbDate('2026-10-01'), status };
    expect(matches(row, deliveryBucketWhere(['overdue'], DAY))).toBe(false);
    expect(deliveryBucketOf('2026-10-01', status, DAY)).toBeNull();
  });

  it('holds only undated orders in No Delivery Date', () => {
    const none = deliveryBucketWhere(['none'], DAY);
    expect(
      matches({ deliveryDate: null, status: LogisticsStatus.INITIAL }, none),
    ).toBe(true);
    expect(
      matches(
        {
          deliveryDate: toDbDate('2026-10-15'),
          status: LogisticsStatus.INITIAL,
        },
        none,
      ),
    ).toBe(false);
  });

  it('matches any of several buckets, and adds no term for none chosen', () => {
    const buckets: DeliveryBucket[] = ['today', 'none'];
    expect(deliveryBucketWhere(buckets, DAY)).toEqual({
      OR: [{ deliveryDate: toDbDate('2026-10-15') }, { deliveryDate: null }],
    });
    expect(deliveryBucketWhere(undefined, DAY)).toEqual({});
    expect(deliveryBucketWhere([], DAY)).toEqual({});
  });

  it('takes a chosen day as one more alternative, alone or beside buckets', () => {
    expect(deliveryBucketWhere(['overdue'], DAY, '2026-10-20')).toEqual({
      OR: [
        {
          deliveryDate: { lt: toDbDate('2026-10-15') },
          status: { notIn: ['DELIVERED', 'CANCELLED', 'RTO'] },
        },
        { deliveryDate: toDbDate('2026-10-20') },
      ],
    });
    for (const date of DATES.filter((each): each is string => each !== null)) {
      for (const row of rows) {
        expect(matches(row, deliveryBucketWhere(undefined, DAY, date))).toBe(
          row.deliveryDate !== null && fromDbDate(row.deliveryDate) === date,
        );
      }
    }
  });

  // The schedule counts from every bucket at once: exactly the orders some bucket labels.
  it('holds, with every bucket chosen, exactly the orders some bucket labels', () => {
    for (const row of rows) {
      const label = deliveryBucketOf(
        row.deliveryDate && fromDbDate(row.deliveryDate),
        row.status,
        DAY,
      );
      expect(matches(row, deliveryBucketWhere(DELIVERY_BUCKETS, DAY))).toBe(
        label !== null,
      );
    }
  });
});

/*
  The delivery-date migration only adds one nullable column: no backfill, no default, nothing
  dropped — and it leaves alone activities.completion_note (in the schema's history, not in
  schema.prisma, its fate undecided) and the pending GPS-removal migration.
*/
describe('the delivery-date migration', () => {
  const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
  const folders = readdirSync(dir).filter((entry) => !entry.includes('.'));
  const name = folders.find((entry) =>
    entry.endsWith('_logistics_delivery_date'),
  );
  const sql = readFileSync(join(dir, name ?? '', 'migration.sql'), 'utf8');
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();

  it('adds one nullable DATE column to logistics_orders, and nothing else', () => {
    expect(statements).toBe(
      'ALTER TABLE "logistics_orders" ADD COLUMN "delivery_date" DATE;',
    );
  });

  it('comes after every migration in the history before it, the GPS removal included', () => {
    const sorted = folders.sort();
    expect(sorted.indexOf(name ?? '')).toBeGreaterThan(
      sorted.indexOf('20261014090000_rename_tag_access_department_to_team'),
    );
    expect(sorted.indexOf(name ?? '')).toBeGreaterThan(
      sorted.indexOf('20261008120000_remove_gps_module'),
    );
    expect(folders).toContain('20261008120000_remove_gps_module');
  });
});
