// ============================================================================
// Tests for src/crs/WebMercator.ts
//
// The Web Mercator helpers are the foundation of all tile addressing —
// bugs here cascade into every layer, every render frame, every fetched tile.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { WebMercator } from '../../src/crs/WebMercator';
import { WEB_MERCATOR_EXTENT, WEB_MERCATOR_MAX_LAT } from '../../src/core/constants';

// ---------------------------------------------------------------------------
// project / unproject
// ---------------------------------------------------------------------------

describe('WebMercator.project / unproject', () => {
  it('projects the origin (0, 0) to (0, 0)', () => {
    const p = WebMercator.project({ lng: 0, lat: 0 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('unprojects (0, 0) back to the origin', () => {
    const ll = WebMercator.unproject({ x: 0, y: 0 });
    expect(ll.lng).toBeCloseTo(0, 6);
    expect(ll.lat).toBeCloseTo(0, 6);
  });

  it('round-trips mid-latitude points accurately', () => {
    const original = { lng: 13.404954, lat: 52.520008 }; // Berlin
    const projected = WebMercator.project(original);
    const unprojected = WebMercator.unproject(projected);
    expect(unprojected.lng).toBeCloseTo(original.lng, 6);
    expect(unprojected.lat).toBeCloseTo(original.lat, 6);
  });

  it('round-trips a Southern-Hemisphere point', () => {
    const original = { lng: -58.3816, lat: -34.6037 }; // Buenos Aires
    const p = WebMercator.project(original);
    const ll = WebMercator.unproject(p);
    expect(ll.lng).toBeCloseTo(original.lng, 6);
    expect(ll.lat).toBeCloseTo(original.lat, 6);
  });

  it('projects ±180° longitude to ±WEB_MERCATOR_EXTENT x', () => {
    const east = WebMercator.project({ lng: 180, lat: 0 });
    const west = WebMercator.project({ lng: -180, lat: 0 });
    expect(east.x).toBeCloseTo(WEB_MERCATOR_EXTENT, 0);
    expect(west.x).toBeCloseTo(-WEB_MERCATOR_EXTENT, 0);
  });

  it('clamps latitudes above WEB_MERCATOR_MAX_LAT', () => {
    const near = WebMercator.project({ lng: 0, lat: WEB_MERCATOR_MAX_LAT });
    const beyond = WebMercator.project({ lng: 0, lat: 89.9 });
    // The 89.9° input is clamped to MAX_LAT, so the two projections match.
    expect(beyond.y).toBeCloseTo(near.y, 3);
  });

  it('clamps latitudes below -WEB_MERCATOR_MAX_LAT symmetrically', () => {
    const near = WebMercator.project({ lng: 0, lat: -WEB_MERCATOR_MAX_LAT });
    const beyond = WebMercator.project({ lng: 0, lat: -89.9 });
    expect(beyond.y).toBeCloseTo(near.y, 3);
  });
});

// ---------------------------------------------------------------------------
// World-plane scaling
// ---------------------------------------------------------------------------

describe('WebMercator.toWorldPlane / fromWorldPlane', () => {
  it('round-trips through the world-plane transform', () => {
    const worldScale = 40075.016686;
    const point = { x: 12345.67, y: -98765.43 };
    const plane = WebMercator.toWorldPlane(point, worldScale);
    const back = WebMercator.fromWorldPlane(plane, worldScale);
    expect(back.x).toBeCloseTo(point.x, 4);
    expect(back.y).toBeCloseTo(point.y, 4);
  });

  it('maps the full mercator extent to ±worldScale/2 on each axis', () => {
    const worldScale = 40075.016686;
    const extent = WebMercator.toWorldPlane(
      { x: WEB_MERCATOR_EXTENT, y: WEB_MERCATOR_EXTENT },
      worldScale,
    );
    expect(extent.x).toBeCloseTo(worldScale / 2, 4);
    expect(extent.y).toBeCloseTo(worldScale / 2, 4);
  });
});

// ---------------------------------------------------------------------------
// Tile bounds + centers
// ---------------------------------------------------------------------------

describe('WebMercator.tileBounds', () => {
  it('covers the full world at zoom 0', () => {
    const b = WebMercator.tileBounds({ z: 0, x: 0, y: 0 });
    expect(b.west).toBeCloseTo(-WEB_MERCATOR_EXTENT, 4);
    expect(b.east).toBeCloseTo(WEB_MERCATOR_EXTENT, 4);
    expect(b.north).toBeCloseTo(WEB_MERCATOR_EXTENT, 4);
    expect(b.south).toBeCloseTo(-WEB_MERCATOR_EXTENT, 4);
  });

  it('places y=0 at the north, y increasing southward (XYZ convention)', () => {
    const top = WebMercator.tileBounds({ z: 1, x: 0, y: 0 });
    const bottom = WebMercator.tileBounds({ z: 1, x: 0, y: 1 });
    expect(top.north).toBeCloseTo(WEB_MERCATOR_EXTENT, 4);
    expect(top.south).toBeCloseTo(0, 4);
    expect(bottom.north).toBeCloseTo(0, 4);
    expect(bottom.south).toBeCloseTo(-WEB_MERCATOR_EXTENT, 4);
  });

  it('places x=0 at the west, x increasing eastward', () => {
    const left = WebMercator.tileBounds({ z: 1, x: 0, y: 0 });
    const right = WebMercator.tileBounds({ z: 1, x: 1, y: 0 });
    expect(left.west).toBeCloseTo(-WEB_MERCATOR_EXTENT, 4);
    expect(left.east).toBeCloseTo(0, 4);
    expect(right.west).toBeCloseTo(0, 4);
    expect(right.east).toBeCloseTo(WEB_MERCATOR_EXTENT, 4);
  });

  it('halves tile size at each successive zoom', () => {
    const z0 = WebMercator.tileBounds({ z: 0, x: 0, y: 0 });
    const z1 = WebMercator.tileBounds({ z: 1, x: 0, y: 0 });
    const z2 = WebMercator.tileBounds({ z: 2, x: 0, y: 0 });

    const size0 = z0.east - z0.west;
    const size1 = z1.east - z1.west;
    const size2 = z2.east - z2.west;

    expect(size1).toBeCloseTo(size0 / 2, 4);
    expect(size2).toBeCloseTo(size0 / 4, 4);
  });
});

// ---------------------------------------------------------------------------
// Tile helpers
// ---------------------------------------------------------------------------

describe('WebMercator.tileCenter / tileWorldSize', () => {
  it('tileCenter at z=0 is the world origin in world-plane units', () => {
    const worldScale = 40075.016686;
    const center = WebMercator.tileCenter({ z: 0, x: 0, y: 0 }, worldScale);
    expect(center.x).toBeCloseTo(0, 4);
    expect(center.y).toBeCloseTo(0, 4);
  });

  it('tileWorldSize halves at each zoom level', () => {
    const worldScale = 40075.016686;
    const s0 = WebMercator.tileWorldSize(0, worldScale);
    const s1 = WebMercator.tileWorldSize(1, worldScale);
    const s2 = WebMercator.tileWorldSize(2, worldScale);
    expect(s0).toBeCloseTo(worldScale, 4);
    expect(s1).toBeCloseTo(worldScale / 2, 4);
    expect(s2).toBeCloseTo(worldScale / 4, 4);
  });
});
