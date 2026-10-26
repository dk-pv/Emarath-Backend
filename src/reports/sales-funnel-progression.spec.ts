import { Prisma } from '../generated/prisma/client';
import {
  addProgression,
  snapshotField,
  stageNameNow,
  type StageProgression,
  type StageRename,
  type StatusMove,
} from './sales-funnel-progression';

const dec = (value: string) => new Prisma.Decimal(value);
const at = (day: number) => new Date(Date.UTC(2026, 9, day));

function rollup(
  leads: { id: string; status: string; actualAmount: string | null }[],
  moves: StatusMove[],
  renames: StageRename[] = [],
): Record<string, [number, string]> {
  const into = new Map<string, StageProgression>();
  addProgression(
    into,
    leads.map((lead) => ({
      ...lead,
      actualAmount: lead.actualAmount === null ? null : dec(lead.actualAmount),
    })),
    moves,
    renames,
  );
  return Object.fromEntries(
    [...into].map(([stage, row]) => [stage, [row.count, row.value.toFixed(2)]]),
  );
}

describe('stageNameNow', () => {
  const renames: StageRename[] = [
    { at: at(5), from: 'HOT', to: 'Hot Lead' },
    { at: at(9), from: 'Hot Lead', to: 'Very Hot' },
    // A new stage takes the freed name later on.
    { at: at(12), from: 'Warm', to: 'HOT' },
  ];

  it('follows every rename made after the move, oldest first', () => {
    expect(stageNameNow('HOT', at(2), renames)).toBe('Very Hot');
    expect(stageNameNow('Hot Lead', at(6), renames)).toBe('Very Hot');
  });

  it('ignores renames made before the move', () => {
    expect(stageNameNow('Very Hot', at(10), renames)).toBe('Very Hot');
  });

  it('does not confuse a reused name with the stage that used to carry it', () => {
    // Warm took the name HOT on day 12, after the old HOT had become Very Hot.
    expect(stageNameNow('Warm', at(10), renames)).toBe('HOT');
    expect(stageNameNow('HOT', at(13), renames)).toBe('HOT');
    expect(stageNameNow('HOT', at(2), renames)).toBe('Very Hot');
  });
});

describe('addProgression (Full Funnel View)', () => {
  it('counts a lead with no recorded moves in its current stage only', () => {
    expect(
      rollup([{ id: 'a', status: 'New', actualAmount: '10.50' }], []),
    ).toEqual({ New: [1, '10.50'] });
  });

  it('counts a lead once in every stage it entered or left', () => {
    const moves: StatusMove[] = [
      { leadId: 'a', createdAt: at(1), from: 'New', to: 'HOT' },
      { leadId: 'a', createdAt: at(2), from: 'HOT', to: 'WON' },
      // Back to a stage it has already been in: still one lead there.
      { leadId: 'a', createdAt: at(3), from: 'WON', to: 'HOT' },
      { leadId: 'b', createdAt: at(1), from: 'New', to: 'LOST' },
    ];
    expect(
      rollup(
        [
          { id: 'a', status: 'HOT', actualAmount: '100' },
          { id: 'b', status: 'LOST', actualAmount: null },
          { id: 'c', status: 'New', actualAmount: '5' },
        ],
        moves,
      ),
    ).toEqual({
      HOT: [1, '100.00'],
      New: [3, '105.00'],
      WON: [1, '100.00'],
      LOST: [1, '0.00'],
    });
  });

  it('skips moves of leads outside the batch and moves that name no stage', () => {
    expect(
      rollup(
        [{ id: 'a', status: 'HOT', actualAmount: '1' }],
        [
          { leadId: 'z', createdAt: at(1), from: 'New', to: 'Cold' },
          { leadId: 'a', createdAt: at(1), from: null, to: 'HOT' },
        ],
      ),
    ).toEqual({ HOT: [1, '1.00'] });
  });

  it('counts history recorded under a stage’s old name toward the renamed stage', () => {
    expect(
      rollup(
        [{ id: 'a', status: 'WON', actualAmount: '7' }],
        [{ leadId: 'a', createdAt: at(1), from: 'HOT', to: 'WON' }],
        [{ at: at(4), from: 'HOT', to: 'Very Hot' }],
      ),
    ).toEqual({ 'Very Hot': [1, '7.00'], WON: [1, '7.00'] });
  });

  it('adds batches together', () => {
    const into = new Map<string, StageProgression>();
    addProgression(
      into,
      [{ id: 'a', status: 'New', actualAmount: dec('1.25') }],
      [],
      [],
    );
    addProgression(
      into,
      [{ id: 'b', status: 'New', actualAmount: dec('2.50') }],
      [],
      [],
    );
    expect(into.get('New')?.count).toBe(2);
    expect(into.get('New')?.value.toFixed(2)).toBe('3.75');
  });
});

describe('snapshotField', () => {
  it('reads a non-empty string field of an object snapshot', () => {
    expect(snapshotField({ status: 'WON' }, 'status')).toBe('WON');
    expect(snapshotField({ name: 'HOT' }, 'name')).toBe('HOT');
  });

  it('is null for anything else', () => {
    expect(snapshotField(null, 'status')).toBeNull();
    expect(snapshotField({ status: '' }, 'status')).toBeNull();
    expect(snapshotField({ status: 3 }, 'status')).toBeNull();
    expect(snapshotField(['WON'], 'status')).toBeNull();
    expect(snapshotField('WON', 'status')).toBeNull();
  });
});
