import { TagAccessMode } from '../generated/prisma/client';
import {
  DEFAULT_TAG_ACCESS,
  FULL_TAG_ACCESS,
  TagPolicy,
  mayHandleTag,
  resolveTagAccess,
} from './tag-access';

const A = 'tag-a';
const B = 'tag-b';
const C = 'tag-c';

const policy = (over: Partial<TagPolicy> = {}): TagPolicy => ({
  canCreate: null,
  tagAccess: null,
  tagIds: [],
  ...over,
});

const listed = (...tagIds: string[]) =>
  policy({ tagAccess: TagAccessMode.LISTED, tagIds });

describe('resolveTagAccess — the compatibility default', () => {
  it('changes nothing for a user with no team policy and no override', () => {
    const access = resolveTagAccess(null, null);
    // Every tag selectable, only an administrator creates: exactly the behaviour before
    // Tag Permissions existed, so introducing the table locks nobody out.
    expect(access).toEqual(DEFAULT_TAG_ACCESS);
    expect(access.canCreate).toBe(false);
    expect(access.allowedTagIds).toBeNull();
  });

  it('does not grant creation or restrict tags through an override with nothing set', () => {
    expect(resolveTagAccess(null, policy())).toEqual(DEFAULT_TAG_ACCESS);
  });
});

describe('resolveTagAccess — team defaults', () => {
  it('limits a LISTED team to its granted tags only', () => {
    const access = resolveTagAccess(listed(A, B), null);
    expect(mayHandleTag(access, A)).toBe(true);
    expect(mayHandleTag(access, B)).toBe(true);
    expect(mayHandleTag(access, C)).toBe(false);
  });

  it('keeps an ALL team unrestricted', () => {
    const access = resolveTagAccess(
      policy({ tagAccess: TagAccessMode.ALL, canCreate: false }),
      null,
    );
    expect(access.allowedTagIds).toBeNull();
    expect(mayHandleTag(access, C)).toBe(true);
  });

  it('reads tag creation from the team', () => {
    expect(resolveTagAccess(policy({ canCreate: true }), null).canCreate).toBe(
      true,
    );
    expect(resolveTagAccess(policy({ canCreate: false }), null).canCreate).toBe(
      false,
    );
  });

  it('lets a LISTED team with no grants select nothing', () => {
    const access = resolveTagAccess(listed(), null);
    expect(mayHandleTag(access, A)).toBe(false);
  });
});

describe('resolveTagAccess — user override precedence', () => {
  it('replaces the team list with the override list, not merges the two', () => {
    const access = resolveTagAccess(listed(A, B), listed(C));
    expect(mayHandleTag(access, C)).toBe(true);
    // A and B came only from the team: the override list wins outright.
    expect(mayHandleTag(access, A)).toBe(false);
    expect(mayHandleTag(access, B)).toBe(false);
  });

  it('lets an ALL override widen a LISTED team', () => {
    const access = resolveTagAccess(
      listed(A),
      policy({ tagAccess: TagAccessMode.ALL }),
    );
    expect(access.allowedTagIds).toBeNull();
  });

  it('lets a LISTED override narrow an ALL team', () => {
    const access = resolveTagAccess(
      policy({ tagAccess: TagAccessMode.ALL, canCreate: true }),
      listed(A),
    );
    expect(mayHandleTag(access, A)).toBe(true);
    expect(mayHandleTag(access, B)).toBe(false);
    // …and the team's creation right is still inherited.
    expect(access.canCreate).toBe(true);
  });

  it('resolves tag creation and tag selection independently', () => {
    // The override only grants creation; the team list stays in force.
    const access = resolveTagAccess(listed(A), policy({ canCreate: true }));
    expect(access.canCreate).toBe(true);
    expect(mayHandleTag(access, A)).toBe(true);
    expect(mayHandleTag(access, B)).toBe(false);
  });

  it('lets an explicit false override a team that allows creation', () => {
    const access = resolveTagAccess(
      policy({ canCreate: true }),
      policy({ canCreate: false }),
    );
    expect(access.canCreate).toBe(false);
  });

  it('inherits every field the override leaves null', () => {
    const access = resolveTagAccess(
      { canCreate: true, tagAccess: TagAccessMode.LISTED, tagIds: [A] },
      policy(),
    );
    expect(access.canCreate).toBe(true);
    expect(mayHandleTag(access, A)).toBe(true);
    expect(mayHandleTag(access, B)).toBe(false);
  });

  it('lets a LISTED override with no grants select nothing, whatever the team says', () => {
    const access = resolveTagAccess(
      policy({ tagAccess: TagAccessMode.ALL }),
      listed(),
    );
    expect(mayHandleTag(access, A)).toBe(false);
  });
});

describe('FULL_TAG_ACCESS', () => {
  it('is unrestricted and may create — what an administrator gets', () => {
    expect(FULL_TAG_ACCESS.canCreate).toBe(true);
    expect(mayHandleTag(FULL_TAG_ACCESS, A)).toBe(true);
  });
});
