/**
 * The Lead record's own fields, transcribed from the shipped New/Edit Lead drawer — its
 * exact labels, in its exact order (ADR-0072).
 *
 * **These are not CustomField rows**: a system field is a column on `leads` that a form
 * arranges, never a definition the schema screen created.
 *
 * `key` is the drawer's own form-state key, which is what makes it stable: it is already
 * the name the payload uses, so a form's field list needs no translation table.
 *
 * `control` names the input the drawer renders for the field. It is metadata, not
 * configuration: the builder's information icon and the form Preview read it instead of
 * guessing a control from the label (ADR-0073).
 *
 * Kept out of the DTO module deliberately — the seed imports this list, and a seed run
 * standalone must not have to load `reflect-metadata` for a decorator it never uses.
 */
export const LEAD_SYSTEM_FIELDS = [
  { key: 'name', label: 'Customer Name', required: true, control: 'TEXT' },
  {
    key: 'primaryPhone',
    label: 'Primary Phone',
    required: true,
    control: 'PHONE',
  },
  { key: 'firstName', label: 'First Name', required: false, control: 'TEXT' },
  {
    key: 'secondaryPhone',
    label: 'Secondary Phone',
    required: false,
    control: 'PHONE',
  },
  { key: 'email', label: 'Email', required: false, control: 'TEXT' },
  {
    key: 'assignedAgentIds',
    label: 'Assigned',
    required: false,
    control: 'MULTI_SELECT',
  },
  { key: 'status', label: 'Lead Status', required: true, control: 'SELECT' },
  { key: 'tagIds', label: 'Tags', required: false, control: 'MULTI_SELECT' },
  {
    key: 'complaintReason',
    label: 'COMPLAINTS',
    required: false,
    control: 'SELECT',
  },
  { key: 'product', label: 'Product', required: false, control: 'SELECT' },
  { key: 'language', label: 'Language', required: false, control: 'SELECT' },
  { key: 'source', label: 'Source', required: false, control: 'SELECT' },
  { key: 'productQty', label: 'QTY', required: false, control: 'NUMBER' },
  { key: 'product2', label: 'Product 2', required: false, control: 'SELECT' },
  {
    key: 'product2Qty',
    label: 'QTY OF PRODUCT 2',
    required: false,
    control: 'NUMBER',
  },
  {
    key: 'callStatus',
    label: 'Call Status',
    required: false,
    control: 'SELECT',
  },
  {
    key: 'callAttempts',
    label: 'NO.OF CALL ATTEMTS',
    required: false,
    control: 'SELECT',
  },
  {
    key: 'msgAttempts',
    label: 'NO.OF MSG ATTEMPTS',
    required: false,
    control: 'SELECT',
  },
  { key: 'country', label: 'Country', required: false, control: 'SELECT' },
  { key: 'state', label: 'State', required: false, control: 'SELECT' },
  { key: 'street', label: 'Street', required: false, control: 'TEXT' },
  { key: 'city', label: 'CITY', required: false, control: 'TEXT' },
  {
    key: 'nationalCode',
    label: 'National Code',
    required: false,
    control: 'TEXT',
  },
  {
    key: 'bookingDate',
    label: 'BOOKING DATE',
    required: false,
    control: 'DATE',
  },
  {
    key: 'pipeline',
    label: 'Lead Pipeline',
    required: true,
    control: 'SELECT',
  },
  { key: 'category', label: 'Category', required: false, control: 'SELECT' },
  {
    key: 'actualAmount',
    label: 'Actual Amount',
    required: false,
    control: 'NUMBER',
  },
  {
    key: 'forecastedAmount',
    label: 'Forecasted Amount',
    required: false,
    control: 'NUMBER',
  },
  {
    key: 'paymentMethod',
    label: 'Payment Method',
    required: false,
    control: 'SELECT',
  },
] as const;

export const LEAD_SYSTEM_FIELD_KEYS = LEAD_SYSTEM_FIELDS.map(
  (field) => field.key,
) as readonly string[];

/**
 * A form cannot hide a field the create API refuses a lead without. The four are the
 * drawer's own required markers, so this is the API's rule surfaced, not a new one.
 */
export const REQUIRED_LEAD_FIELD_KEYS = LEAD_SYSTEM_FIELDS.filter(
  (field) => field.required,
).map((field) => field.key) as readonly string[];
