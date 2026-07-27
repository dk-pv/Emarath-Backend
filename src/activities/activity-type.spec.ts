import { ActivityType } from '../generated/prisma/client';

// ts-jest runs with isolatedModules (transpile-only), so type-level checks are
// not enforced here — the schema's field shape is verified by prisma migrate +
// generate + build. This spec guards the one part of the data model that is both
// new and checkable at runtime: the ActivityType contract (gap M1). A round-trip
// over the models lands with the service (ACT-02.1/03.1), per ADR-0027.
describe('ActivityType (ACT-01.1)', () => {
  it('is exactly the Workpex Follow Up Type set', () => {
    expect(Object.values(ActivityType).sort()).toEqual([
      'CALL',
      'MEETING',
      'TASK',
    ]);
  });

  it('maps each member to its own name', () => {
    expect(ActivityType.CALL).toBe('CALL');
    expect(ActivityType.MEETING).toBe('MEETING');
    expect(ActivityType.TASK).toBe('TASK');
  });
});
