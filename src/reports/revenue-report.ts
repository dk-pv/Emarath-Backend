import { Prisma, UserRole } from '../generated/prisma/client';
import { NO_SOURCE_LABEL } from './dto/leads-by-source-response.dto';
import type {
  RevenueFigures,
  RevenueGroup,
  RevenueOverviewResponse,
  RevenuePipelineRow,
  RevenueSort,
  RevenueSourceRow,
} from './dto/revenue-response.dto';

/**
 * The Revenue Report's figures (Analytics, ADR-0099 decision 15), computed from the service's
 * aggregates. Every figure reuses a rule Emarath already applies elsewhere:
 *
 * - a **deal** is a lead that became WON in the period — status WON (`CONVERTED_STATUS`) with
 *   `statusChangedAt` in the window, the Dashboard's Team Revenue rule;
 * - **revenue** is Σ their `actualAmount`; a deal without an amount counts as a deal and adds 0;
 * - **conversion** is the reports' cohort rule: leads created in the window that are WON now ÷
 *   leads created in the window (Team Performance, Leads vs Conversion, Leads By Ownership);
 * - the **target** is the members' monthly goals (`targetMembersWhere`), times the whole
 *   calendar months the period spans — Workpex's quarter target is three of its monthly ones.
 *
 * Win rate is the one figure no Emarath rule defined: won ÷ (won + LOST) among the deals closed
 * in the window, an assumption ADR-0099 records.
 */

const ZERO = new Prisma.Decimal(0);

/** The Data Grid's heading for deals with nothing in the grouped field: Workpex's "OTHER (572)". */
export const NO_GROUP_LABEL = 'OTHER';

/** A role's name where its member has no organisational role (ADR-0055) to show instead. */
const ROLE_LABELS: Record<UserRole, string> = {
  SUPERADMIN: 'Super Admin',
  SALES_MANAGER: 'Sales Manager',
  SALES_AGENT: 'Sales Agent',
  CUSTOMER_SERVICE_AGENT: 'Customer Service',
  MARKETING_ANALYST: 'Marketing Analyst',
  LOGISTICS_MANAGER: 'Logistics Manager',
  LOGISTICS_EXECUTIVE: 'Logistics Executive',
  ACCOUNTS_EXECUTIVE: 'Accounts Executive',
  QC: 'QC',
};

const COLLATOR = new Intl.Collator('en', {
  sensitivity: 'base',
  numeric: true,
});

type Amount = Prisma.Decimal | number;

/** part ÷ whole as a percentage to two places; null when there is nothing to divide by. */
export function percentOf(part: Amount, whole: Amount): number | null {
  const base = new Prisma.Decimal(whole);
  if (base.lte(0)) return null;
  return new Prisma.Decimal(part)
    .div(base)
    .mul(100)
    .toDecimalPlaces(2)
    .toNumber();
}

/**
 * A figure's change on the comparison window, as a percentage to two places — Workpex's
 * "92306.6% vs last quarter". Null without a prior figure, and when it is zero: growth from
 * nothing has no percentage, and a made-up one would mislead.
 */
export function percentChange(
  current: Amount | null,
  prior: Amount | null,
): number | null {
  if (current === null || prior === null) return null;
  const before = new Prisma.Decimal(prior);
  if (before.isZero()) return null;
  return new Prisma.Decimal(current)
    .minus(before)
    .div(before.abs())
    .mul(100)
    .toDecimalPlaces(2)
    .toNumber();
}

/** won ÷ (won + lost): the share of the deals closed in the window that were won. */
export function winRate(won: number, lost: number): number | null {
  return percentOf(won, won + lost);
}

/** A count and an amount, summed over one key's groups. */
export interface Tally {
  count: number;
  amount: Prisma.Decimal;
}

/** Folds grouped rows by label, so groups that share one ("No Source") add up. */
export function tally(
  rows: readonly {
    label: string;
    count: number;
    amount?: Prisma.Decimal | null;
  }[],
): Map<string, Tally> {
  const totals = new Map<string, Tally>();
  for (const row of rows) {
    const total = totals.get(row.label) ?? { count: 0, amount: ZERO };
    totals.set(row.label, {
      count: total.count + row.count,
      amount: total.amount.plus(row.amount ?? ZERO),
    });
  }
  return totals;
}

/** Every key's tallies added up. */
export function sumTallies(tallies: ReadonlyMap<string, Tally>): Tally {
  let count = 0;
  let amount = ZERO;
  for (const value of tallies.values()) {
    count += value.count;
    amount = amount.plus(value.amount);
  }
  return { count, amount };
}

/** "No Source" for a missing or blank source — the Leads By Source report's own bucket. */
export function sourceLabel(source: string | null): string {
  return source && source.trim() !== '' ? source : NO_SOURCE_LABEL;
}

