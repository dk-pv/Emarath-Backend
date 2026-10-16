import { errorsToCsv, escapeCsv } from './errors-to-csv';

/*
  Every CSV the app writes goes through escapeCsv: a cell that a spreadsheet would run as a
  formula gets a leading apostrophe; numbers, phone numbers and ordinary text do not (ADR-0095).
*/
describe('escapeCsv', () => {
  it.each([
    ['+971501234567'],
    ['+971 50 123 4567'],
    ['+1 (555) 123-4567'],
    ['-5'],
    ['-12.50'],
    ['+3'],
    ['Aisha Khan'],
    ['971501234567'],
    ['2026-10-16'],
    [''],
  ])('writes %j as it is', (value) => {
    expect(escapeCsv(value)).toBe(value);
  });

  it.each([
    ['=1+1', "'=1+1"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['+cmd|calc', "'+cmd|calc"],
    ['-urgent', "'-urgent"],
    ['-2+3', "'-2+3"],
    ['\t=1+1', "'\t=1+1"],
  ])('neutralises %j', (value, expected) => {
    expect(escapeCsv(value)).toBe(expected);
  });

  it('neutralises before it quotes, so the apostrophe sits inside the quotes', () => {
    expect(escapeCsv('=HYPERLINK("http://example.test","open")')).toBe(
      `"'=HYPERLINK(""http://example.test"",""open"")"`,
    );
    expect(escapeCsv('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('still quotes ordinary text that carries a comma, quote or newline', () => {
    expect(escapeCsv('Doe, John')).toBe('"Doe, John"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('errorsToCsv', () => {
  it('neutralises a formula the user put in the file they imported', () => {
    const csv = errorsToCsv([
      {
        rowNumber: 2,
        errorCode: 'INVALID_PHONE',
        reason: 'Primary Phone must be a phone number of 7 to 15 digits',
        values: { Name: '=1+1', 'Primary Phone': '+971501234567' },
      },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'Row Number,Error Code,Reason,Name,Primary Phone',
      "2,INVALID_PHONE,Primary Phone must be a phone number of 7 to 15 digits,'=1+1,+971501234567",
    ]);
  });
});
