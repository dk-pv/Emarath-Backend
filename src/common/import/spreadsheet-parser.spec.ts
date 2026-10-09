import ExcelJS from 'exceljs';
import { parseSpreadsheet } from './spreadsheet-parser';

const csv = (body: string | Buffer, name = 'leads.csv') => {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return { originalname: name, buffer, size: buffer.length };
};

async function xlsx(
  build: (sheet: ExcelJS.Worksheet) => void,
): Promise<{ originalname: string; buffer: Buffer; size: number }> {
  const workbook = new ExcelJS.Workbook();
  build(workbook.addWorksheet('Leads'));
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { originalname: 'leads.xlsx', buffer, size: buffer.length };
}

describe('parseSpreadsheet — CSV', () => {
  it('keeps every cell exactly as written: leading zeros, "+", dates', async () => {
    const sheet = await parseSpreadsheet(
      csv(
        'Name,Phone,Mobile,Booked,Blank\r\nAli,0501234567,+971501234567,2026-10-08, \r\n',
      ),
    );
    expect(sheet.rows[0].cells).toEqual([
      'Ali',
      '0501234567',
      '+971501234567',
      '2026-10-08',
      '',
    ]);
  });

  it('strips a UTF-8 BOM from the first header', async () => {
    const sheet = await parseSpreadsheet(csv('\uFEFFCustomer Name\nAli\n'));
    expect(sheet.headers).toEqual(['Customer Name']);
  });

  it('numbers rows as the file does, across a blank line', async () => {
    const sheet = await parseSpreadsheet(csv('Name\nAli\n\nSara\n'));
    expect(sheet.rows).toEqual([
      { rowNumber: 2, cells: ['Ali'] },
      { rowNumber: 4, cells: ['Sara'] },
    ]);
  });

  it('keeps a column that sits after an empty one', async () => {
    const sheet = await parseSpreadsheet(csv('Name,,Phone\nAli,,0501234567\n'));
    expect(sheet.headers).toEqual(['Name', 'Column 2', 'Phone']);
    expect(sheet.rows[0].cells).toEqual(['Ali', '', '0501234567']);
  });

  it('rejects a repeated column name, naming the header row', async () => {
    await expect(
      parseSpreadsheet(csv('Name,Phone,Phone\nAli,1,2\n')),
    ).rejects.toThrow(
      'The column "Phone" appears more than once in the header row (row 1)',
    );
  });

  it('explains a semicolon-separated CSV instead of showing one merged column', async () => {
    await expect(
      parseSpreadsheet(csv('Customer Name;Primary Phone\nAli;971501234567\n')),
    ).rejects.toThrow('This CSV is separated by semicolons.');
  });

  it('rejects a header with no data rows', async () => {
    await expect(parseSpreadsheet(csv('Name,Phone\r\n'))).rejects.toThrow(
      'The file has no data rows to import.',
    );
  });

  it('rejects an empty file, a non-UTF-8 CSV and an unsupported type', async () => {
    await expect(parseSpreadsheet(csv(''))).rejects.toThrow(
      'The uploaded file is empty.',
    );
    const utf16 = Buffer.from('\uFEFFName\r\nAli\r\n', 'utf16le');
    await expect(parseSpreadsheet(csv(utf16))).rejects.toThrow(
      'The CSV could not be read as text',
    );
    await expect(
      parseSpreadsheet(csv('Name\nAli', 'leads.xls')),
    ).rejects.toThrow('File must be a CSV or XLSX.');
  });
});

describe('parseSpreadsheet — XLSX', () => {
  it('reads text phones, numbers and real dates as text', async () => {
    const file = await xlsx((sheet) => {
      sheet.addRow(['Name', 'Phone', 'Amount', 'Booked']);
      sheet.addRow([
        'Ali',
        '0501234567',
        1500,
        new Date('2026-10-08T00:00:00Z'),
      ]);
    });
    const sheet = await parseSpreadsheet(file);
    expect(sheet.rows[0].cells).toEqual([
      'Ali',
      '0501234567',
      '1500',
      '2026-10-08',
    ]);
  });

  it('reads a computed amount at the precision Excel shows', async () => {
    const file = await xlsx((sheet) => {
      sheet.addRow(['Amount', 'Phone']);
      sheet.addRow([0.1 * 3, 971501234567]);
    });
    const sheet = await parseSpreadsheet(file);
    // 0.1 * 3 is 0.30000000000000004 in binary; Excel shows (and the user means) 0.3.
    expect(sheet.rows[0].cells).toEqual(['0.3', '971501234567']);
  });

  it('reports a date-formatted huge number as "Invalid Date", never as blank', async () => {
    const file = await xlsx((sheet) => {
      sheet.addRow(['Booked', 'Phone']);
      const row = sheet.addRow([971501234567, '0501234567']);
      row.getCell(1).numFmt = 'yyyy-mm-dd';
    });
    const sheet = await parseSpreadsheet(file);
    expect(sheet.rows[0].cells).toEqual(['Invalid Date', '0501234567']);
  });

  it('keeps an error cell as its text (#N/A), as a CSV would, not as blank', async () => {
    const file = await xlsx((sheet) => {
      sheet.addRow(['Source', 'Phone']);
      sheet.addRow([{ error: '#N/A' }, '0501234567']);
    });
    const sheet = await parseSpreadsheet(file);
    expect(sheet.rows[0].cells).toEqual(['#N/A', '0501234567']);
  });

  it('drops a NUL that a cell or header carries as _x0000_', async () => {
    const file = await xlsx((sheet) => {
      sheet.addRow(['Na_x0000_me', 'Phone']);
      sheet.addRow(['x_x0000_y', '0501234567']);
    });
    const sheet = await parseSpreadsheet(file);
    expect(sheet.headers).toEqual(['Name', 'Phone']);
    expect(sheet.rows[0].cells).toEqual(['xy', '0501234567']);
  });

  it('rejects a file that is not a real workbook', async () => {
    await expect(
      parseSpreadsheet(csv('Name\nAli\n', 'leads.xlsx')),
    ).rejects.toThrow('The file could not be read.');
  });
});