/** One window's KPI figures from its deals and its created-lead cohort. */
export function revenueFigures(
  deals: Tally,
  cohort: { leads: number; won: number },
): RevenueFigures {
  return {
    revenue: deals.amount.toFixed(2),
    deals: deals.count,
    avgDealValue:
      deals.count > 0 ? deals.amount.div(deals.count).toFixed(2) : null,
    conversionRate: percentOf(cohort.won, cohort.leads),
  };
}

/** Each KPI's change on the comparison window; all null without one. */
export function figureChanges(
  current: RevenueFigures,
  prior: RevenueFigures | null,
): RevenueOverviewResponse['change'] {
  const money = (value: string | null) =>
    value === null ? null : new Prisma.Decimal(value);
  return {
    revenue:
      prior && percentChange(money(current.revenue), money(prior.revenue)),
    deals: prior && percentChange(current.deals, prior.deals),
    avgDealValue:
      prior &&
      percentChange(money(current.avgDealValue), money(prior.avgDealValue)),
    conversionRate:
      prior && percentChange(current.conversionRate, prior.conversionRate),
  };
}

/**
 * The period's target: the members' monthly goals times the whole calendar months the period
 * spans (a quarter is three — Workpex's 16,920 is three of its 5,640). A period that is not
 * whole months has none: Target Settings holds monthly goals only, and splitting one by days
 * would be a rule nobody set. No goal at all is "no target", never a 0 % achievement.
 */
export function periodTarget(
  monthlyGoals: Prisma.Decimal | null,
  months: number | undefined,
  revenue: Prisma.Decimal,
): RevenueOverviewResponse['target'] {
  const monthly = monthlyGoals && monthlyGoals.gt(0) ? monthlyGoals : null;
  const period = monthly && months ? monthly.mul(months) : null;
  return {
    monthly: monthly?.toFixed(2) ?? null,
    months: months ?? null,
    period: period?.toFixed(2) ?? null,
    percent: period ? percentOf(revenue, period) : null,
  };
}

/** Highest revenue first, then the most deals, then by name — a stable order. */
function byRevenue<T extends { revenue: string; deals: number }>(
  name: (row: T) => string,
) {
  return (a: T, b: T) =>
    new Prisma.Decimal(b.revenue).cmp(a.revenue) ||
    b.deals - a.deals ||
    COLLATOR.compare(name(a), name(b));
}

/**
 * Revenue By Lead Source: every source that closed a deal in the window. Its revenue adds up to
 * Total Revenue — a lead carries one source, so no deal counts twice. "Vs Prior" compares the
 * same source's revenue in the comparison window.
 */
export function buildSourceRows(input: {
  deals: ReadonlyMap<string, Tally>;
  prior: ReadonlyMap<string, Tally> | null;
  created: ReadonlyMap<string, Tally>;
  createdWon: ReadonlyMap<string, Tally>;
}): RevenueSourceRow[] {
  return [...input.deals.entries()]
    .map(([source, deals]) => {
      const before = input.prior
        ? (input.prior.get(source)?.amount ?? ZERO)
        : null;
      return {
        source,
        revenue: deals.amount.toFixed(2),
        deals: deals.count,
        conversionRate: percentOf(
          input.createdWon.get(source)?.count ?? 0,
          input.created.get(source)?.count ?? 0,
        ),
        priorRevenue: before?.toFixed(2) ?? null,
        change: before === null ? null : percentChange(deals.amount, before),
      };
    })
    .sort(byRevenue((row) => row.source));
}

/** Revenue By Pipeline: every pipeline with a deal won or lost in the window. */
export function buildPipelineRows(
  deals: ReadonlyMap<string, Tally>,
  lost: ReadonlyMap<string, Tally>,
): RevenuePipelineRow[] {
  const pipelines = new Set([...deals.keys(), ...lost.keys()]);
  return [...pipelines]
    .map((pipeline) => {
      const won = deals.get(pipeline);
      const lostCount = lost.get(pipeline)?.count ?? 0;
      return {
        pipeline,
        revenue: (won?.amount ?? ZERO).toFixed(2),
        deals: won?.count ?? 0,
        lost: lostCount,
        winRate: winRate(won?.count ?? 0, lostCount),
      };
    })
    .sort(byRevenue((row) => row.pipeline));
}

/** One deal as the Data Grid sorts and groups it. */
export interface DealLine {
  id: string;
  name: string;
  pipeline: string;
  status: string;
  actualAmount: Prisma.Decimal | null;
  secondaryPhone: string | null;
  product: string | null;
  language: string | null;
  country: string | null;
  source: string | null;
  statusChangedAt: Date;
  /** The current assignees, with their roles' display names. */
  assignees: { name: string; role: string }[];
}

