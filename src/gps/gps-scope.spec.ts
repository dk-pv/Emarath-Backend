import { UserRole } from '../generated/prisma/client';
import { gpsAgentWhere } from './gps-scope';

describe('gpsAgentWhere (AUTH-02.1 / ADR-0030 §6)', () => {
  it('pins a sales agent to self, ignoring any userId filter', () => {
    expect(gpsAgentWhere({ id: 'a1', role: UserRole.SALES_AGENT })).toEqual({
      id: 'a1',
    });
    // A userId filter can never widen an agent past themselves.
    expect(
      gpsAgentWhere({ id: 'a1', role: UserRole.SALES_AGENT }, 'a2'),
    ).toEqual({ id: 'a1' });
  });

  it('scopes a manager to their team when no userId filter is given', () => {
    expect(
      gpsAgentWhere({ id: 'm1', role: UserRole.SALES_MANAGER, team: 'Sales' }),
    ).toEqual({ team: 'Sales' });
  });

  it('intersects a manager userId filter with the team (never widens it)', () => {
    // Filtering by a team member: id AND team must both hold.
    expect(
      gpsAgentWhere(
        { id: 'm1', role: UserRole.SALES_MANAGER, team: 'Sales' },
        'a1',
      ),
    ).toEqual({ id: 'a1', team: 'Sales' });
  });

  it('yields no out-of-team agent even when a manager passes their id (§6.2)', () => {
    // The predicate requires team: 'Sales'; an out-of-team agent (team 'Support')
    // cannot satisfy it, so the query matches nothing rather than leaking data.
    const where = gpsAgentWhere(
      { id: 'm1', role: UserRole.SALES_MANAGER, team: 'Sales' },
      'outsider',
    );
    expect(where).toEqual({ id: 'outsider', team: 'Sales' });
  });

  it('falls a null-team manager back to own-only (§7)', () => {
    expect(
      gpsAgentWhere({ id: 'm1', role: UserRole.SALES_MANAGER, team: null }),
    ).toEqual({ id: 'm1' });
    // even with a userId filter, a teamless manager cannot reach another agent
    expect(
      gpsAgentWhere({ id: 'm1', role: UserRole.SALES_MANAGER }, 'a1'),
    ).toEqual({ id: 'm1' });
  });

  it('leaves admin / customer-service / marketing unrestricted, narrowable by userId', () => {
    for (const role of [
      UserRole.SUPERADMIN,
      UserRole.CUSTOMER_SERVICE_AGENT,
      UserRole.MARKETING_ANALYST,
    ]) {
      expect(gpsAgentWhere({ id: 'x', role })).toBeUndefined();
      expect(gpsAgentWhere({ id: 'x', role }, 'a1')).toEqual({ id: 'a1' });
    }
  });

  it('returns a value (or explicit undefined) for every role', () => {
    for (const role of Object.values(UserRole)) {
      // undefined is a valid "no restriction" result; the switch must be exhaustive.
      const result = gpsAgentWhere({ id: 'x', role });
      expect(result === undefined || typeof result === 'object').toBe(true);
    }
  });
});
