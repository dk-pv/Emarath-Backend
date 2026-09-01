import { distanceInMeters } from './geo-distance';

describe('distanceInMeters', () => {
  const kozhikode = { lat: 11.2588, lng: 75.7804 };

  it('is zero for the same point', () => {
    expect(distanceInMeters(kozhikode, kozhikode)).toBe(0);
  });

  it('measures a known short offset', () => {
    // 0.001° of latitude is ~111.2 m anywhere on Earth.
    const north = { lat: kozhikode.lat + 0.001, lng: kozhikode.lng };
    expect(distanceInMeters(kozhikode, north)).toBeCloseTo(111.2, 0);
  });

  it('is symmetric', () => {
    const other = { lat: 11.26, lng: 75.79 };
    expect(distanceInMeters(kozhikode, other)).toBeCloseTo(
      distanceInMeters(other, kozhikode),
      6,
    );
  });

  it('matches a known long-haul distance within 0.5%', () => {
    // London ↔ Paris, ~343.5 km.
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const km = distanceInMeters(london, paris) / 1000;
    expect(km).toBeGreaterThan(342);
    expect(km).toBeLessThan(345);
  });

  it('handles the antimeridian without wrapping the wrong way', () => {
    const west = { lat: 0, lng: 179.999 };
    const east = { lat: 0, lng: -179.999 };
    // ~222 m apart across the line, not most of the way round the planet.
    expect(distanceInMeters(west, east)).toBeLessThan(300);
  });
});
