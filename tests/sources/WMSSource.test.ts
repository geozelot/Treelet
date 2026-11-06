// ============================================================================
// Tests for plugins/source/wms/WMSSource.ts
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { WMSSource } from '../../plugins/source/wms/WMSSource';
import { XYZSource } from '../../src/sources/XYZSource';

describe('WMSSource', () => {
  it('URL-encodes query values and uses SRS for WMS 1.1.1', () => {
    const src = new WMSSource({ url: 'https://example.com/wms', layers: 'dem,hill shade', format: 'image/png' });
    const url = src.getTileUrl({ z: 0, x: 0, y: 0 });
    expect(url).toContain('VERSION=1.1.1');
    expect(url).toContain('LAYERS=dem%2Chill%20shade');
    expect(url).toContain('SRS=EPSG%3A3857');
    expect(url).toContain('FORMAT=image%2Fpng');
  });

  it('uses CRS and lat/lon axis order for WMS 1.3.0 + EPSG:4326', () => {
    const src = new WMSSource({ url: 'https://example.com/wms', layers: 'dem', crs: 'EPSG:4326', version: '1.3.0' });
    const url = src.getTileUrl({ z: 1, x: 1, y: 0 }); // north-east quadrant
    expect(url).toContain('CRS=EPSG%3A4326');
    const bbox = url.split('BBOX=')[1].split(',').map(Number);
    // minLat, minLon, maxLat, maxLon
    expect(bbox[0]).toBeCloseTo(0, 6);
    expect(bbox[1]).toBeCloseTo(0, 6);
    expect(bbox[2]).toBeGreaterThan(85);
    expect(bbox[3]).toBeCloseTo(180, 6);
  });

  it('warns once for an unsupported CRS (not per tile)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = new WMSSource({ url: 'https://example.com/wms', layers: 'dem', crs: 'EPSG:2056' });
    src.getTileUrl({ z: 1, x: 0, y: 0 });
    src.getTileUrl({ z: 1, x: 1, y: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('access tokens and request options', () => {
  it('appends access_token when the template has no placeholder', () => {
    const src = new XYZSource({ url: 'https://t/{z}/{x}/{y}.png', accessToken: 'secret' });
    expect(src.getTileUrl({ z: 1, x: 0, y: 1 })).toBe('https://t/1/0/1.png?access_token=secret');
  });

  it('substitutes {accessToken} instead of appending', () => {
    const src = new XYZSource({ url: 'https://t/{z}/{x}/{y}.png?key={accessToken}', accessToken: 'secret' });
    expect(src.getTileUrl({ z: 1, x: 0, y: 1 })).toBe('https://t/1/0/1.png?key=secret');
  });

  it('exposes headers and credentials for worker fetches', () => {
    const src = new XYZSource({ url: 'https://t/{z}/{x}/{y}.png', headers: { Authorization: 'Bearer x' }, credentials: 'include' });
    expect(src.getRequestInit()).toEqual({ headers: { Authorization: 'Bearer x' }, credentials: 'include', referrerPolicy: undefined });
    expect(new XYZSource({ url: 'https://t/{z}/{x}/{y}.png' }).getRequestInit()).toBeUndefined();
  });
});
