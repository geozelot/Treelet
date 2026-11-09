// ============================================================================
// treelet.js - Polygon rasterization
//
// Fills polygons into an RGBA image (scanline, even-odd rule per polygon, so
// holes stay empty), painting later polygons over earlier ones. Pixel
// centers decide coverage. Pure, so it runs without a canvas.
// ============================================================================

/** A polygon in pixel coordinates (x right, y down) with its RGBA color (0–255). */
export interface RasterPolygon {
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  color: readonly [number, number, number, number];
}

/** Paint `polygons` into `width × height` RGBA (source-over). */
export function rasterizePolygons(
  polygons: readonly RasterPolygon[], width: number, height: number, out = new Uint8Array(width * height * 4),
): Uint8Array {
  const xs: number[] = [];
  for (const poly of polygons) {
    const [r, g, b, a8] = poly.color;
    const a = a8 / 255;
    if (a <= 0) continue;
    // Rows the polygon touches
    let yMin = Infinity, yMax = -Infinity;
    for (const ring of poly.rings) for (const [, y] of ring) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
    const j0 = Math.max(0, Math.floor(yMin - 0.5));
    const j1 = Math.min(height - 1, Math.ceil(yMax - 0.5));
    for (let j = j0; j <= j1; j++) {
      const y = j + 0.5;
      xs.length = 0;
      for (const ring of poly.rings) {
        for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
          const [xi, yi] = ring[i];
          const [xk, yk] = ring[k];
          if ((yi > y) !== (yk > y)) xs.push(xi + ((y - yi) * (xk - xi)) / (yk - yi));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        // Pixels whose centers lie in [xs[s], xs[s+1])
        const i0 = Math.max(0, Math.ceil(xs[s] - 0.5));
        const i1 = Math.min(width - 1, Math.ceil(xs[s + 1] - 0.5) - 1);
        for (let i = i0; i <= i1; i++) {
          const o = (j * width + i) * 4;
          const da = out[o + 3] / 255;
          const oa = a + da * (1 - a);
          if (oa <= 0) continue;
          out[o] = Math.round((r * a + out[o] * da * (1 - a)) / oa);
          out[o + 1] = Math.round((g * a + out[o + 1] * da * (1 - a)) / oa);
          out[o + 2] = Math.round((b * a + out[o + 2] * da * (1 - a)) / oa);
          out[o + 3] = Math.round(oa * 255);
        }
      }
    }
  }
  return out;
}

/**
 * Points along a polyline in world units, no further apart than `maxStep`
 * (the original vertices kept). Returns flat [x0, y0, x1, y1, …].
 */
export function densify(points: ReadonlyArray<readonly [number, number]>, maxStep: number): Float64Array {
  if (points.length === 0) return new Float64Array(0);
  const out: number[] = [points[0][0], points[0][1]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const n = maxStep > 0 ? Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxStep)) : 1;
    for (let k = 1; k <= n; k++) out.push(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
  }
  return Float64Array.from(out);
}
