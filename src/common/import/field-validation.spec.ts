import { validateField } from './field-validation';
import { ImportField } from './import-descriptor';

const field = (over: Partial<ImportField>): ImportField => ({
  value: 'x',
  label: 'X',
  type: 'string',
  ...over,
});

describe('validateField', () => {
  it('rejects an empty required field', () => {
    const result = validateField(field({ required: true }), '   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.errorCode).toBe('REQUIRED_FIELD_MISSING');
    }
  });

  it('treats an empty optional field as an empty value', () => {
    expect(validateField(field({}), '')).toEqual({ ok: true, value: '' });
  });

  it('strips thousands separators from a decimal', () => {
    expect(validateField(field({ type: 'decimal' }), '1,250.00')).toEqual({
      ok: true,
      value: '1250.00',
    });
  });

  it('refuses a decimal comma instead of reading 12,50 as 1250', () => {
    expect(validateField(field({ type: 'decimal' }), '12,50').ok).toBe(false);
    expect(validateField(field({ type: 'decimal' }), '1,250,000')).toEqual({
      ok: true,
      value: '1250000',
    });
    expect(validateField(field({ type: 'int' }), '1,5').ok).toBe(false);
  });

  it('says when Excel has shortened a phone to 9.71501E+11', () => {
    const result = validateField(field({ type: 'phone' }), '9.71501E+11');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.errorCode).toBe('INVALID_PHONE');
      expect(result.failure.reason).toContain('shortened by Excel');
    }
  });

  it('rejects a non-numeric decimal as INVALID_NUMBER', () => {
    const result = validateField(field({ type: 'decimal' }), 'abc');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.errorCode).toBe('INVALID_NUMBER');
  });

  it('accepts an integer but rejects a fractional int', () => {
    expect(validateField(field({ type: 'int' }), '3')).toEqual({
      ok: true,
      value: '3',
    });
    expect(validateField(field({ type: 'int' }), '3.5').ok).toBe(false);
  });

  it('accepts an ISO date and rejects a non-date', () => {
    expect(validateField(field({ type: 'date' }), '2026-07-20')).toEqual({
      ok: true,
      value: '2026-07-20',
    });
    const bad = validateField(field({ type: 'date' }), 'not-a-date');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.failure.errorCode).toBe('INVALID_DATE');
  });

  it('rejects an ambiguous or impossible date instead of guessing', () => {
    // 08/10/2026 is 8 October in the UAE but 10 August to `new Date`.
    for (const raw of ['08/10/2026', '10-08-2026', '2026-02-30']) {
      expect(validateField(field({ type: 'date' }), raw).ok).toBe(false);
    }
  });

  it('says when a date is in the regional format Excel saves to a CSV', () => {
    const result = validateField(field({ type: 'date' }), '20-10-2026');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toContain('regional date');
  });

  it('refuses the parser’s Invalid Date marker in any field', () => {
    for (const type of ['string', 'phone', 'date'] as const) {
      const result = validateField(field({ type }), 'Invalid Date');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.errorCode).toBe('INVALID_DATE');
    }
  });

  it('rejects year 0000, which Postgres cannot store', () => {
    expect(validateField(field({ type: 'date' }), '0000-01-01').ok).toBe(false);
    expect(validateField(field({ type: 'date' }), '0001-01-01').ok).toBe(true);
  });

  it('stores a phone as digits only, country code first, like the New Lead form', () => {
    const phone = field({ type: 'phone' });
    expect(validateField(phone, '+971 50-123 4567')).toEqual({
      ok: true,
      value: '971501234567',
    });
    expect(validateField(phone, '00971501234567')).toEqual({
      ok: true,
      value: '971501234567',
    });
    expect(validateField(phone, '0501234567')).toEqual({
      ok: true,
      value: '0501234567',
    });
  });

  it('rejects a phone with letters or the wrong number of digits', () => {
    for (const raw of [
      'N/A',
      '12345',
      '0501234567 ext 2',
      '1234567890123456',
    ]) {
      const result = validateField(field({ type: 'phone' }), raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.errorCode).toBe('INVALID_PHONE');
    }
  });

  it('validates an email the way CreateLeadDto does', () => {
    expect(validateField(field({ type: 'email' }), ' a@b.co ')).toEqual({
      ok: true,
      value: 'a@b.co',
    });
    const bad = validateField(field({ type: 'email' }), 'a@b');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.failure.errorCode).toBe('INVALID_EMAIL');
  });

  it('matches an option ignoring case and stores its own spelling', () => {
    const status = field({ label: 'Lead Status', options: ['New', 'HOT'] });
    expect(validateField(status, 'hot')).toEqual({ ok: true, value: 'HOT' });

    const bad = validateField(status, 'Warmish');
    expect(bad).toEqual({
      ok: false,
      failure: {
        errorCode: 'INVALID_OPTION',
        reason:
          'Lead Status "Warmish" is not a recognised value (use one of: New, HOT)',
      },
    });
  });

  it('rejects an amount wider than Decimal(12,2)', () => {
    const amount = field({ type: 'decimal' });
    expect(validateField(amount, '9999999999.99').ok).toBe(true);
    expect(validateField(amount, '12345678901').ok).toBe(false);
    expect(validateField(amount, '10.555').ok).toBe(false);
  });

  it('caps a count at the CreateLeadDto attempts ceiling', () => {
    expect(validateField(field({ type: 'int' }), '1000').ok).toBe(true);
    expect(validateField(field({ type: 'int' }), '1001').ok).toBe(false);
  });

  it('flags an over-length string as VALUE_TOO_LONG', () => {
    const result = validateField(field({ maxLength: 3 }), 'abcd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.errorCode).toBe('VALUE_TOO_LONG');
  });
});
