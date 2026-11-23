// ============================================================================
// Tests for the profile panel's drawing (src/ui/TreeletProfile.ts) and the
// chart's decimation (src/ui/profileChart.ts): long profiles are drawn once,
// decimated to the pixel columns with their peaks; hovering moves a marker
// once per frame; the exports keep every sample.
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { TreeletProfile } from '../../src/ui/TreeletProfile';
import { chartScales, chartSvg, decimateProfile, CSS_PALETTE, type ProfilePoint } from '../../src/ui/profileChart';

beforeAll(() => {
  if (!customElements.get('treelet-profile')) customElements.define('treelet-profile', TreeletProfile);
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const N = 20000;
const SPIKE = 12345;
/** A long profile: rolling terrain, one narrow spike and a gap without data. */
function longProfile(): ProfilePoint[] {
  return Array.from({ length: N }, (_, i) => ({
    distance: i * 2,
    elevation: i === SPIKE ? 5000 : i >= 15000 && i < 15100 ? null : 1000 + 400 * Math.sin(i / 700),
    lngLat: { lng: 11 + i * 1e-5, lat: 47 },
  }));
}

/** Animation frames run by hand. */
function frames() {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.set(next, cb); return next++; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  return { flush() { const cbs = [...queue.values()]; queue.clear(); for (const cb of cbs) cb(0); } };
}

/** Vertices of an SVG path's `d`. */
const vertices = (d: string) => d.split(/[MLZ]/).filter((v) => v.includes(','));
const linePath = (svg: string) => [...svg.matchAll(/<path d="([^"]*)" fill="none"/g)][0][1];

function mount(points: ProfilePoint[], extra: Partial<{ obstructionIndex: number }> = {}) {
  const onHover = vi.fn();
  const el = document.createElement('treelet-profile') as TreeletProfile;
  document.body.appendChild(el);
  el.attach({ onHover });
  el.show({ title: 'Elevation profile', points, stats: [], ...extra });
  return { el, root: el.shadowRoot!, onHover };
}

describe('decimateProfile', () => {
  it('keeps the lowest and highest sample of every pixel column, the ends and the gaps', () => {
    const points = longProfile();
    const s = chartScales(points, 600, 150);
    const columns = Math.ceil(s.x(s.dMax) - s.x(0));
    const d = decimateProfile(points, s);
    expect(d.length).toBeLessThanOrEqual(2 * columns + 4);
    expect(d[0]).toBe(points[0]);
    expect(d.at(-1)).toBe(points[N - 1]);
    expect(d).toContain(points[SPIKE]);
    // In order along the path, the gap kept once
    for (let i = 1; i < d.length; i++) expect(d[i].distance).toBeGreaterThan(d[i - 1].distance);
    expect(d.filter((p) => p.elevation === null)).toHaveLength(1);
    // Every column's range is kept
    const range = (ps: readonly ProfilePoint[], c: number) => {
      const e = ps.filter((p) => p.elevation !== null && Math.floor(s.x(p.distance)) === c).map((p) => p.elevation!);
      return e.length ? [Math.min(...e), Math.max(...e)] : null;
    };
    for (let c = Math.floor(s.x(0)); c < s.x(s.dMax); c += 37) expect(range(d, c)).toEqual(range(points, c));
    // Short profiles stay as they are
    const short = points.slice(0, 500);
    expect(decimateProfile(short, chartScales(short, 600, 150))).toBe(short);
  });

  it('the decimated chart has the same outline, peaks included', () => {
    const points = longProfile();
    const full = chartSvg(points, 600, 150, CSS_PALETTE);
    const drawn = chartSvg(points, 600, 150, CSS_PALETTE, { decimate: true });
    const top = (svg: string) => Math.min(...vertices(linePath(svg)).map((v) => Number(v.split(',')[1])));
    expect(vertices(linePath(full)).length).toBe(N - 100);
    expect(vertices(linePath(drawn)).length).toBeLessThan(1300);
    expect(top(drawn)).toBe(top(full));
    expect((drawn.match(/<path d="M/g) ?? []).length).toBe(2); // area and line, each in two runs around the gap
    expect(linePath(drawn).match(/M/g)).toHaveLength(2);
  });
});

describe('<treelet-profile> drawing', () => {
  it('draws the chart once; hovering moves the marker and the tooltip once per frame', () => {
    const f = frames();
    const points = longProfile();
    const { root, onHover } = mount(points);
    const svg = root.querySelector('.chart svg')!;
    const line = svg.querySelector('path[fill="none"]')!;
    expect(vertices(line.getAttribute('d')!).length).toBeLessThan(1300);
    const marker = svg.querySelector('g.hover')!;
    expect(marker.getAttribute('display')).toBe('none');
    const chart = root.querySelector('.chart') as HTMLElement;
    for (const x of [100, 200, 300, 346]) chart.dispatchEvent(new PointerEvent('pointermove', { clientX: x, bubbles: true }));
    expect(onHover).not.toHaveBeenCalled();
    f.flush();
    expect(onHover).toHaveBeenCalledTimes(1);
    const p = onHover.mock.calls[0][0] as ProfilePoint;
    const s = chartScales(points, 600, 150); // the panel's width falls back to 600 here
    expect(Math.abs(s.x(p.distance) - 346)).toBeLessThan(0.1);
    // Not drawn again: the same chart, the marker moved
    expect(root.querySelector('.chart svg')).toBe(svg);
    expect(svg.querySelector('path[fill="none"]')).toBe(line);
    expect(marker.getAttribute('display')).toBe('inline');
    expect(Number(marker.querySelector('line')!.getAttribute('x1'))).toBeCloseTo(s.x(p.distance), 1);
    expect(Number(marker.querySelector('circle')!.getAttribute('cy'))).toBeCloseTo(s.y(p.elevation!), 1);
    const tip = root.querySelector('.tip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toMatch(/km · /);
    expect(parseFloat(tip.style.left)).toBeCloseTo(s.x(p.distance), 1);
    expect(tip.style.transform).toMatch(/^translateX\(-\d+(\.\d)?%\)$/);
    // Leaving hides them; a move still waiting for its frame does not come back
    chart.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, bubbles: true }));
    chart.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    f.flush();
    expect(onHover).toHaveBeenCalledTimes(2);
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(marker.getAttribute('display')).toBe('none');
    expect(tip.hidden).toBe(true);
  });

  it('a sample without data shows the line without the dot', () => {
    const f = frames();
    const points = longProfile();
    const { root, onHover } = mount(points);
    const s = chartScales(points, 600, 150);
    const chart = root.querySelector('.chart') as HTMLElement;
    chart.dispatchEvent(new PointerEvent('pointermove', { clientX: s.x(points[15050].distance), bubbles: true }));
    f.flush();
    expect((onHover.mock.calls[0][0] as ProfilePoint).elevation).toBeNull();
    const marker = root.querySelector('g.hover')!;
    expect(marker.getAttribute('display')).toBe('inline');
    expect(marker.querySelector('circle')!.getAttribute('display')).toBe('none');
  });

  it('showing another profile clears the hovered sample', () => {
    const f = frames();
    const { el, root, onHover } = mount(longProfile());
    (root.querySelector('.chart') as HTMLElement).dispatchEvent(new PointerEvent('pointermove', { clientX: 300, bubbles: true }));
    f.flush();
    el.show({ title: 'Other', points: longProfile().slice(0, 100), stats: [] });
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(root.querySelector('g.hover')!.getAttribute('display')).toBe('none');
  });

  it('CSV and PNG exports use every sample', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: (b: Blob) => { blobs.push(b); return `blob:test/${blobs.length}`; },
      revokeObjectURL: () => {},
    }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const points = longProfile();
    const { root } = mount(points, { obstructionIndex: -1 });
    (root.querySelector('[data-action="csv"]') as HTMLElement).click();
    expect((await blobs[0].text()).split('\n')).toHaveLength(N + 2); // header, rows, final newline
    (root.querySelector('[data-action="png"]') as HTMLElement).click();
    const svg = await blobs[1].text();
    expect(blobs[1].type).toBe('image/svg+xml');
    expect(vertices(linePath(svg)).length).toBe(N - 100);
  });
});
