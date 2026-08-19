import { pinnedPageSlice } from './pinned-page';

describe('pinnedPageSlice', () => {
  it('serves an all-unpinned list unchanged when nothing is pinned', () => {
    expect(pinnedPageSlice(0, 25, 0)).toEqual({
      pinnedSkip: 0,
      pinnedTake: 0,
      unpinnedSkip: 0,
      unpinnedTake: 25,
    });
  });

  it('fills page 1 with the pinned block first, then unpinned', () => {
    // 2 pinned + 23 unpinned = a full 25-row first page.
    expect(pinnedPageSlice(0, 25, 2)).toEqual({
      pinnedSkip: 0,
      pinnedTake: 2,
      unpinnedSkip: 0,
      unpinnedTake: 23,
    });
  });

  it('continues cleanly onto page 2 with the pinned block exhausted', () => {
    // Page 2 (skip 25) with 2 pinned: no pinned left, unpinned resumes at 23.
    expect(pinnedPageSlice(25, 25, 2)).toEqual({
      pinnedSkip: 2,
      pinnedTake: 0,
      unpinnedSkip: 23,
      unpinnedTake: 25,
    });
  });

  it('shows only pinned rows when the whole page fits inside the pinned block', () => {
    expect(pinnedPageSlice(0, 25, 30)).toEqual({
      pinnedSkip: 0,
      pinnedTake: 25,
      unpinnedSkip: 0,
      unpinnedTake: 0,
    });
  });

  it('straddles the boundary: remaining pinned rows then the first unpinned', () => {
    // 30 pinned; page 2 (skip 25) shows the last 5 pinned + 20 unpinned.
    expect(pinnedPageSlice(25, 25, 30)).toEqual({
      pinnedSkip: 25,
      pinnedTake: 5,
      unpinnedSkip: 0,
      unpinnedTake: 20,
    });
  });
});
