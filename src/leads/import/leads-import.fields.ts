import { ImportField } from '../../common/import/import-descriptor';

/**
 * The Leads import target catalog (LEAD-07.1): each field a file column can map
 * onto, its type and length, and whether it is required.
 *
 * Required is exactly what `CreateLeadDto` requires — Customer Name and Primary
 * Phone (ADR-0088) — so a row the New Lead form would accept is never refused here.
 * `pipeline` is absent: it is chosen once in Import Settings and applied to every
 * row, not mapped per row. Status, Source, Category, Product, Payment Method, Call
 * Status and Language get their allowed values per run (the descriptor's `prepare`),
 * the same lists the New Lead form's dropdowns offer. Tags, Assigned and Complaints
 * are deferred — they need id/name resolution that is its own task.
 *
 * Lengths mirror the `Lead` columns so a `VALUE_TOO_LONG` is caught here with a
 * clear reason rather than as a database error mid-batch.
 */
export const LEADS_IMPORT_FIELDS: readonly ImportField[] = [
  {
    value: 'name',
    label: 'Customer Name',
    type: 'string',
    maxLength: 180,
    required: true,
  },
  {
    value: 'primaryPhone',
    label: 'Primary Phone',
    type: 'phone',
    required: true,
  },
  {
    value: 'actualAmount',
    label: 'Actual Amount',
    type: 'decimal',
  },
  {
    value: 'paymentMethod',
    label: 'Payment Method',
    type: 'string',
    maxLength: 64,
  },
  { value: 'firstName', label: 'First Name', type: 'string', maxLength: 120 },
  { value: 'secondaryPhone', label: 'Secondary Phone', type: 'phone' },
  { value: 'email', label: 'Email', type: 'email', maxLength: 180 },
  { value: 'language', label: 'Language', type: 'string', maxLength: 64 },
  { value: 'country', label: 'Country', type: 'string', maxLength: 64 },
  { value: 'source', label: 'Source', type: 'string', maxLength: 64 },
  { value: 'status', label: 'Lead Status', type: 'string', maxLength: 64 },
  { value: 'category', label: 'Category', type: 'string', maxLength: 120 },
  { value: 'product', label: 'Product', type: 'string', maxLength: 180 },
  { value: 'productQty', label: 'QTY', type: 'decimal' },
  { value: 'product2', label: 'Product 2', type: 'string', maxLength: 180 },
  { value: 'product2Qty', label: 'QTY of Product 2', type: 'decimal' },
  { value: 'forecastedAmount', label: 'Forecasted Amount', type: 'decimal' },
  { value: 'callStatus', label: 'Call Status', type: 'string', maxLength: 64 },
  { value: 'callAttempts', label: 'No. of Call Attempts', type: 'int' },
  { value: 'msgAttempts', label: 'No. of Msg Attempts', type: 'int' },
  { value: 'bookingDate', label: 'Booking Date', type: 'date' },
  {
    value: 'nationalCode',
    label: 'National Code',
    type: 'string',
    maxLength: 240,
  },
  { value: 'state', label: 'State', type: 'string', maxLength: 120 },
  { value: 'street', label: 'Street', type: 'string', maxLength: 240 },
  { value: 'city', label: 'City', type: 'string', maxLength: 120 },
];
