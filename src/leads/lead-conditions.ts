import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { answeredCallWhere, noEngagementWhere } from './lead-engagement-where';
import { escapeLike } from './lead-search';

/**
 * The Leads advanced filter condition engine (Workpex "Filter" — ADR-0039, expanded
 * ADR-0040). The client sends a JSON `conditions` array of `{ field, operator, values }`;
 * each is whitelisted (field + operator-for-that-kind, else 400) and mapped to a scoped
 * Prisma fragment, ANDed with role scope + search in `buildLeadWhere`.
 *
 * Six field kinds, each with its own operator family and value shape:
 *   text    — is/isnt/contains/doesntContain/startsWith/endsWith/isEmpty/isNotEmpty
 *   numeric — equals/notEquals/lessThan/…/greaterThanOrEqual/between/notBetween/isEmpty/isNotEmpty
 *   date    — on/before/after/between/notBetween/isEmpty/isNotEmpty
 *   enum    — is/isnt/isEmpty/isNotEmpty
 *   user    — is/isnt/isEmpty/isNotEmpty  (through the assignment join)
 *   tags    — is/isnt/isEmpty/isNotEmpty  (through the lead-tag join)
 * Date operators receive ISO instants the client computed in its own timezone.
 *
 * Text values are matched literally (`%` and `_` are escaped, as search does). A negative
 * operator (isn't, doesn't contain, not equals, not between) keeps the leads whose field is
 * empty, the same rule the join fields' `none` shapes already follow — "Country isn't
 * Qatar" includes the leads with no country. On a NOT NULL column there is no empty value
 * to keep, and Prisma rejects a null filter there, so those columns are marked `required`.
 */

export type LeadConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'on'
  | 'before'
  | 'after'
  | 'between'
  | 'notBetween'
  | 'is'
  | 'isnt'
  | 'contains'
  | 'doesntContain'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty';

export interface LeadCondition {
  field: string;
  operator: LeadConditionOperator;
  values: string[];
}

type FieldKind =
  'text' | 'numeric' | 'date' | 'enum' | 'user' | 'tags' | 'team' | 'activity';

type FieldSpec =
  | {
      kind: 'text' | 'numeric' | 'date' | 'enum';
      column: string;
      /** NOT NULL in the Lead model: empty means '' (text) or nothing (number/date). */
      required?: true;
      /** An Int column: values must be whole and fit in 32 bits. */
      integer?: true;
    }
  | { kind: 'user' }
  | { kind: 'tags' }
  /** The assignee's team (`User.team`) — what the Leads By Status Team filter drills through. */
  | { kind: 'team' }
  /** Engagement state — "Contacted" / "No Activity" — from `lead-engagement-where.ts`. */
  | { kind: 'activity' }
  /** A date read through a related table (Assigned Date, Follow Up Date). */
  | { kind: 'date'; relation: 'assignments' | 'activities'; relColumn: string }
  /** A text read through a related table (Complaints). */
  | { kind: 'text'; relation: 'complaints'; relColumn: string };

/**
 * The whitelisted filterable fields and how each is matched. Keys are shared with the
 * frontend config. `createdBy` is intentionally absent — `Lead` records no creator, so
 * it cannot be queried (the frontend marks it non-queryable and never sends it).
 */
