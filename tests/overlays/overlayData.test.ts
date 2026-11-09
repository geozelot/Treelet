// ============================================================================
// Tests for overlay data handling: GeoJSON normalization, styles, polygon
// rasterization and line densification.
// ============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeGeoJSON, overlayBounds, featuresOf } from '../../src/overlays/geojson';
import { resolveStyle, parseColor, cssOf } from '../../src/overlays/style';
import { rasterizePolygons, densify } from '../../src/overlays/rasterize';
import type { FeatureCollection } from '../../src/overlays/types';

afterEach(() => vi.restoreAllMocks());

const collection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Summit', ele: 2334 }, geometry: { type: 'Point', coordinates: [11.38, 47.31, 2334] } },
    { type: 'Feature', properties: { name: 'Trail' }, geometry: { type: 'LineString', coordinates: [[11.3, 47.2], [11.4, 47.25]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[11, 47], [11.1, 47], [11.1, 47.1], [11, 47.1], [11, 47]]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [
      { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] },
      { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2]]] },
    ] } },
    { type: 'Feature', properties: null, geometry: null },
  ],
};

describe('normalizeGeoJSON', () => {
  it('splits features into points, lines and polygons with outlines', () => {
    const n = normalizeGeoJSON(collection);
    expect(n.features).toHaveLength(5);
    expect(n.points.map((p) => p.feature)).toEqual([0, 3, 3]);
    expect(n.points[0].lngLat).toEqual({ lng: 11.38, lat: 47.31 });
    expect(n.lines.map((l) => [l.feature, l.outline, l.coords.length])).toEqual([[1, false, 2], [2, true, 5], [3, false, 2]]);
    expect(n.polygons).toHaveLength(1);
    expect(n.polygons[0].rings[0]).toHaveLength(5);
    expect(overlayBounds(n)).toEqual({ west: 0, south: 0, east: 11.4, north: 47.31 });
  });

  it('accepts a bare geometry or feature, closes open rings, warns about bad positions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(featuresOf({ type: 'Point', coordinates: [1, 2] })).toHaveLength(1);
    const open = normalizeGeoJSON({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] });
    expect(open.lines[0].coords).toHaveLength(4);
    const bad = normalizeGeoJSON({ type: 'LineString', coordinates: [[0, 0], [NaN, 1], [2, 95], [3, 3]] });
    expect(bad.lines[0].coords).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(normalizeGeoJSON(null).features).toEqual([]);
  });
});

describe('resolveStyle', () => {
  const feature = collection.features[0];

  it('fills in defaults from one color', () => {
    const s = resolveStyle({ color: '#0000ff' }, feature);
    expect(s.lineColor).toEqual([0, 0, 1]);
    expect(s.pointColor).toEqual([0, 0, 1]);
    expect(s.fillColor).toEqual([0, 0, 1]);
    expect([s.lineWidth, s.fillOpacity, s.pointRadius, s.pointStrokeWidth]).toEqual([2.5, 0.3, 5, 1.5]);
    expect(s.pointStroke).toEqual([1, 1, 1]);
    expect(s.label).toBeNull();
  });

  it('takes labels from a property or a function, and styles from a function of the feature', () => {
    expect(resolveStyle({ label: 'name' }, feature).label).toBe('Summit');
    expect(resolveStyle({ label: (p) => `${p.ele} m` }, feature).label).toBe('2334 m');
    expect(resolveStyle({ label: 'missing' }, feature).label).toBeNull();
    const fn = resolveStyle((f) => ({ lineWidth: f.properties?.name === 'Summit' ? 6 : 1, fillColor: null }), feature);
    expect(fn.lineWidth).toBe(6);
    expect(fn.fillColor).toBeNull();
  });

  it('parses CSS colors and clamps numbers; unknown colors fall back with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseColor('rgb(255, 0, 0)', [0, 0, 0])).toEqual([1, 0, 0]);
    expect(parseColor('teal', [0, 0, 0])[2]).toBeCloseTo(128 / 255, 3);
    expect(parseColor([0.1, 0.2, 0.3], [0, 0, 0])).toEqual([0.1, 0.2, 0.3]);
    expect(parseColor('not-a-color-xyz', [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]);
    expect(warn).toHaveBeenCalled();
    expect(resolveStyle({ opacity: 3, lineWidth: -1 }, feature)).toMatchObject({ lineOpacity: 1, lineWidth: 0.5 });
    expect(cssOf([1, 0.5, 0])).toBe('rgb(255, 128, 0)');
  });
});

describe('rasterizePolygons', () => {
  it('fills pixel centers inside, leaves holes empty and paints later polygons over earlier', () => {
    const square: Array<[number, number]> = [[1, 1], [7, 1], [7, 7], [1, 7]];
    const hole: Array<[number, number]> = [[3, 3], [5, 3], [5, 5], [3, 5]];
    const img = rasterizePolygons([{ rings: [square, hole], color: [255, 0, 0, 255] }], 8, 8);
    const px = (i: number, j: number) => [...img.slice((j * 8 + i) * 4, (j * 8 + i) * 4 + 4)];
    expect(px(1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(6, 6)).toEqual([255, 0, 0, 255]);
    expect(px(0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(7, 7)).toEqual([0, 0, 0, 0]);
    expect(px(3, 3)).toEqual([0, 0, 0, 0]); // hole
    let filled = 0;
    for (let i = 3; i < img.length; i += 4) if (img[i]) filled++;
    expect(filled).toBe(36 - 4);
    // Half-transparent blue over the red
    rasterizePolygons([{ rings: [[[0, 0], [8, 0], [8, 2], [0, 2]]], color: [0, 0, 255, 128] }], 8, 8, img);
    const mixed = px(2, 1);
    expect(mixed[3]).toBe(255);
    expect(mixed[0]).toBeGreaterThan(100);
    expect(mixed[2]).toBeGreaterThan(100);
    expect(px(0, 0)).toEqual([0, 0, 255, 128]);
  });

  it('handles triangles and shapes that leave the image', () => {
    const img = rasterizePolygons([{ rings: [[[-4, -4], [12, -4], [4, 12]]], color: [1, 2, 3, 255] }], 8, 8);
    expect(img[3]).toBe(255); // corner covered
    expect(img[(7 * 8 + 7) * 4 + 3]).toBe(0); // bottom-right outside the triangle
  });
});

describe('densify', () => {
  it('splits long segments and keeps the vertices', () => {
    const d = densify([[0, 0], [10, 0], [10, 3]], 4);
    expect(Array.from(d)).toEqual([0, 0, 10 / 3, 0, 20 / 3, 0, 10, 0, 10, 3]);
    expect(densify([], 1)).toHaveLength(0);
  });
});
