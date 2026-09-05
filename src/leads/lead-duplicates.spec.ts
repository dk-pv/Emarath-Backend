import { duplicateWhere, matchedField } from './lead-duplicates';

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