const FIELDS: Record<string, FieldSpec> = {
  // Scalar text (free-text columns)
  name: { kind: 'text', column: 'name', required: true },
  firstName: { kind: 'text', column: 'firstName' },
  primaryPhone: { kind: 'text', column: 'primaryPhone', required: true },
  secondaryPhone: { kind: 'text', column: 'secondaryPhone' },
  source: { kind: 'text', column: 'source' },
  city: { kind: 'text', column: 'city' },
  street: { kind: 'text', column: 'street' },
  country: { kind: 'text', column: 'country' },
  state: { kind: 'text', column: 'state' },
  nationalCode: { kind: 'text', column: 'nationalCode' },
  product2: { kind: 'text', column: 'product2' },
  // Scalar enum (lookup-backed)
  status: { kind: 'enum', column: 'status', required: true },
  callStatus: { kind: 'enum', column: 'callStatus' },
  category: { kind: 'enum', column: 'category' },
  language: { kind: 'enum', column: 'language' },
  pipeline: { kind: 'enum', column: 'pipeline', required: true },
  paymentMethod: { kind: 'enum', column: 'paymentMethod' },
  product: { kind: 'enum', column: 'product' },
  // Scalar numeric
  actualAmount: { kind: 'numeric', column: 'actualAmount' },
  forecastedAmount: { kind: 'numeric', column: 'forecastedAmount' },
  productQty: { kind: 'numeric', column: 'productQty' },
  product2Qty: { kind: 'numeric', column: 'product2Qty' },
  callAttempts: {
    kind: 'numeric',
    column: 'callAttempts',
    required: true,
    integer: true,
  },
  whatsappAttempts: {
    kind: 'numeric',
    column: 'whatsappAttempts',
    required: true,
    integer: true,
  },
  // Scalar date
  createdAt: { kind: 'date', column: 'createdAt', required: true },
  /** Kept by the `leads_status_changed_at` trigger; the Leads By Status "Status Changed Date" drill-down. */
  statusChangedAt: {
    kind: 'date',
    column: 'statusChangedAt',
    required: true,
  },
  bookingDate: { kind: 'date', column: 'bookingDate' },
  // Join fields
  assignedAgent: { kind: 'user' },
  team: { kind: 'team' },
  activity: { kind: 'activity' },
  tags: { kind: 'tags' },
  assignedDate: {
    kind: 'date',
    relation: 'assignments',
    relColumn: 'createdAt',
  },
  followUpDate: { kind: 'date', relation: 'activities', relColumn: 'dueAt' },
  complaints: { kind: 'text', relation: 'complaints', relColumn: 'details' },
};

const OPERATORS_FOR: Record<FieldKind, LeadConditionOperator[]> = {
  numeric: [
    'equals',
    'notEquals',
    'lessThan',
    'lessThanOrEqual',
    'greaterThan',
    'greaterThanOrEqual',
    'between',
    'notBetween',
    'isEmpty',
    'isNotEmpty',
  ],
  date: [
    'on',
    'before',
    'after',
    'between',
    'notBetween',
    'isEmpty',
    'isNotEmpty',
  ],
  text: [
    'is',
    'isnt',
    'contains',
    'doesntContain',
    'startsWith',
    'endsWith',
    'isEmpty',
    'isNotEmpty',
  ],
  enum: ['is', 'isnt', 'isEmpty', 'isNotEmpty'],
  user: ['is', 'isnt', 'isEmpty', 'isNotEmpty'],
  tags: ['is', 'isnt', 'isEmpty', 'isNotEmpty'],
  team: ['is', 'isnt', 'isEmpty', 'isNotEmpty'],
  activity: ['is', 'isnt'],
};

const VALUELESS: ReadonlySet<LeadConditionOperator> = new Set([
  'isEmpty',
  'isNotEmpty',
]);
/** Operators that take a start and an end — `on` too, as the client's [day start, next day). */
const RANGE: ReadonlySet<LeadConditionOperator> = new Set([
  'between',
  'notBetween',
  'on',
]);

/** The largest value a Postgres `integer` column holds. */
const MAX_INT = 2_147_483_647;

/** The syntax a Postgres `uuid` accepts; anything else would fail inside the query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses + validates the JSON `conditions` param. Bad JSON, an unknown field, an
 * operator the field's kind doesn't allow, or a value-count mismatch is a 400.
 */
