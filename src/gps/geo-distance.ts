/**
 * Great-circle distance between two coordinates, in metres (GPS-09.1).
 *
 * The first distance utility in the codebase — there was none to reuse, so this is
 * the single implementation every proximity rule must go through rather than each
 * caller rolling its own.
 *
 * Haversine on a spherical Earth. Accurate to ~0.5 % worst case, which over the
 * ~150 m gate this serves is well under a metre — far below the GPS error the radius
 * already absorbs. A geodesic model (Vincenty) would be false precision here.
 */
const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export interface Coordinates {
  lat: number;
  lng: number;
}

export function distanceInMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const latA = toRadians(a.lat);
  const latB = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}
