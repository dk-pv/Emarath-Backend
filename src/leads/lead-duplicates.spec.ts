import { duplicateWhere, matchedField, pickOriginal } from './lead-duplicates';

describe('duplicateWhere', () => {
  it('matches either phone against either of a lead’s phones, and the email', () => {
    const where = duplicateWhere(
      {
        primaryPhone: '+971500000001',
        secondaryPhone: '+971500000002',
        email: 'a@b.com',
      },
      false,
    );

    expect(where?.OR).toEqual([
      { primaryPhone: { in: ['+971500000001', '+971500000002'] } },
      { secondaryPhone: { in: ['+971500000001', '+971500000002'] } },
      { email: { equals: 'a@b.com', mode: 'insensitive' } },
    ]);
  });

  // Regression: the email is an ILIKE pattern to PostgreSQL, so "%" matched every address — an
  // unrelated lead recorded as the original, and a duplicate check that answered for any pattern.
  it('matches the email literally: % _ and \\ are escaped, case still ignored', () => {
    const where = duplicateWhere(
      { primaryPhone: '+971500000001', email: 'A_b%c\\d@X.com' },
      false,
    );
    expect(where?.OR).toContainEqual({
      email: { equals: 'A\\_b\\%c\\\\d@X.com', mode: 'insensitive' },
    });
  });

  it('excludes archived leads by default', () => {
    const where = duplicateWhere({ primaryPhone: '+971500000001' }, false);
    expect(where?.deletedAt).toBeNull();
  });

  it('includes archived leads when the setting is on', () => {
    const where = duplicateWhere({ primaryPhone: '+971500000001' }, true);
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('ignores blank and whitespace-only values', () => {
    const where = duplicateWhere(
      { primaryPhone: '+971500000001', secondaryPhone: '   ', email: '' },
      false,
    );
    expect(where?.OR).toHaveLength(2);
  });

  it('returns null when there is nothing to match on, so no query runs', () => {
    expect(duplicateWhere({ primaryPhone: '   ' }, false)).toBeNull();
  });
});

describe('matchedField', () => {
  const lead = {
    primaryPhone: '+971500000009',
    secondaryPhone: '+971500000008',
    email: 'known@example.com',
  };

  it('names the primary phone first', () => {
    expect(
      matchedField(
        { primaryPhone: '+971500000009', email: 'known@example.com' },
        lead,
      ),
    ).toBe('primaryPhone');
  });

  it('names the secondary phone when only that matches', () => {
    expect(matchedField({ primaryPhone: '+971500000008' }, lead)).toBe(
      'secondaryPhone',
    );
  });

  it('falls back to email', () => {
    expect(
      matchedField(
        { primaryPhone: '+971599999999', email: 'known@example.com' },
        lead,
      ),
    ).toBe('email');
  });
});

describe('pickOriginal (ADR-0092)', () => {
  const lead = (
    id: string,
    day: number,
    duplicateOfId: string | null = null,
  ) => ({
    id,
    createdAt: new Date(Date.UTC(2026, 0, day)),
    duplicateOfId,
  });

  it('has no original when nothing matched', () => {
    expect(pickOriginal([])).toBeNull();
  });

  it('picks the only match', () => {
    expect(pickOriginal([lead('a', 5)])).toBe('a');
  });

  it('picks the oldest match', () => {
    expect(pickOriginal([lead('new', 9), lead('old', 2), lead('mid', 5)])).toBe(
      'old',
    );
  });

  it('prefers a match that is not itself a duplicate, even over an older one that is', () => {
    // "dup" is older but is recorded as a duplicate of something else; "root" is the original.
    expect(pickOriginal([lead('dup', 1, 'somebody'), lead('root', 8)])).toBe(
      'root',
    );
  });

  it('keeps one customer’s leads in a star: later arrivals point at the first, not the latest', () => {
    const first = lead('first', 1);
    const second = lead('second', 2, 'first');
    const third = lead('third', 3, 'first');
    expect(pickOriginal([third, second, first])).toBe('first');
  });

  it('falls back to the oldest match when every match is itself a duplicate', () => {
    expect(
      pickOriginal([lead('b', 4, 'x'), lead('a', 2, 'y'), lead('c', 6, 'z')]),
    ).toBe('a');
  });

  it('breaks a tie on creation time by id, so read order never changes the answer', () => {
    // Leads written by one import batch share a timestamp.
    expect(pickOriginal([lead('b', 3), lead('a', 3)])).toBe('a');
    expect(pickOriginal([lead('a', 3), lead('b', 3)])).toBe('a');
  });

  it('does not mutate the list it is given', () => {
    const matches = [lead('b', 3), lead('a', 1)];
    pickOriginal(matches);
    expect(matches.map((m) => m.id)).toEqual(['b', 'a']);
  });
});
