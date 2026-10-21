import { Prisma } from '../generated/prisma/client';
import { fromDbDate } from './delivery-date';

/**
 * The generic delivery-partner file (3PL-01): what a partner needs to ship a QC-verified order,
 * from the order's own snapshot, with the order panel's labels. No partner template is known yet;
 * when one is, it is another column list, not a change to this one.
 */
export const EXPORT_SELECT = {
  orderNumber: true,
  customerName: true,
  primaryPhone: true,
  secondaryPhone: true,
  street: true,
  city: true,
  state: true,
  country: true,
  nationalCode: true,
  product: true,
  productQty: true,
  product2: true,
  product2Qty: true,
  orderValue: true,
  paymentMethod: true,
  deliveryDate: true,
  qcRemarks: true,
} satisfies Prisma.LogisticsOrderSelect;

export type ExportOrderRow = Prisma.LogisticsOrderGetPayload<{
  select: typeof EXPORT_SELECT;
}>;

/** A raw decimal, never with the "د.إ" the screen adds, so a spreadsheet reads a number. */
const decimal = (value: Prisma.Decimal | null): string =>
  value?.toString() ?? '';

export const EXPORT_COLUMNS: readonly {
  header: string;
  value: (row: ExportOrderRow) => string;
}[] = [
  { header: 'Order Number', value: (row) => String(row.orderNumber) },
  { header: 'Customer Name', value: (row) => row.customerName },
  { header: 'Primary Phone', value: (row) => row.primaryPhone },
  { header: 'Secondary Phone', value: (row) => row.secondaryPhone ?? '' },
  { header: 'Street', value: (row) => row.street ?? '' },
  { header: 'City', value: (row) => row.city ?? '' },
  { header: 'State', value: (row) => row.state ?? '' },
  { header: 'Country', value: (row) => row.country ?? '' },
  { header: 'National Code', value: (row) => row.nationalCode ?? '' },
  { header: 'Product', value: (row) => row.product ?? '' },
  { header: 'Product Qty', value: (row) => decimal(row.productQty) },
  { header: 'Product 2', value: (row) => row.product2 ?? '' },
  { header: 'Product 2 Qty', value: (row) => decimal(row.product2Qty) },
  { header: 'Order Value', value: (row) => decimal(row.orderValue) },
  { header: 'Payment Method', value: (row) => row.paymentMethod ?? '' },
  // YYYY-MM-DD: the stored calendar day, which every spreadsheet reads as a date.
  {
    header: 'Delivery Date',
    value: (row) => (row.deliveryDate ? fromDbDate(row.deliveryDate) : ''),
  },
  { header: 'QC Remarks', value: (row) => row.qcRemarks ?? '' },
];

/** A timestamped, download-safe name: `qc-verified-orders-YYYYMMDD-HHmmss.csv`. */
export function exportFilename(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `qc-verified-orders-${stamp}.csv`;
}