/** A member's role as the Users screen names it: their organisational role, or the base one. */
export function roleLabel(role: UserRole, orgRole: string | null): string {
  return orgRole && orgRole.trim() !== '' ? orgRole : ROLE_LABELS[role];
}

function joinSorted(values: readonly string[]): string | null {
  const distinct = [...new Set(values)].sort((a, b) => COLLATOR.compare(a, b));
  return distinct.length > 0 ? distinct.join(', ') : null;
}

/**
 * "Ansar UAE, NIHAD V P": every assignee, alphabetically; null when nobody is. A co-assigned deal
 * is one row under its assignees together, never a row per agent.
 */
export function assignedLabel(line: DealLine): string | null {
  return joinSorted(line.assignees.map((assignee) => assignee.name));
}

export interface DealGroup {
  key: string;
  label: string;
}

/** The deal's group under a grouping: a key that never collides across groupings, and its label. */
export function groupOf(
  group: Exclude<RevenueGroup, 'none'>,
  line: DealLine,
): DealGroup {
  const of = (label: string | null): DealGroup => ({
    key: `${group}:${label ?? ''}`,
    label: label ?? NO_GROUP_LABEL,
  });
  switch (group) {
    case 'pipeline':
      return of(line.pipeline);
    case 'status':
      return of(line.status);
    case 'source':
      return of(sourceLabel(line.source));
    case 'agent':
      return of(assignedLabel(line));
    case 'role':
      return of(joinSorted(line.assignees.map((assignee) => assignee.role)));
  }
}

type SortValue = string | Prisma.Decimal | null;

function sortValue(sort: RevenueSort, line: DealLine): SortValue {
  switch (sort) {
    case 'assigned':
      return assignedLabel(line);
    case 'actualAmount':
      return line.actualAmount;
    default:
      return line[sort];
  }
}

const isEmpty = (value: SortValue): boolean =>
  value === null || (typeof value === 'string' && value.trim() === '');

/** Empty values last in either direction; amounts by value, text in natural order. */
function compareValues(a: SortValue, b: SortValue, sign: 1 | -1): number {
  if (isEmpty(a) || isEmpty(b)) return Number(isEmpty(a)) - Number(isEmpty(b));
  if (a instanceof Prisma.Decimal && b instanceof Prisma.Decimal)
    return sign * a.cmp(b);
  return sign * COLLATOR.compare(String(a), String(b));
}

export interface DealOrder {
  entries: { line: DealLine; group: DealGroup | null }[];
  /** Each group's deals across every page. */
  counts: ReadonlyMap<string, number>;
  /** True when the window held more deals than one read sorts. */
  truncated: boolean;
}

/**
 * The Data Grid's order. Grouped, the largest group comes first — Workpex's agent grid opens on
 * its 572-deal "OTHER" — then the chosen column, then the newest conversion and the id, so the
 * order is total and a page never repeats or skips a deal.
 */
export function orderDeals(
  lines: readonly DealLine[],
  options: {
    group: RevenueGroup;
    sort?: RevenueSort;
    direction?: 'asc' | 'desc';
    truncated?: boolean;
  },
): DealOrder {
  const { group, sort } = options;
  const entries = lines.map((line) => ({
    line,
    group: group === 'none' ? null : groupOf(group, line),
  }));
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.group)
      counts.set(entry.group.key, (counts.get(entry.group.key) ?? 0) + 1);
  }
  const sign = options.direction === 'desc' ? -1 : 1;
  const groupOrder = (a: DealGroup | null, b: DealGroup | null): number => {
    if (!a || !b || a.key === b.key) return 0;
    return (
      (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0) ||
      COLLATOR.compare(a.label, b.label) ||
      (a.key < b.key ? -1 : 1)
    );
  };
  entries.sort(
    (a, b) =>
      groupOrder(a.group, b.group) ||
      (sort
        ? compareValues(sortValue(sort, a.line), sortValue(sort, b.line), sign)
        : 0) ||
      b.line.statusChangedAt.getTime() - a.line.statusChangedAt.getTime() ||
      (a.line.id < b.line.id ? -1 : a.line.id > b.line.id ? 1 : 0),
  );
  return { entries, counts, truncated: options.truncated ?? false };
}

/** One page of the order, and its groups in order with their counts across every page. */
export function dealPage(order: DealOrder, page: number, size: number) {
  const entries = order.entries.slice((page - 1) * size, page * size);
  const groups: (DealGroup & { count: number })[] = [];
  for (const { group } of entries) {
    if (group && groups[groups.length - 1]?.key !== group.key) {
      groups.push({ ...group, count: order.counts.get(group.key) ?? 0 });
    }
  }
  return { entries, groups };
}
