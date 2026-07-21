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

  it('normalises an ISO date and rejects a non-date', () => {
    expect(validateField(field({ type: 'date' }), '2026-07-20')).toEqual({
      ok: true,
      value: '2026-07-20',
    });
    const bad = validateField(field({ type: 'date' }), 'not-a-date');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.failure.errorCode).toBe('INVALID_DATE');
  });

  it('flags an over-length string as VALUE_TOO_LONG', () => {
    const result = validateField(field({ maxLength: 3 }), 'abcd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.errorCode).toBe('VALUE_TOO_LONG');
  });
});
