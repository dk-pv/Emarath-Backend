import { registerAs } from '@nestjs/config';

/**
 * GPS configuration (GPS-09.1). Its own `gps` namespace, consumed via
 * `ConfigService.get<GpsConfig>('gps')` so application code never reads
 * `process.env` directly (CLAUDE.md §5) — the same shape as `auth` and `storage`.
 */
export interface GpsConfig {
  /**
   * How close a check-in must be to a follow-up's site before it can complete it,
   * in metres. Configurable because the right number is operational, not technical:
   * a shop doorway and a industrial depot need different gates. A site may override
   * it individually via `Location.radiusMeters`.
   *
   * 150 m by default — comfortably outside consumer GPS error (typically 5–50 m,
   * worse between buildings) while still proving the agent was at the site rather
   * than driving past it.
   */
  checkInRadiusMeters: number;
}

const DEFAULT_CHECK_IN_RADIUS_METERS = 150;

export default registerAs('gps', (): GpsConfig => {
  const raw = Number(process.env['GPS_CHECK_IN_RADIUS_METERS']);
  return {
    checkInRadiusMeters:
      Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHECK_IN_RADIUS_METERS,
  };
});
