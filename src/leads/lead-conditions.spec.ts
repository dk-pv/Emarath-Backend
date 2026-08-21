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
    ).toEqual({ AND: [{ source: { not: null } }, { source: { not: '' } }] });
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
});
