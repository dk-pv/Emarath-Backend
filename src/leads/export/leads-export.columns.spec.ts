import { LeadCustomFieldType } from '../../generated/prisma/client';
import {
  csvCell,
  EXPORT_COLUMNS,
  ExportCustomField,
  formatCustomValue,
  LeadExportRow,
  resolveExportColumns,
} from './leads-export.columns';

const keysOf = (columns: { key: string }[]) => columns.map((c) => c.key);

describe('resolveExportColumns', () => {
  it('returns the whole catalog for scope=all', () => {
    const columns = resolveExportColumns('all', undefined);
    expect(columns).toHaveLength(EXPORT_COLUMNS.length);
    expect(keysOf(columns)).toEqual(keysOf(EXPORT_COLUMNS));
  });

  it('returns the requested columns, in the requested order, for scope=default', () => {
    const columns = resolveExportColumns('default', 'status,name,primaryPhone');
    expect(keysOf(columns)).toEqual(['status', 'name', 'primaryPhone']);
  });

  it('drops unknown column ids rather than failing', () => {
    const columns = resolveExportColumns('default', 'name,bogus,status');
    expect(keysOf(columns)).toEqual(['name', 'status']);
  });

  it('falls back to the default visible columns when none are usable', () => {
    expect(resolveExportColumns('default', '')).toHaveLength(15);
    expect(resolveExportColumns('default', 'bogus,unknown')).toHaveLength(15);
    expect(keysOf(resolveExportColumns('default', ''))[0]).toBe('name');
  });
});

const CUSTOM: ExportCustomField[] = [
  { key: 'cf_a', name: 'Alpha', type: LeadCustomFieldType.TEXT },
  { key: 'cf_b', name: 'Beta', type: LeadCustomFieldType.NUMBER },
];

describe('resolveExportColumns with custom fields', () => {
  it('keeps a custom column where the layout put it', () => {
    const columns = resolveExportColumns(
      'default',
      'status,cf_b,name,cf_a',
      CUSTOM,
    );
    expect(keysOf(columns)).toEqual(['status', 'cf_b', 'name', 'cf_a']);
    expect(columns.map((c) => c.header)).toEqual([
      'Lead Status',
      'Beta',
      'Customer Name',
      'Alpha',
    ]);
  });

  it('adds every custom field after the catalog for scope=all', () => {
    const columns = resolveExportColumns('all', undefined, CUSTOM);
    expect(keysOf(columns)).toEqual([
      ...keysOf(EXPORT_COLUMNS),
      'cf_a',
      'cf_b',
    ]);
  });

  it('drops a custom key that is not an active field', () => {
    expect(
      keysOf(resolveExportColumns('default', 'name,cf_a,cf_zz', CUSTOM)),
    ).toEqual(['name', 'cf_a']);
    expect(keysOf(resolveExportColumns('default', 'name,cf_a'))).toEqual([
      'name',
    ]);
  });

  it('still falls back to the default visible columns when nothing usable is named', () => {
    expect(resolveExportColumns('default', 'cf_zz', CUSTOM)).toHaveLength(15);
  });
});

describe('formatCustomValue', () => {
  const T = LeadCustomFieldType;

  it('writes text, text boxes, drop-downs and numbers as stored', () => {
    expect(formatCustomValue(T.TEXT, 'Gate 4')).toBe('Gate 4');
    expect(formatCustomValue(T.TEXTBOX, 'a\nb')).toBe('a\nb');
    expect(formatCustomValue(T.DROP_DOWN, 'Villa')).toBe('Villa');
    expect(formatCustomValue(T.NUMBER, '-12.50')).toBe('-12.50');
  });

  it('writes a DATE as DD-MM-YYYY and a DATETIME on a 12-hour clock, as typed', () => {
    expect(formatCustomValue(T.DATE, '2026-10-13')).toBe('13-10-2026');
    expect(formatCustomValue(T.DATETIME, '2026-10-13T15:00')).toBe(
      '13-10-2026, 03:00 PM',
    );
    expect(formatCustomValue(T.DATETIME, '2026-10-13T00:05')).toBe(
      '13-10-2026, 12:05 AM',
    );
    expect(formatCustomValue(T.DATETIME, '2026-10-13T12:00')).toBe(
      '13-10-2026, 12:00 PM',
    );
    expect(formatCustomValue(T.DATETIME, '2026-10-13 09:30:15')).toBe(
      '13-10-2026, 09:30 AM',
    );
    expect(formatCustomValue(T.DATETIME, '2026-10-13')).toBe('13-10-2026');
  });

  it('writes an empty cell for no value, and an unfamiliar date shape as stored', () => {
    expect(formatCustomValue(T.DATE, undefined)).toBe('');
    expect(formatCustomValue(T.TEXT, undefined)).toBe('');
    expect(formatCustomValue(T.DATE, 'Oct 13 2026')).toBe('Oct 13 2026');
    expect(formatCustomValue(T.DATETIME, '2026-10-13T15:00:00Z')).toBe(
      '2026-10-13T15:00:00Z',
    );
  });
});

describe('column value formatters', () => {
  const value = (key: string, row: Partial<LeadExportRow>) =>
    EXPORT_COLUMNS.find((c) => c.key === key)!.value(row as LeadExportRow);

  it('joins assigned agent names and tag names', () => {
    const row = {
      assignments: [
        { createdAt: new Date('2026-08-01'), user: { name: 'Aisha' } },
        { createdAt: new Date('2026-08-02'), user: { name: 'Omar' } },
      ],
      tags: [{ tag: { name: 'QC VERIFIED' } }],
    };
    expect(value('assigned', row)).toBe('Aisha, Omar');
    expect(value('tags', row)).toBe('QC VERIFIED');
  });

  it('renders an absent optional as empty, never null', () => {
    expect(value('source', { source: null })).toBe('');
    expect(value('country', { country: null })).toBe('');
  });

  it('renders a created date in UTC as DD-MM-YYYY with a 12-hour clock', () => {
    const row = { createdAt: new Date('2026-07-16T09:05:00.000Z') };
    expect(value('createdAt', row)).toBe('16-07-2026, 09:05 AM');
  });
});

describe('csvCell', () => {
  it('passes a plain value through unquoted', () => {
    expect(csvCell('Aisha')).toBe('Aisha');
  });

  it('quotes and doubles quotes when the value contains a comma or quote', () => {
    expect(csvCell('Doe, John')).toBe('"Doe, John"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a value containing a newline', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});
