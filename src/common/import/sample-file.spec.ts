import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { ImportField } from './import-descriptor';
import { buildSampleFile } from './sample-file';
import { parseSpreadsheet } from './spreadsheet-parser';

const FIELDS: ImportField[] = [
  { value: 'name', label: 'Customer Name', type: 'string' },
  { value: 'primaryPhone', label: 'Primary Phone', type: 'phone' },
  { value: 'actualAmount', label: 'Actual Amount', type: 'decimal' },
  { value: 'bookingDate', label: 'Booking Date', type: 'date' },
];

const ROW = {
  name: 'Ahmed Ali',
  primaryPhone: '971501234567',
  actualAmount: '1500.00',
  bookingDate: '2026-10-15',
};

async function readBack(buffer: Buffer, originalname: string) {
  const sheet = await parseSpreadsheet({
    originalname,
    buffer,
    size: buffer.length,
  });
  return Object.fromEntries(
    sheet.headers.map((header, index) => [header, sheet.rows[0].cells[index]]),
  );
}

describe('buildSampleFile', () => {
  it('XLSX reads back as written, with the phone column Text-formatted', async () => {
    const buffer = await buildSampleFile(FIELDS, [ROW], 'xlsx');
    expect(await readBack(buffer, 'sample.xlsx')).toEqual({
      'Customer Name': 'Ahmed Ali',
      'Primary Phone': '971501234567',
      'Actual Amount': '1500',
      'Booking Date': '2026-10-15',
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(Readable.from(buffer));
    expect(workbook.worksheets[0].getCell(2, 2).numFmt).toBe('@');
  });

  it('CSV spaces the phone (Excel keeps it as text) and leaves the date blank', async () => {
    const buffer = await buildSampleFile(FIELDS, [ROW], 'csv');
    expect(await readBack(buffer, 'sample.csv')).toEqual({
      'Customer Name': 'Ahmed Ali',
      'Primary Phone': '971 501234567',
      'Actual Amount': '1500.00',
      'Booking Date': '',
    });
  });
});