export function parseLeadConditions(raw: string | undefined): LeadCondition[] {
  if (raw === undefined || raw.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('conditions must be valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new BadRequestException('conditions must be an array');
  }

  return parsed.map((item): LeadCondition => {
    if (typeof item !== 'object' || item === null) {
      throw new BadRequestException('each condition must be an object');
    }
    const { field, operator, values } = item as Record<string, unknown>;
    const spec = typeof field === 'string' ? FIELDS[field] : undefined;
    if (!spec) {
      throw new BadRequestException(`unknown filter field: ${String(field)}`);
    }
    if (
      typeof operator !== 'string' ||
      !OPERATORS_FOR[spec.kind].includes(operator as LeadConditionOperator)
    ) {
      throw new BadRequestException(
        `operator ${String(operator)} is not valid for ${field}`,
      );
    }
    const op = operator as LeadConditionOperator;
    const cleaned = (Array.isArray(values) ? values : [])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (VALUELESS.has(op))
      return { field: field as string, operator: op, values: [] };
    if (RANGE.has(op)) {
      if (cleaned.length !== 2) {
        throw new BadRequestException(`${op} needs a start and end value`);
      }
    } else if (cleaned.length === 0) {
      throw new BadRequestException(`${String(field)} ${op} needs a value`);
    }
    // Values reach the database typed, so a malformed one is refused here as a 400 rather
    // than failing inside the query as a 500.
    if (spec.kind === 'numeric') {
      const integer = 'integer' in spec && spec.integer === true;
      for (const v of cleaned) {
        const n = Number(v);
        if (!Number.isFinite(n)) {
          throw new BadRequestException(
            `${String(field)} needs a numeric value`,
          );
        }
        if (integer && (!Number.isInteger(n) || Math.abs(n) > MAX_INT)) {
          throw new BadRequestException(
            `${String(field)} needs a whole number`,
          );
        }
      }
    }
    if (
      spec.kind === 'date' &&
      cleaned.some((v) => Number.isNaN(Date.parse(v)))
    ) {
      throw new BadRequestException(`${String(field)} needs a valid date`);
    }
    if (
      (spec.kind === 'user' || spec.kind === 'tags') &&
      cleaned.some((v) => !UUID.test(v))
    ) {
      throw new BadRequestException(`${String(field)} needs valid ids`);
    }
    if (spec.kind === 'activity' && cleaned.some((v) => !activityKey(v))) {
      throw new BadRequestException(
        `${String(field)} must be Contacted or No Activity`,
      );
    }
    return { field: field as string, operator: op, values: cleaned };
  });
}

const at = (values: string[], i: number) => new Date(values[i]);
const num = (values: string[], i: number) => Number(values[i]);
const insensitive = { mode: 'insensitive' as const };

/** A whitelisted scalar column matched by a Prisma filter — cast is safe post-whitelist. */
function col(field: string, where: unknown): Prisma.LeadWhereInput {
  return { [field]: where } as Prisma.LeadWhereInput;
}

/** A scalar column and whether it is NOT NULL (see `FieldSpec.required`). */
type Scalar = { column: string; required?: true };

/** Matches no lead — the empty-value operators on a NOT NULL number/date column. */
const NOTHING: Prisma.LeadWhereInput = { id: { in: [] } };

/** A negative match that keeps the leads with no value (see the header). */
function orEmpty(
  { column, required }: Scalar,
  where: Prisma.LeadWhereInput,
): Prisma.LeadWhereInput {
  return required ? where : { OR: [where, col(column, null)] };
}

/** Empty for a string column: '' always, null too when the column allows it. */
function emptyString({ column, required }: Scalar): Prisma.LeadWhereInput {
  return required
    ? col(column, '')
    : { OR: [col(column, null), col(column, '')] };
}

function textScalarWhere(spec: Scalar, op: LeadConditionOperator, v: string[]) {
  const field = spec.column;
  const literal = escapeLike(v[0] ?? '');
  switch (op) {
    case 'is':
      return col(field, { equals: literal, ...insensitive });
    case 'isnt':
      return orEmpty(spec, {
        NOT: col(field, { equals: literal, ...insensitive }),
      });
    case 'contains':
      return col(field, { contains: literal, ...insensitive });
    case 'doesntContain':
      return orEmpty(spec, {
        NOT: col(field, { contains: literal, ...insensitive }),
      });
    case 'startsWith':
      return col(field, { startsWith: literal, ...insensitive });
    case 'endsWith':
      return col(field, { endsWith: literal, ...insensitive });
    case 'isEmpty':
      return emptyString(spec);
    case 'isNotEmpty':
      return { NOT: emptyString(spec) };
    default:
      return {};
  }
}

function numericScalarWhere(
  spec: Scalar,
  op: LeadConditionOperator,
  v: string[],
) {
  const field = spec.column;
  switch (op) {
    case 'equals':
      return col(field, { equals: num(v, 0) });
    case 'notEquals':
      return orEmpty(spec, col(field, { not: num(v, 0) }));
    case 'lessThan':
      return col(field, { lt: num(v, 0) });
    case 'lessThanOrEqual':
      return col(field, { lte: num(v, 0) });
    case 'greaterThan':
      return col(field, { gt: num(v, 0) });
    case 'greaterThanOrEqual':
      return col(field, { gte: num(v, 0) });
    case 'between':
      return col(field, { gte: num(v, 0), lte: num(v, 1) });
    case 'notBetween':
      return orEmpty(spec, {
        OR: [col(field, { lt: num(v, 0) }), col(field, { gt: num(v, 1) })],
      });
    case 'isEmpty':
      return spec.required ? NOTHING : col(field, null);
    case 'isNotEmpty':
      return spec.required ? {} : col(field, { not: null });
    default:
      return {};
  }
}

function enumScalarWhere(spec: Scalar, op: LeadConditionOperator, v: string[]) {
  const field = spec.column;
  switch (op) {
    case 'is':
      return col(field, { in: v });
    case 'isnt':
      return orEmpty(spec, { NOT: col(field, { in: v }) });
    case 'isEmpty':
      return emptyString(spec);
    case 'isNotEmpty':
      return { NOT: emptyString(spec) };
    default:
      return {};
  }
}

/** The date comparison for a column (or a relation column) — used scalar and inside joins. */
function dateComparison(
  op: LeadConditionOperator,
  v: string[],
): Prisma.DateTimeFilter {
  switch (op) {
    case 'on':
    case 'between':
      return { gte: at(v, 0), lt: at(v, 1) };
    case 'before':
      return { lt: at(v, 0) };
    case 'after':
      return { gte: at(v, 0) };
    default:
      return {};
  }
}

function dateScalarWhere(spec: Scalar, op: LeadConditionOperator, v: string[]) {
  const field = spec.column;
  switch (op) {
    case 'notBetween':
      return orEmpty(spec, {
        OR: [col(field, { lt: at(v, 0) }), col(field, { gte: at(v, 1) })],
      });
    case 'isEmpty':
      return spec.required ? NOTHING : col(field, null);
    case 'isNotEmpty':
      return spec.required ? {} : col(field, { not: null });
    default:
      return col(field, dateComparison(op, v));
  }
}

/**
 * Team is a property of the assignee, so it reads through the assignment join — the same
 * shape the reports' `teamWhere` and the manager scope use. Empty means "no assignee with
 * a team".
 */
function teamWhere(
  op: LeadConditionOperator,
  v: string[],
): Prisma.LeadWhereInput {
  switch (op) {
    case 'is':
      return { assignments: { some: { user: { team: { in: v } } } } };
    case 'isnt':
      return { NOT: { assignments: { some: { user: { team: { in: v } } } } } };
    case 'isEmpty':
      return { assignments: { none: { user: { team: { not: null } } } } };
    case 'isNotEmpty':
      return { assignments: { some: { user: { team: { not: null } } } } };
    default:
      return {};
  }
}

/** The engagement states the Activity filter names, keyed by their lookup value. */
const ACTIVITY_WHERE: Record<string, Prisma.LeadWhereInput> = {
  contacted: answeredCallWhere(),
  noactivity: noEngagementWhere(),
};

/** The ACTIVITY_WHERE key a value names, case- and space-insensitively; undefined if none. */
function activityKey(value: string): string | undefined {
  const key = value.toLowerCase().replace(/\s+/g, '');
  return key in ACTIVITY_WHERE ? key : undefined;
}

/**
 * "Activity is Contacted / No Activity" — the same predicates the Today Leads and No
 * Activity reports (and the ownership metrics) run, so a drill-down lands on exactly the
 * counted leads. Values are matched case- and space-insensitively ("No Activity").
 */
function activityWhere(
  op: LeadConditionOperator,
  v: string[],
): Prisma.LeadWhereInput {
  const picked = v
    .map((value) => activityKey(value))
    .filter((key): key is string => key !== undefined)
    .map((key) => ACTIVITY_WHERE[key]);
  if (picked.length === 0) return {};
  const any = picked.length === 1 ? picked[0] : { OR: picked };
  return op === 'isnt' ? { NOT: any } : any;
}

function userWhere(
  op: LeadConditionOperator,
  v: string[],
): Prisma.LeadWhereInput {
  switch (op) {
    case 'is':
      return { assignments: { some: { userId: { in: v } } } };
    case 'isnt':
      return { NOT: { assignments: { some: { userId: { in: v } } } } };
    case 'isEmpty':
      return { assignments: { none: {} } };
    case 'isNotEmpty':
      return { assignments: { some: {} } };
    default:
      return {};
  }
}

function tagsWhere(
  op: LeadConditionOperator,
  v: string[],
): Prisma.LeadWhereInput {
  switch (op) {
    case 'is':
      return { tags: { some: { tagId: { in: v } } } };
    case 'isnt':
      return { NOT: { tags: { some: { tagId: { in: v } } } } };
    case 'isEmpty':
      return { tags: { none: {} } };
    case 'isNotEmpty':
      return { tags: { some: {} } };
    default:
      return {};
  }
}

/** A date read through a related table (Assigned Date → assignments, Follow Up Date → activities). */
function relationDateWhere(
  relation: 'assignments' | 'activities',
  relColumn: string,
  op: LeadConditionOperator,
  v: string[],
): Prisma.LeadWhereInput {
  // Activities exclude soft-deleted; assignments have no soft delete.
  const base = relation === 'activities' ? { deletedAt: null } : {};
  if (op === 'isEmpty')
    return { [relation]: { none: base } } as Prisma.LeadWhereInput;
  if (op === 'isNotEmpty')
    return { [relation]: { some: base } } as Prisma.LeadWhereInput;
  // "Not between" means no row falls inside the range: a lead with one follow-up in it
  // must not match through another outside it, and a lead with none at all does match,
  // like every other negative operator here.
  if (op === 'notBetween') {
    return {
      NOT: {
        [relation]: {
          some: { ...base, [relColumn]: { gte: at(v, 0), lt: at(v, 1) } },
        },
      },
    };
  }
  return {
    [relation]: { some: { ...base, [relColumn]: dateComparison(op, v) } },
  } as Prisma.LeadWhereInput;
}

/** A text read through the complaints table. Positive ops match `some`; negatives match `none`. */
function complaintsTextWhere(
  relColumn: string,
  op: LeadConditionOperator,
  v: string[],
): Prisma.LeadWhereInput {
  const base = { deletedAt: null };
  if (op === 'isEmpty') return { complaints: { none: base } };
  if (op === 'isNotEmpty') return { complaints: { some: base } };
  const literal = escapeLike(v[0] ?? '');
  const match = (extra: object) => ({
    complaints: { some: { ...base, [relColumn]: extra } },
  });
  const none = (extra: object) => ({
    complaints: { none: { ...base, [relColumn]: extra } },
  });
  switch (op) {
    case 'is':
      return match({ equals: literal, ...insensitive });
    case 'isnt':
      return none({ equals: literal, ...insensitive });
    case 'contains':
      return match({ contains: literal, ...insensitive });
    case 'doesntContain':
      return none({ contains: literal, ...insensitive });
    case 'startsWith':
      return match({ startsWith: literal, ...insensitive });
    case 'endsWith':
      return match({ endsWith: literal, ...insensitive });
    default:
      return {};
  }
}

/** One scoped Prisma fragment per condition; the caller ANDs them with scope + search. */
export function leadConditionWhere(
  conditions: LeadCondition[],
): Prisma.LeadWhereInput[] {
  return conditions.map((c): Prisma.LeadWhereInput => {
    const spec = FIELDS[c.field];
    if ('relation' in spec) {
      return spec.kind === 'date'
        ? relationDateWhere(spec.relation, spec.relColumn, c.operator, c.values)
        : complaintsTextWhere(spec.relColumn, c.operator, c.values);
    }
    switch (spec.kind) {
      case 'user':
        return userWhere(c.operator, c.values);
      case 'tags':
        return tagsWhere(c.operator, c.values);
      case 'team':
        return teamWhere(c.operator, c.values);
      case 'activity':
        return activityWhere(c.operator, c.values);
      case 'text':
        return textScalarWhere(spec, c.operator, c.values);
      case 'numeric':
        return numericScalarWhere(spec, c.operator, c.values);
      case 'date':
        return dateScalarWhere(spec, c.operator, c.values);
      case 'enum':
        return enumScalarWhere(spec, c.operator, c.values);
      default:
        return {};
    }
  });
}
