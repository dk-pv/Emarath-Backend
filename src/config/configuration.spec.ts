import {
  DEFAULT_BUSINESS_TIME_ZONE,
  resolveBusinessTimeZone,
} from './configuration';

/*
  The business timezone decides which delivery dates are today, tomorrow and overdue (ADR-0094).
  It must be an IANA name, which follows a country's clock, never a fixed offset; a bad value
  stops the app at boot rather than miscounting days.
*/
describe('BUSINESS_TIME_ZONE', () => {
  it('falls back to Asia/Dubai, named in one place, when unset or blank', () => {
    expect(DEFAULT_BUSINESS_TIME_ZONE).toBe('Asia/Dubai');
    expect(resolveBusinessTimeZone(undefined)).toBe('Asia/Dubai');
    expect(resolveBusinessTimeZone('   ')).toBe('Asia/Dubai');
  });

  it.each(['Asia/Dubai', 'Asia/Riyadh', 'Asia/Muscat', 'Asia/Qatar', 'UTC'])(
    'accepts %s',
    (timeZone) => {
      expect(resolveBusinessTimeZone(` ${timeZone} `)).toBe(timeZone);
    },
  );

  it.each(['+04:00', 'GMT+4', 'UTC+4', 'Dubai', 'Asia/Atlantis', 'asia/dubai'])(
    'refuses %j',
    (timeZone) => {
      expect(() => resolveBusinessTimeZone(timeZone)).toThrow(
        /Invalid BUSINESS_TIME_ZONE/,
      );
    },
  );
});
