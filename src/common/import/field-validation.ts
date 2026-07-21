import { ImportErrorCode, ImportField } from './import-descriptor';

/**
 * Validates and cleans one raw cell against a target field (LEAD-07.1 AC2).
 *
 * Returns the cleaned string to store on success, or a single error code + reason
 * on failure. Cleaning is intentionally forgiving of the shapes real spreadsheets
 * carry — thousands separators in amounts, stray whitespace — because the goal is
 * to load data captured outside the system, not to reject it for cosmetics. What
 * it never does is coerce a genuinely wrong value into a plausible one: a
 * non-numeric amount fails rather than becoming zero.
 */
export interface FieldFailure {
  errorCode: ImportErrorCode;
  reason: string;
}

export type FieldResult =
  { ok: true; value: string } | { ok: false; failure: FieldFailure };

/** Non-negative integer ceiling — guards the int columns from an absurd value. */
const MAX_INT = 1_000_000;

export function validateField(field: ImportField, raw: string): FieldResult {
  const trimmed = raw.trim();

  if (trimmed === '') {
    if (field.required) {
      return fail('REQUIRED_FIELD_MISSING', `${field.label} is required`);
    }
    return { ok: true, value: '' };
  }

  switch (field.type) {
    case 'string':
      if (field.maxLength && trimmed.length > field.maxLength) {
        return fail(
          'VALUE_TOO_LONG',
          `${field.label} exceeds ${field.maxLength} characters`,
        );
      }
      return { ok: true, value: trimmed };

    case 'decimal': {
      // Real sheets render amounts with thousands separators ("1,250.00"); strip
      // them before validating so a legitimate value is not rejected as non-numeric.
      const cleaned = trimmed.replace(/,/g, '');
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
        return fail('INVALID_NUMBER', `${field.label} must be a number`);
      }
      return { ok: true, value: cleaned };
    }

    case 'int': {
      const cleaned = trimmed.replace(/,/g, '');
      if (!/^\d+$/.test(cleaned)) {
        return fail('INVALID_NUMBER', `${field.label} must be a whole number`);
      }
      const parsed = Number(cleaned);
      if (parsed > MAX_INT) {
        return fail('INVALID_NUMBER', `${field.label} is out of range`);
      }
      return { ok: true, value: String(parsed) };
    }

    case 'date': {
      const iso = toIsoDate(trimmed);
      if (!iso) {
        return fail('INVALID_DATE', `${field.label} is not a valid date`);
      }
      return { ok: true, value: iso };
    }
  }
}

function fail(errorCode: ImportErrorCode, reason: string): FieldResult {
  return { ok: false, failure: { errorCode, reason } };
}

/**
 * Normalises a date cell to `YYYY-MM-DD`, or null if it is not a date.
 *
 * An ISO date is taken verbatim (no `Date` round-trip, which would drag a timezone
 * into a date-only value); anything else is parsed leniently and re-formatted in
 * UTC so the calendar day the file shows is the day stored.
 */
function toIsoDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
