import {
  csvCell,
  EXPORT_COLUMNS,
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

describe('column value formatters', () => {
  const value = (key: string, row: Partial<LeadExportRow>) =>
    EXPORT_COLUMNS.find((c) => c.key === key)!.value(row as LeadExportRow);

  it('joins assigned agent names and tag names', () => {
    const row = {
      assignments: [{ user: { name: 'Aisha' } }, { user: { name: 'Omar' } }],
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
