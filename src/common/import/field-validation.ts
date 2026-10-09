import { isEmail } from 'class-validator';
import { ImportErrorCode, ImportField } from './import-descriptor';

/**
 * Validates and cleans one raw cell against a target field (LEAD-07.1 AC2).
 *
 * Returns the cleaned string to store on success, or a single error code + reason
 * on failure. Cleaning is intentionally forgiving of the shapes real spreadsheets
 * carry — thousands separators in amounts, stray whitespace, phone punctuation —
 * because the goal is to load data captured outside the system, not to reject it for
 * cosmetics. What it never does is coerce a genuinely wrong value into a plausible
 * one: a non-numeric amount fails rather than becoming zero, and an ambiguous date
 * such as 08/10/2026 fails rather than being guessed.
 */
export interface FieldFailure {
  errorCode: ImportErrorCode;
  reason: string;
}

export type FieldResult =
  { ok: true; value: string } | { ok: false; failure: FieldFailure };

/** The attempts ceiling `CreateLeadDto` applies to the same int columns. */
const MAX_INT = 1000;

/** Options listed in a reason only while the list stays readable. */
const MAX_LISTED_OPTIONS = 10;

export function validateField(field: ImportField, raw: string): FieldResult {
  const trimmed = raw.trim();

  if (trimmed === '') {
    if (field.required) {
      return fail('REQUIRED_FIELD_MISSING', `${field.label} is required`);
    }
    return { ok: true, value: '' };
  }

  // The parser's marker for a date-formatted cell holding a number too big to be a date
  // (Excel shows ####) — refused in any field, so it is never stored as text.
  if (trimmed === 'Invalid Date') {
    return fail(
      'INVALID_DATE',
      `${field.label} is a date-formatted cell that Excel shows as ####. Format the column as Text and enter the value again`,
    );
  }

  switch (field.type) {
    case 'string':
      if (field.options) return matchOption(field, field.options, trimmed);
      return checkLength(field, trimmed);

    case 'email':
      if (!isEmail(trimmed)) {
        return fail(
          'INVALID_EMAIL',
          `${field.label} must be a valid email address`,
        );
      }
      return checkLength(field, trimmed);

    case 'phone': {
      // Stored the way the New Lead form's PhoneInput stores a number: digits only,
      // country code first, no "+" — so dedupe and search compare like with like. The
      // 7–15 digit bound is the import's own sanity check (E.164 caps a number at 15).
      const digits = trimmed.replace(/[\s\-().]/g, '').replace(/^(\+|00)/, '');
      if (!/^\d{7,15}$/.test(digits)) {
        // Excel shows a 12-digit number as 9.71501E+11 and saves that into a CSV: the
        // digits are already lost, so say how to keep them instead of just "invalid".
        return fail(
          'INVALID_PHONE',
          /^\d(\.\d+)?e\+\d+$/i.test(trimmed)
            ? `${field.label} ${trimmed} was shortened by Excel. Format the phone column as Text (or use the XLSX sample) and enter the full number`
            : `${field.label} must be a phone number of 7 to 15 digits`,
        );
      }
      return { ok: true, value: digits };
    }

    case 'decimal': {
      // Real sheets render amounts with thousands separators ("1,250.00"); strip
      // them before validating so a legitimate value is not rejected as non-numeric.
      const cleaned = withoutThousands(trimmed);
      if (cleaned === null || !/^-?\d+(\.\d+)?$/.test(cleaned)) {
        return fail('INVALID_NUMBER', `${field.label} must be a number`);
      }
      // Every decimal column is Decimal(12,2); a wider value would fail its whole batch.
      if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(cleaned)) {
        return fail(
          'INVALID_NUMBER',
          `${field.label} must have at most 10 digits before and 2 after the decimal point`,
        );
      }
      return { ok: true, value: cleaned };
    }

    case 'int': {
      const cleaned = withoutThousands(trimmed);
      if (cleaned === null || !/^\d+$/.test(cleaned)) {
        return fail('INVALID_NUMBER', `${field.label} must be a whole number`);
      }
      const parsed = Number(cleaned);
      if (parsed > MAX_INT) {
        return fail(
          'INVALID_NUMBER',
          `${field.label} must be between 0 and ${MAX_INT}`,
        );
      }
      return { ok: true, value: String(parsed) };
    }

    case 'date':
      if (!isIsoDate(trimmed)) {
        // Excel saves a typed date into a CSV in the regional short format (20-10-2026):
        // say so. Which part is the day is a guess, so it is never accepted.
        return fail(
          'INVALID_DATE',
          /^\d{1,2}[-/.](\d{1,2}|[a-z]{3})[-/.]\d{2,4}$/i.test(trimmed)
            ? `${field.label} ${trimmed} is in a regional date format, as Excel saves dates in a CSV. Enter it as YYYY-MM-DD (e.g. 2026-10-15) in a Text-formatted column, or use the XLSX sample`
            : `${field.label} must be a date in YYYY-MM-DD format (e.g. 2026-10-15)`,
        );
      }
      return { ok: true, value: trimmed };
  }
}

function fail(errorCode: ImportErrorCode, reason: string): FieldResult {
  return { ok: false, failure: { errorCode, reason } };
}

/**
 * Drops thousands separators ("1,250.50"), or null when a comma is anything else: in
 * "12,50" it is a decimal comma, and stripping it would import 1250 instead of 12.5.
 */
function withoutThousands(value: string): string | null {
  if (!value.includes(',')) return value;
  return /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)
    ? value.replace(/,/g, '')
    : null;
}

function checkLength(field: ImportField, value: string): FieldResult {
  if (field.maxLength && value.length > field.maxLength) {
    return fail(
      'VALUE_TOO_LONG',
      `${field.label} exceeds ${field.maxLength} characters`,
    );
  }
  return { ok: true, value };
}

/** An exact match wins; otherwise a match ignoring case, stored in the option's spelling. */
function matchOption(
  field: ImportField,
  options: readonly string[],
  value: string,
): FieldResult {
  const lower = value.toLowerCase();
  const match =
    options.find((option) => option === value) ??
    options.find((option) => option.toLowerCase() === lower);
  if (match !== undefined) return { ok: true, value: match };

  const hint =
    options.length > 0 && options.length <= MAX_LISTED_OPTIONS
      ? ` (use one of: ${options.join(', ')})`
      : '';
  return fail(
    'INVALID_OPTION',
    `${field.label} "${value}" is not a recognised value${hint}`,
  );
}

/**
 * A real calendar day written `YYYY-MM-DD` — the format the New Lead form sends.
 *
 * Only ISO is accepted: 08/10/2026 is 8 October in the UAE and 10 August to
 * `new Date`, so any other text format would be a guess. A real date cell in an XLSX
 * file arrives here already as ISO (see the spreadsheet parser). The round-trip
 * rejects a day the month does not have (2026-02-30), which `Date` would roll over.
 * Year 0000 is refused too: Postgres has no year zero, so it would fail its whole batch.
 */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
