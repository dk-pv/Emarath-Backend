import { escapeLike, leadSearchWhere } from './lead-search';

describe('escapeLike', () => {
  it('escapes LIKE wildcards so they match literally', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
  });

  it('escapes the backslash before the characters it escapes', () => {
    // A raw "\%" must become "\\\%": the backslash escaped, then the percent.
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('Ahmed Hassan')).toBe('Ahmed Hassan');
    expect(escapeLike('971510')).toBe('971510');
  });
});

describe('leadSearchWhere', () => {
  it('returns undefined for an empty or whitespace term (AC5)', () => {
    expect(leadSearchWhere(undefined)).toBeUndefined();
    expect(leadSearchWhere('')).toBeUndefined();
    expect(leadSearchWhere('   ')).toBeUndefined();
  });

  it('matches name (case-insensitive) OR primary phone (AC1, AC3)', () => {
    expect(leadSearchWhere('ahmed')).toEqual({
      OR: [
        { name: { contains: 'ahmed', mode: 'insensitive' } },
        { primaryPhone: { contains: 'ahmed' } },
      ],
    });
  });

  it('searches only name and primary phone — never firstName or secondaryPhone', () => {
    const where = leadSearchWhere('x');
    const fields = where!.OR!.flatMap((clause) => Object.keys(clause));
    expect(fields.sort()).toEqual(['name', 'primaryPhone']);
  });

  it('trims the term before matching', () => {
    expect(leadSearchWhere('  ahmed  ')).toEqual({
      OR: [
        { name: { contains: 'ahmed', mode: 'insensitive' } },
        { primaryPhone: { contains: 'ahmed' } },
      ],
    });
  });

  it('escapes wildcards in the term', () => {
    const where = leadSearchWhere('50%');
    expect(where).toEqual({
      OR: [
        { name: { contains: '50\\%', mode: 'insensitive' } },
        { primaryPhone: { contains: '50\\%' } },
      ],
    });
  });
});
