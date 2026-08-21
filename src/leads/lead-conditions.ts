import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

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

type FieldKind = 'text' | 'numeric' | 'date' | 'enum' | 'user' | 'tags';

type FieldSpec =
  | { kind: 'text' | 'numeric' | 'date' | 'enum'; column: string }
  | { kind: 'user' }
  | { kind: 'tags' }
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
  name: { kind: 'text', column: 'name' },
  firstName: { kind: 'text', column: 'firstName' },
  primaryPhone: { kind: 'text', column: 'primaryPhone' },
  secondaryPhone: { kind: 'text', column: 'secondaryPhone' },
  source: { kind: 'text', column: 'source' },
  city: { kind: 'text', column: 'city' },
  street: { kind: 'text', column: 'street' },
  country: { kind: 'text', column: 'country' },
  state: { kind: 'text', column: 'state' },
  nationalCode: { kind: 'text', column: 'nationalCode' },
  product2: { kind: 'text', column: 'product2' },
  // Scalar enum (lookup-backed)
  status: { kind: 'enum', column: 'status' },
  callStatus: { kind: 'enum', column: 'callStatus' },
  category: { kind: 'enum', column: 'category' },
  language: { kind: 'enum', column: 'language' },
  pipeline: { kind: 'enum', column: 'pipeline' },
  paymentMethod: { kind: 'enum', column: 'paymentMethod' },
  product: { kind: 'enum', column: 'product' },
  // Scalar numeric
  actualAmount: { kind: 'numeric', column: 'actualAmount' },
  forecastedAmount: { kind: 'numeric', column: 'forecastedAmount' },
  productQty: { kind: 'numeric', column: 'productQty' },
  product2Qty: { kind: 'numeric', column: 'product2Qty' },
  callAttempts: { kind: 'numeric', column: 'callAttempts' },
  whatsappAttempts: { kind: 'numeric', column: 'whatsappAttempts' },
  // Scalar date
  createdAt: { kind: 'date', column: 'createdAt' },
  bookingDate: { kind: 'date', column: 'bookingDate' },
  // Join fields
  assignedAgent: { kind: 'user' },
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
};

const VALUELESS: ReadonlySet<LeadConditionOperator> = new Set([
  'isEmpty',
  'isNotEmpty',
]);
const RANGE: ReadonlySet<LeadConditionOperator> = new Set([
  'between',
  'notBetween',
]);

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
    if (spec.kind === 'numeric') {
      for (const v of cleaned) {
        if (!Number.isFinite(Number(v))) {
          throw new BadRequestException(
            `${String(field)} needs a numeric value`,
          );
        }
      }
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

function textScalarWhere(
  field: string,
  op: LeadConditionOperator,
  v: string[],
) {
  switch (op) {
    case 'is':
      return col(field, { equals: v[0], ...insensitive });
    case 'isnt':
      return { NOT: col(field, { equals: v[0], ...insensitive }) };
    case 'contains':
      return col(field, { contains: v[0], ...insensitive });
    case 'doesntContain':
      return { NOT: col(field, { contains: v[0], ...insensitive }) };
    case 'startsWith':
      return col(field, { startsWith: v[0], ...insensitive });
    case 'endsWith':
      return col(field, { endsWith: v[0], ...insensitive });
    case 'isEmpty':
      return { OR: [col(field, null), col(field, '')] };
    case 'isNotEmpty':
      return { AND: [col(field, { not: null }), col(field, { not: '' })] };
    default:
      return {};
  }
}

function numericScalarWhere(
  field: string,
  op: LeadConditionOperator,
  v: string[],
) {
  switch (op) {
    case 'equals':
      return col(field, { equals: num(v, 0) });
    case 'notEquals':
      return col(field, { not: num(v, 0) });
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
      return {
        OR: [col(field, { lt: num(v, 0) }), col(field, { gt: num(v, 1) })],
      };
    case 'isEmpty':
      return col(field, null);
    case 'isNotEmpty':
      return col(field, { not: null });
    default:
      return {};
  }
}

function enumScalarWhere(
  field: string,
  op: LeadConditionOperator,
  v: string[],
) {
  switch (op) {
    case 'is':
      return col(field, { in: v });
    case 'isnt':
      return { NOT: col(field, { in: v }) };
    case 'isEmpty':
      return { OR: [col(field, null), col(field, '')] };
    case 'isNotEmpty':
      return { AND: [col(field, { not: null }), col(field, { not: '' })] };
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

function dateScalarWhere(
  field: string,
  op: LeadConditionOperator,
  v: string[],
) {
  switch (op) {
    case 'notBetween':
      return {
        OR: [col(field, { lt: at(v, 0) }), col(field, { gte: at(v, 1) })],
      };
    case 'isEmpty':
      return col(field, null);
    case 'isNotEmpty':
      return col(field, { not: null });
    default:
      return col(field, dateComparison(op, v));
  }
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
  const inner =
    op === 'notBetween'
      ? {
          OR: [
            { [relColumn]: { lt: at(v, 0) } },
            { [relColumn]: { gte: at(v, 1) } },
          ],
        }
      : { [relColumn]: dateComparison(op, v) };
  return {
    [relation]: { some: { ...base, ...inner } },
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
  const match = (extra: object) => ({
    complaints: { some: { ...base, [relColumn]: extra } },
  });
  const none = (extra: object) => ({
    complaints: { none: { ...base, [relColumn]: extra } },
  });
  switch (op) {
    case 'is':
      return match({ equals: v[0], ...insensitive });
    case 'isnt':
      return none({ equals: v[0], ...insensitive });
    case 'contains':
      return match({ contains: v[0], ...insensitive });
    case 'doesntContain':
      return none({ contains: v[0], ...insensitive });
    case 'startsWith':
      return match({ startsWith: v[0], ...insensitive });
    case 'endsWith':
      return match({ endsWith: v[0], ...insensitive });
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
      case 'text':
        return textScalarWhere(spec.column, c.operator, c.values);
      case 'numeric':
        return numericScalarWhere(spec.column, c.operator, c.values);
      case 'date':
        return dateScalarWhere(spec.column, c.operator, c.values);
      case 'enum':
        return enumScalarWhere(spec.column, c.operator, c.values);
      default:
        return {};
    }
  });
}
