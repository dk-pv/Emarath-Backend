import { BadRequestException } from '@nestjs/common';
import {
  leadConditionWhere,
  parseLeadConditions,
  type LeadCondition,
} from './lead-conditions';

describe('parseLeadConditions', () => {
  it('returns [] for an absent or blank param', () => {
    expect(parseLeadConditions(undefined)).toEqual([]);
    expect(parseLeadConditions('   ')).toEqual([]);
  });

  it('parses a valid enum + date + user set', () => {
    const raw = JSON.stringify([
      { field: 'status', operator: 'is', values: ['WON', 'New'] },
      {
        field: 'createdAt',
        operator: 'between',
        values: ['2026-06-04T00:00:00.000Z', '2026-06-06T00:00:00.000Z'],
      },
      { field: 'assignedAgent', operator: 'isEmpty', values: [] },
    ]);
    const parsed = parseLeadConditions(raw);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({
      field: 'status',
      operator: 'is',
      values: ['WON', 'New'],
    });
    // isEmpty carries no value even if some were sent.
    expect(parsed[2].values).toEqual([]);
  });

  it('rejects an unknown field, a bad operator, and a range without two values', () => {
    expect(() =>
      parseLeadConditions(
        JSON.stringify([{ field: 'ssn', operator: 'is', values: ['x'] }]),
      ),
    ).toThrow(BadRequestException);
    // date-only operator on an enum field
    expect(() =>
      parseLeadConditions(
        JSON.stringify([
          { field: 'status', operator: 'between', values: ['a', 'b'] },
        ]),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      parseLeadConditions(
        JSON.stringify([
          { field: 'createdAt', operator: 'between', values: ['only-one'] },
        ]),
      ),
    ).toThrow(BadRequestException);
    expect(() => parseLeadConditions('not json')).toThrow(BadRequestException);
  });

  it('rejects a value-requiring operator with no values', () => {
    expect(() =>
      parseLeadConditions(
        JSON.stringify([{ field: 'status', operator: 'is', values: [] }]),
      ),
    ).toThrow(BadRequestException);
  });
});

describe('leadConditionWhere', () => {
  const build = (c: LeadCondition) => leadConditionWhere([c])[0];

  it('maps enum operators', () => {
    expect(build({ field: 'status', operator: 'is', values: ['WON'] })).toEqual(
      { status: { in: ['WON'] } },
    );
    expect(
      build({ field: 'status', operator: 'isnt', values: ['WON'] }),
    ).toEqual({ NOT: { status: { in: ['WON'] } } });
    expect(build({ field: 'source', operator: 'isEmpty', values: [] })).toEqual(
      { OR: [{ source: null }, { source: '' }] },
    );
    expect(
      build({ field: 'source', operator: 'isNotEmpty', values: [] }),
    ).toEqual({ NOT: { OR: [{ source: null }, { source: '' }] } });
  });

  it('maps date operators to half-open ranges', () => {
    const a = '2026-06-04T00:00:00.000Z';
    const b = '2026-06-06T00:00:00.000Z';
    expect(
      build({ field: 'createdAt', operator: 'between', values: [a, b] }),
    ).toEqual({ createdAt: { gte: new Date(a), lt: new Date(b) } });
    expect(
      build({ field: 'createdAt', operator: 'before', values: [a] }),
    ).toEqual({ createdAt: { lt: new Date(a) } });
    expect(
      build({ field: 'createdAt', operator: 'after', values: [a] }),
    ).toEqual({ createdAt: { gte: new Date(a) } });
    expect(
      build({ field: 'createdAt', operator: 'notBetween', values: [a, b] }),
    ).toEqual({
      OR: [
        { createdAt: { lt: new Date(a) } },
        { createdAt: { gte: new Date(b) } },
      ],
    });
    expect(
      build({ field: 'bookingDate', operator: 'isEmpty', values: [] }),
    ).toEqual({ bookingDate: null });
  });

  it('maps user operators through the assignment join', () => {
    expect(
      build({ field: 'assignedAgent', operator: 'is', values: ['u1'] }),
    ).toEqual({ assignments: { some: { userId: { in: ['u1'] } } } });
    expect(
      build({ field: 'assignedAgent', operator: 'isnt', values: ['u1'] }),
    ).toEqual({ NOT: { assignments: { some: { userId: { in: ['u1'] } } } } });
    expect(
      build({ field: 'assignedAgent', operator: 'isEmpty', values: [] }),
    ).toEqual({ assignments: { none: {} } });
    expect(
      build({ field: 'assignedAgent', operator: 'isNotEmpty', values: [] }),
    ).toEqual({ assignments: { some: {} } });
  });

  it('maps numeric operators', () => {
    expect(
      build({
        field: 'actualAmount',
        operator: 'greaterThan',
        values: ['10000'],
      }),
    ).toEqual({ actualAmount: { gt: 10000 } });
    expect(
      build({
        field: 'actualAmount',
        operator: 'between',
        values: ['10000', '20000'],
      }),
    ).toEqual({ actualAmount: { gte: 10000, lte: 20000 } });
    expect(
      build({ field: 'callAttempts', operator: 'equals', values: ['3'] }),
    ).toEqual({ callAttempts: { equals: 3 } });
    expect(
      build({ field: 'forecastedAmount', operator: 'isEmpty', values: [] }),
    ).toEqual({ forecastedAmount: null });
  });

  it('maps text operators (case-insensitive)', () => {
    expect(
      build({ field: 'name', operator: 'contains', values: ['test'] }),
    ).toEqual({ name: { contains: 'test', mode: 'insensitive' } });
    expect(
      build({ field: 'name', operator: 'doesntContain', values: ['x'] }),
    ).toEqual({ NOT: { name: { contains: 'x', mode: 'insensitive' } } });
    expect(
      build({ field: 'firstName', operator: 'startsWith', values: ['A'] }),
    ).toEqual({ firstName: { startsWith: 'A', mode: 'insensitive' } });
    expect(build({ field: 'city', operator: 'isEmpty', values: [] })).toEqual({
      OR: [{ city: null }, { city: '' }],
    });
  });

  it('maps tags and relation-date joins', () => {
    expect(build({ field: 'tags', operator: 'is', values: ['t1'] })).toEqual({
      tags: { some: { tagId: { in: ['t1'] } } },
    });
    expect(build({ field: 'tags', operator: 'isEmpty', values: [] })).toEqual({
      tags: { none: {} },
    });
    const d = '2026-06-04T00:00:00.000Z';
    expect(
      build({ field: 'assignedDate', operator: 'before', values: [d] }),
    ).toEqual({ assignments: { some: { createdAt: { lt: new Date(d) } } } });
    expect(
      build({ field: 'followUpDate', operator: 'isNotEmpty', values: [] }),
    ).toEqual({ activities: { some: { deletedAt: null } } });
  });

  it('rejects a non-numeric value for a numeric field', () => {
    expect(() =>
      parseLeadConditions(
        JSON.stringify([
          { field: 'actualAmount', operator: 'equals', values: ['abc'] },
        ]),
      ),
    ).toThrow(BadRequestException);
  });

  it('matches team through the assignee (the Leads By Status drill-down)', () => {
    expect(
      leadConditionWhere([
        { field: 'team', operator: 'is', values: ['Sales'] } as LeadCondition,
      ]),
    ).toEqual([
      { assignments: { some: { user: { team: { in: ['Sales'] } } } } },
    ]);
    expect(
      parseLeadConditions(
        JSON.stringify([
          { field: 'team', operator: 'isnt', values: ['Sales'] },
        ]),
      ),
    ).toHaveLength(1);
  });

  it('matches Activity through the shared engagement predicates', () => {
    const [contacted] = leadConditionWhere([
      {
        field: 'activity',
        operator: 'is',
        values: ['Contacted'],
      } as LeadCondition,
    ]);
    expect(JSON.stringify(contacted)).toContain('"outcome":"ANSWERED"');
    const [none] = leadConditionWhere([
      {
        field: 'activity',
        operator: 'is',
        values: ['No Activity'],
      } as LeadCondition,
    ]);
    expect(none.activities?.none).toBeDefined();
    expect(none.calls?.none).toBeDefined();
  });
});

const where = (c: LeadCondition) => leadConditionWhere([c])[0];
const parse = (c: object) => () => parseLeadConditions(JSON.stringify([c]));

describe('empty-value operators on NOT NULL columns', () => {
  // Prisma rejects a null filter on a required column; these used to be HTTP 500s.
  it('treats a required text/enum column as empty only when it is the empty string', () => {
    expect(where({ field: 'name', operator: 'isEmpty', values: [] })).toEqual({
      name: '',
    });
    expect(
      where({ field: 'primaryPhone', operator: 'isNotEmpty', values: [] }),
    ).toEqual({ NOT: { primaryPhone: '' } });
    expect(where({ field: 'status', operator: 'isEmpty', values: [] })).toEqual(
      { status: '' },
    );
    expect(
      where({ field: 'pipeline', operator: 'isNotEmpty', values: [] }),
    ).toEqual({ NOT: { pipeline: '' } });
  });

  it('matches nothing / everything for a required number or date column', () => {
    for (const field of [
      'callAttempts',
      'whatsappAttempts',
      'createdAt',
      'statusChangedAt',
    ]) {
      expect(where({ field, operator: 'isEmpty', values: [] })).toEqual({
        id: { in: [] },
      });
      expect(where({ field, operator: 'isNotEmpty', values: [] })).toEqual({});
    }
  });

  it('never emits a null filter for a required column, whatever the operator', () => {
    for (const field of ['name', 'primaryPhone']) {
      for (const operator of [
        'isnt',
        'doesntContain',
        'isEmpty',
        'isNotEmpty',
      ]) {
        const built = JSON.stringify(
          where({ field, operator, values: ['x'] } as LeadCondition),
        );
        expect(built).not.toContain('null');
      }
    }
  });
});

describe('negative operators keep the leads with no value', () => {
  it("text isn't / doesn't contain on a nullable column", () => {
    expect(
      where({ field: 'country', operator: 'isnt', values: ['Qatar'] }),
    ).toEqual({
      OR: [
        { NOT: { country: { equals: 'Qatar', mode: 'insensitive' } } },
        { country: null },
      ],
    });
    expect(
      where({ field: 'city', operator: 'doesntContain', values: ['Doha'] }),
    ).toEqual({
      OR: [
        { NOT: { city: { contains: 'Doha', mode: 'insensitive' } } },
        { city: null },
      ],
    });
  });

  it("enum isn't, number not-equals / not-between and date not-between", () => {
    expect(
      where({ field: 'category', operator: 'isnt', values: ['Logistics'] }),
    ).toEqual({
      OR: [{ NOT: { category: { in: ['Logistics'] } } }, { category: null }],
    });
    expect(
      where({ field: 'actualAmount', operator: 'notEquals', values: ['747'] }),
    ).toEqual({ OR: [{ actualAmount: { not: 747 } }, { actualAmount: null }] });
    expect(
      where({
        field: 'actualAmount',
        operator: 'notBetween',
        values: ['100', '1000'],
      }),
    ).toEqual({
      OR: [
        { OR: [{ actualAmount: { lt: 100 } }, { actualAmount: { gt: 1000 } }] },
        { actualAmount: null },
      ],
    });
    const a = '2026-10-04';
    const b = '2026-10-06';
    expect(
      where({ field: 'bookingDate', operator: 'notBetween', values: [a, b] }),
    ).toEqual({
      OR: [
        {
          OR: [
            { bookingDate: { lt: new Date(a) } },
            { bookingDate: { gte: new Date(b) } },
          ],
        },
        { bookingDate: null },
      ],
    });
  });

  it('keeps a required column’s negative free of a null branch', () => {
    expect(
      where({ field: 'status', operator: 'isnt', values: ['WON'] }),
    ).toEqual({ NOT: { status: { in: ['WON'] } } });
  });

  it('relation-date not-between means no row inside the range', () => {
    const a = '2026-10-01T00:00:00.000Z';
    const b = '2026-10-08T00:00:00.000Z';
    expect(
      where({ field: 'followUpDate', operator: 'notBetween', values: [a, b] }),
    ).toEqual({
      NOT: {
        activities: {
          some: {
            deletedAt: null,
            dueAt: { gte: new Date(a), lt: new Date(b) },
          },
        },
      },
    });
  });
});

describe('text values are matched literally', () => {
  it('escapes % and _ in every text operator, as search does', () => {
    expect(where({ field: 'name', operator: 'is', values: ['50%_x'] })).toEqual(
      {
        name: { equals: '50\\%\\_x', mode: 'insensitive' },
      },
    );
    expect(
      where({ field: 'name', operator: 'contains', values: ['_'] }),
    ).toEqual({ name: { contains: '\\_', mode: 'insensitive' } });
    expect(
      where({ field: 'complaints', operator: 'contains', values: ['100%'] }),
    ).toEqual({
      complaints: {
        some: {
          deletedAt: null,
          details: { contains: '100\\%', mode: 'insensitive' },
        },
      },
    });
  });
});

describe('malformed values are a 400, never a database error', () => {
  it('rejects an unparseable date and an on with one boundary', () => {
    expect(
      parse({ field: 'createdAt', operator: 'after', values: ['yesterday'] }),
    ).toThrow(BadRequestException);
    expect(
      parse({ field: 'followUpDate', operator: 'before', values: ['soon'] }),
    ).toThrow(BadRequestException);
    expect(
      parse({
        field: 'createdAt',
        operator: 'on',
        values: ['2026-10-07T00:00:00.000Z'],
      }),
    ).toThrow(BadRequestException);
    expect(
      parse({
        field: 'bookingDate',
        operator: 'on',
        values: ['2026-10-05', '2026-10-06'],
      })(),
    ).toHaveLength(1);
  });

  it('rejects a non-uuid user or tag id', () => {
    expect(
      parse({ field: 'assignedAgent', operator: 'is', values: ['abc'] }),
    ).toThrow(BadRequestException);
    expect(parse({ field: 'tags', operator: 'isnt', values: ['abc'] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a fractional or out-of-range count', () => {
    expect(
      parse({ field: 'callAttempts', operator: 'equals', values: ['1.5'] }),
    ).toThrow(BadRequestException);
    expect(
      parse({
        field: 'whatsappAttempts',
        operator: 'lessThan',
        values: ['3000000000'],
      }),
    ).toThrow(BadRequestException);
    // A decimal column still takes a fraction.
    expect(
      parse({ field: 'actualAmount', operator: 'equals', values: ['99.5'] })(),
    ).toHaveLength(1);
  });

  it('rejects an unknown Activity value', () => {
    expect(
      parse({ field: 'activity', operator: 'is', values: ['foo'] }),
    ).toThrow(BadRequestException);
    expect(
      parse({ field: 'activity', operator: 'is', values: ['No Activity'] })(),
    ).toHaveLength(1);
  });
});

describe('date + time ranges (client request 2026-10-13)', () => {
  // The client sends a picked day/time as local instants. 10:00 AM to 3:00 PM on the 13th
  // in UAE time (UTC+4) is [06:00Z, 11:01Z): the end edge sits one minute past 3:00 PM so
  // the whole 3:00 PM minute is inside. Only the instants matter here — the engine has no
  // notion of a time zone.
  const start = '2026-10-13T06:00:00.000Z';
  const end = '2026-10-13T11:01:00.000Z';
  const window = (field: string, values: string[], operator = 'between') =>
    where({ field, operator, values } as LeadCondition);

  /** What the database does with a `{ gte, lt }` fragment, for the boundary cases below. */
  const matches = (range: { gte?: Date; lt?: Date }, at: string): boolean => {
    const t = Date.parse(at);
    return (
      (range.gte === undefined || t >= range.gte.getTime()) &&
      (range.lt === undefined || t < range.lt.getTime())
    );
  };

  it('compares a same-day 10:00–15:00 window as [gte start, lt end) on every timestamp column', () => {
    for (const field of ['createdAt', 'statusChangedAt']) {
      expect(window(field, [start, end])).toEqual({
        [field]: { gte: new Date(start), lt: new Date(end) },
      });
    }
    // Through a join, the same bounds reach the related row.
    expect(window('assignedDate', [start, end])).toEqual({
      assignments: {
        some: { createdAt: { gte: new Date(start), lt: new Date(end) } },
      },
    });
    expect(window('followUpDate', [start, end])).toEqual({
      activities: {
        some: {
          deletedAt: null,
          dueAt: { gte: new Date(start), lt: new Date(end) },
        },
      },
    });
  });

  it('includes 10:00:00 through the end of the 3:00 PM minute and nothing outside', () => {
    const { createdAt } = window('createdAt', [start, end]) as {
      createdAt: { gte: Date; lt: Date };
    };
    // 10:00 AM UAE is 06:00Z.
    expect(matches(createdAt, '2026-10-13T05:59:59.999Z')).toBe(false); // 9:59:59.999 AM
    expect(matches(createdAt, '2026-10-13T06:00:00.000Z')).toBe(true); // 10:00:00 AM
    expect(matches(createdAt, '2026-10-13T09:30:00.000Z')).toBe(true);
    expect(matches(createdAt, '2026-10-13T11:00:00.000Z')).toBe(true); // 3:00:00 PM
    expect(matches(createdAt, '2026-10-13T11:00:59.999Z')).toBe(true); // end of 3:00 PM
    expect(matches(createdAt, '2026-10-13T11:01:00.000Z')).toBe(false); // 3:01 PM
    expect(matches(createdAt, '2026-10-12T08:00:00.000Z')).toBe(false); // previous day
    expect(matches(createdAt, '2026-10-14T08:00:00.000Z')).toBe(false); // next day
  });

  it('keeps a whole-day window exactly as it was when no time is picked', () => {
    // The 13th in UAE time with no time set: local midnight to the next local midnight.
    const dayStart = '2026-10-12T20:00:00.000Z';
    const dayEnd = '2026-10-13T20:00:00.000Z';
    expect(window('createdAt', [dayStart, dayEnd], 'on')).toEqual({
      createdAt: { gte: new Date(dayStart), lt: new Date(dayEnd) },
    });
  });

  it('maps On / Before / After with a time to that minute, before it, and after it', () => {
    const at = '2026-10-13T06:00:00.000Z'; // 10:00 AM UAE
    const next = '2026-10-13T06:01:00.000Z';
    expect(window('createdAt', [at, next], 'on')).toEqual({
      createdAt: { gte: new Date(at), lt: new Date(next) },
    });
    expect(window('createdAt', [at], 'before')).toEqual({
      createdAt: { lt: new Date(at) },
    });
    expect(window('createdAt', [next], 'after')).toEqual({
      createdAt: { gte: new Date(next) },
    });
  });

  it('maps Not Between with times to the two sides outside the window', () => {
    expect(window('createdAt', [start, end], 'notBetween')).toEqual({
      OR: [
        { createdAt: { lt: new Date(start) } },
        { createdAt: { gte: new Date(end) } },
      ],
    });
    // On a join, no related row may fall inside the window.
    expect(window('followUpDate', [start, end], 'notBetween')).toEqual({
      NOT: {
        activities: {
          some: {
            deletedAt: null,
            dueAt: { gte: new Date(start), lt: new Date(end) },
          },
        },
      },
    });
  });

  it('spans days, months and years by instants alone', () => {
    // 13 Oct 10:00 PM → 15 Oct 6:00 AM, UAE time.
    const a = '2026-10-13T18:00:00.000Z';
    const b = '2026-10-15T02:01:00.000Z';
    const { createdAt } = window('createdAt', [a, b]) as {
      createdAt: { gte: Date; lt: Date };
    };
    expect(matches(createdAt, '2026-10-13T17:59:00.000Z')).toBe(false);
    expect(matches(createdAt, '2026-10-14T09:00:00.000Z')).toBe(true);
    expect(matches(createdAt, '2026-10-15T02:00:30.000Z')).toBe(true);
    expect(matches(createdAt, '2026-10-15T02:01:00.000Z')).toBe(false);

    // 31 Dec 11:30 PM → 1 Jan 12:30 AM, UAE time.
    const ny = window('createdAt', [
      '2026-12-31T19:30:00.000Z',
      '2026-12-31T20:31:00.000Z',
    ]) as { createdAt: { gte: Date; lt: Date } };
    expect(matches(ny.createdAt, '2026-12-31T19:29:59.999Z')).toBe(false);
    expect(matches(ny.createdAt, '2026-12-31T20:30:59.999Z')).toBe(true);
    expect(matches(ny.createdAt, '2026-12-31T20:31:00.000Z')).toBe(false);
  });

  it('treats midnight as an ordinary instant: 12:00 AM is included from, and 11:59 PM through', () => {
    // 12:00 AM → 12:00 AM on the 13th, UAE time: only that first minute.
    const first = window('createdAt', [
      '2026-10-12T20:00:00.000Z',
      '2026-10-12T20:01:00.000Z',
    ]) as { createdAt: { gte: Date; lt: Date } };
    expect(matches(first.createdAt, '2026-10-12T19:59:59.999Z')).toBe(false);
    expect(matches(first.createdAt, '2026-10-12T20:00:00.000Z')).toBe(true);
    expect(matches(first.createdAt, '2026-10-12T20:00:59.999Z')).toBe(true);
    expect(matches(first.createdAt, '2026-10-12T20:01:00.000Z')).toBe(false);
  });

  it('leaves a DATE column on calendar days: it has no time of day to compare', () => {
    expect(
      window('bookingDate', ['2026-10-13', '2026-10-14'], 'between'),
    ).toEqual({
      bookingDate: { gte: new Date('2026-10-13'), lt: new Date('2026-10-14') },
    });
  });

  it('refuses a window that ends at or before it starts', () => {
    for (const operator of ['between', 'notBetween', 'on']) {
      expect(
        parse({ field: 'createdAt', operator, values: [end, start] }),
      ).toThrow(BadRequestException);
      expect(
        parse({ field: 'createdAt', operator, values: [start, start] }),
      ).toThrow(BadRequestException);
      expect(
        parse({ field: 'followUpDate', operator, values: [end, start] }),
      ).toThrow(BadRequestException);
    }
    // The smallest window the picker can make — one minute — is fine.
    expect(
      parse({
        field: 'createdAt',
        operator: 'between',
        values: ['2026-10-13T06:00:00.000Z', '2026-10-13T06:01:00.000Z'],
      })(),
    ).toHaveLength(1);
    // A number range keeps its own rule (inclusive, so an inverted one is simply empty).
    expect(
      parse({
        field: 'actualAmount',
        operator: 'between',
        values: ['1000', '100'],
      })(),
    ).toHaveLength(1);
  });

  it('refuses a date that is not a real calendar day instead of shifting it', () => {
    // `Date.parse('2026-02-30')` is 2 March: accepted, the window would silently move.
    for (const bad of [
      '2026-02-30T10:00:00.000Z',
      '2026-04-31T10:00:00.000Z',
      '2027-02-29T10:00:00.000Z',
      '2026-13-01T10:00:00.000Z',
      '2026-10-13T25:00:00.000Z',
      '2026-10-13T10:60:00.000Z',
      '13-10-2026',
      'yesterday',
    ]) {
      expect(
        parse({ field: 'createdAt', operator: 'after', values: [bad] }),
      ).toThrow(BadRequestException);
      expect(
        parse({
          field: 'followUpDate',
          operator: 'between',
          values: [bad, '2030-01-01T00:00:00.000Z'],
        }),
      ).toThrow(BadRequestException);
    }
    expect(
      parse({
        field: 'bookingDate',
        operator: 'on',
        values: ['2026-04-31', '2026-05-01'],
      }),
    ).toThrow(BadRequestException);
    // A leap day is real.
    expect(
      parse({
        field: 'createdAt',
        operator: 'after',
        values: ['2028-02-29T10:00:00.000Z'],
      })(),
    ).toHaveLength(1);
  });
});
