import { Prisma } from '../../generated/prisma/client';

/**
 * The columns available to an export, and how each renders to a cell.
 *
 * The keys match the frontend's Leads column ids, so "My Default" (the user's
 * visible columns, LEAD-05.1) maps straight through: the client sends the visible
 * keys in order and this catalog resolves them. "All Fields" is the whole catalog.
 * The select below is wider than the list's — All Fields exposes the address,
 * product and outreach fields the table does not column by default.
 */
export const LEAD_EXPORT_SELECT = {
  name: true,
  firstName: true,
  primaryPhone: true,
  secondaryPhone: true,
  language: true,
  country: true,
  source: true,
  status: true,
  pipeline: true,
  category: true,
  product: true,
  productQty: true,
  product2: true,
  product2Qty: true,
  bookingDate: true,
  actualAmount: true,
  forecastedAmount: true,
  paymentMethod: true,
  state: true,
  street: true,
  city: true,
  nationalCode: true,
  callStatus: true,
  callAttempts: true,
  whatsappAttempts: true,
  createdAt: true,
  assignments: { select: { user: { select: { name: true } } } },
  tags: { select: { tag: { select: { name: true } } } },
} satisfies Prisma.LeadSelect;

export type LeadExportRow = Prisma.LeadGetPayload<{
  select: typeof LEAD_EXPORT_SELECT;
}>;

export interface ExportColumn {
  key: string;
  header: string;
  value: (row: LeadExportRow) => string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Rendered in UTC and documented as such: the list formats the same instant in the
 * viewer's timezone, so an exported "Created Date" can differ from the on-screen
 * cell by the viewer's offset. Consistent and unambiguous beats locale-dependent
 * for a file that will be parsed by a spreadsheet.
 */
function formatDateTime(date: Date): string {
  let hour = date.getUTCHours();
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}, ${pad(hour)}:${pad(date.getUTCMinutes())} ${meridiem}`;
}

function formatDate(date: Date): string {
  return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
}

/**
 * Amounts and quantities export as the raw decimal string, never with the "د.إ"
 * the list appends: a spreadsheet must read the cell as a number, and the currency
 * glyph would force it to text. A deliberate difference from the on-screen display.
 */
const decimal = (value: Prisma.Decimal | null): string =>
  value?.toString() ?? '';

/**
 * Catalog order: the default (visible) columns first, in the Leads table's
 * left-to-right order, then the All-Fields-only extras. So an "All Fields" export
 * leads with the familiar columns and appends the rest.
 */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'name', header: 'Customer Name', value: (r) => r.name },
  {
    key: 'primaryPhone',
    header: 'Primary Phone',
    value: (r) => r.primaryPhone,
  },
  { key: 'source', header: 'Source', value: (r) => r.source ?? '' },
  { key: 'status', header: 'Lead Status', value: (r) => r.status },
  {
    key: 'assigned',
    header: 'Assigned',
    value: (r) => r.assignments.map((a) => a.user.name).join(', '),
  },
  {
    key: 'createdAt',
    header: 'Created Date',
    value: (r) => formatDateTime(r.createdAt),
  },
  { key: 'country', header: 'Country', value: (r) => r.country ?? '' },
  { key: 'firstName', header: 'First Name', value: (r) => r.firstName ?? '' },
  {
    key: 'tags',
    header: 'Tags',
    value: (r) => r.tags.map((t) => t.tag.name).join(', '),
  },
  {
    key: 'secondaryPhone',
    header: 'Secondary Phone',
    value: (r) => r.secondaryPhone ?? '',
  },
  { key: 'language', header: 'Language', value: (r) => r.language ?? '' },
  { key: 'category', header: 'Category', value: (r) => r.category ?? '' },
  {
    key: 'actualAmount',
    header: 'Actual Amount',
    value: (r) => decimal(r.actualAmount),
  },
  {
    key: 'forecastedAmount',
    header: 'Forecasted Amount',
    value: (r) => decimal(r.forecastedAmount),
  },
  {
    key: 'callStatus',
    header: 'Call Status',
    value: (r) => r.callStatus ?? '',
  },
  // ── All Fields only, appended after the visible columns ──
  { key: 'pipeline', header: 'Lead Pipeline', value: (r) => r.pipeline },
  { key: 'product', header: 'Product', value: (r) => r.product ?? '' },
  { key: 'productQty', header: 'QTY', value: (r) => decimal(r.productQty) },
  { key: 'product2', header: 'Product 2', value: (r) => r.product2 ?? '' },
  {
    key: 'product2Qty',
    header: 'QTY of Product 2',
    value: (r) => decimal(r.product2Qty),
  },
  {
    key: 'bookingDate',
    header: 'Booking Date',
    value: (r) => (r.bookingDate ? formatDate(r.bookingDate) : ''),
  },
  {
    key: 'paymentMethod',
    header: 'Payment Method',
    value: (r) => r.paymentMethod ?? '',
  },
  { key: 'state', header: 'State', value: (r) => r.state ?? '' },
  { key: 'street', header: 'Street', value: (r) => r.street ?? '' },
  { key: 'city', header: 'City', value: (r) => r.city ?? '' },
  {
    key: 'nationalCode',
    header: 'National Code',
    value: (r) => r.nationalCode ?? '',
  },
  {
    key: 'callAttempts',
    header: 'Call Attempts',
    value: (r) => String(r.callAttempts),
  },
  {
    key: 'whatsappAttempts',
    header: 'WhatsApp Attempts',
    value: (r) => String(r.whatsappAttempts),
  },
];

const COLUMN_BY_KEY = new Map(
  EXPORT_COLUMNS.map((column) => [column.key, column]),
);

/** The default (visible) columns, used when scope=default names nothing usable. */
const DEFAULT_KEYS = EXPORT_COLUMNS.slice(0, 15).map((column) => column.key);
const DEFAULT_COLUMNS = DEFAULT_KEYS.map((key) => COLUMN_BY_KEY.get(key)!);

/**
 * Resolves which columns an export writes.
 *
 * `all` → the whole catalog. `default` → the columns the client named (its visible
 * set, in its order), unknown keys dropped so a stale layout can never break the
 * file; if nothing usable remains it falls back to the default visible columns.
 */
export function resolveExportColumns(
  scope: 'default' | 'all',
  columns: string | undefined,
): ExportColumn[] {
  if (scope === 'all') return EXPORT_COLUMNS;

  const requested = (columns ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => COLUMN_BY_KEY.get(key))
    .filter((column): column is ExportColumn => Boolean(column));

  return requested.length > 0 ? requested : DEFAULT_COLUMNS;
}

/**
 * One CSV field, RFC 4180: quote when the value carries a comma, quote or newline,
 * doubling any embedded quote. Everything else passes through untouched.
 */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
