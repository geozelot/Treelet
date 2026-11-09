// ============================================================================
// treelet.js - Tools
//
// Interactive measuring on the terrain:
//   distance  a path: length on the map and along the terrain, ascent,
//             descent, lowest and highest point
//   area      a polygon: geodesic and surface area, perimeter
//   profile   a path whose elevation profile opens in the profile panel
//   sight     observer, then target: can one see the other?
//
// Click (tap) to add a point, drag a point to move it, double-click, Enter
// or a long press to finish, Backspace to remove the last point, Escape to
// stop. The geometry is drawn with internal overlays; results are reported
// on every change (live) and once more when the tool finishes.
// ============================================================================

import type { LngLat, TerrainPick, LineOfSightResult } from '../core/types';
import type { Feature, GeoJSON, OverlayStyle, OverlayStyleSpec } from '../overlays/types';
import type { PathMeasure, AreaMeasure } from './measure';
import { formatArea, formatDistance } from './format';

export type ToolMode = 'distance' | 'area' | 'profile' | 'sight';

export type ToolResult =
  | { mode: 'distance' | 'profile'; points: LngLat[]; path: PathMeasure }
  | { mode: 'area'; points: LngLat[]; area: AreaMeasure }
  | { mode: 'sight'; points: LngLat[]; sight: LineOfSightResult | null };

export interface ToolDeps {
  /** Element pointer input is read from (the map's canvas). */
  canvas: HTMLElement;
  container: HTMLElement;
  pick: (x: number, y: number) => TerrainPick | null;
  project: (lngLat: LngLat) => { x: number; y: number } | null;
  setOverlay: (id: string, data: GeoJSON | null, style: OverlayStyleSpec) => void;
  setControlsEnabled: (enabled: boolean) => void;
  measureDistance: (points: LngLat[]) => PathMeasure;
  measureArea: (ring: LngLat[], cells: number) => AreaMeasure;
  lineOfSight: (from: LngLat, to: LngLat) => LineOfSightResult | null;
  /** A result changed (live) or the tool finished (`final`). */
  report: (result: ToolResult | null, final: boolean) => void;
  /** The tool started, stopped or its state changed (UI refresh). */
  changed: () => void;
}

/** A press shorter than this and moving less than CLICK_SLOP is a click. */
const CLICK_MS = 600;
const CLICK_SLOP = 6;
/** A touch held this long without moving finishes the tool. */
const LONG_PRESS_MS = 650;
/** Points within this many pixels can be dragged. */
const HIT_RADIUS = 11;

const TOOL_COLOR = '#1c7ed6';
const VISIBLE_COLOR = '#2f9e44';
const BLOCKED_COLOR = '#e03131';

const LAYER = '__tool__';
const PREVIEW = '__tool_preview__';

export const TOOL_HINTS: Record<ToolMode, string> = {
  distance: 'Click to add points · double-click or Enter to finish',
  area: 'Click the corners · double-click or Enter to finish',
  profile: 'Click to add points · double-click or Enter to finish',
  sight: 'Click the observer, then the target',
};

function feature(geometry: GeoJSON, properties: Record<string, unknown> = {}) {
  return { type: 'Feature' as const, geometry: geometry as never, properties };
}

export class ToolController {
  mode: ToolMode | null = null;
  points: LngLat[] = [];
  finished = false;
  result: ToolResult | null = null;
  private hover: LngLat | null = null;
  private press: { x: number; y: number; id: number; time: number; type: string } | null = null;
  private drag: { index: number; id: number } | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private pendingMove: { x: number; y: number } | null = null;
  private cursor = '';
  private listening = false;

  constructor(private readonly deps: ToolDeps) {}

  get active(): boolean {
    return this.mode !== null && !this.finished;
  }

  /** Start a tool (replacing the current one and its geometry). */
  start(mode: ToolMode): void {
    this.clear();
    this.mode = mode;
    this.finished = false;
    this.listen(true);
    this.cursor = this.deps.container.style.cursor;
    this.deps.container.style.cursor = 'crosshair';
    this.deps.changed();
  }

  /** Finish drawing: the geometry and result stay until clear() or the next tool. */
  finish(): void {
    if (!this.mode || this.finished) return;
    const min = this.mode === 'area' ? 3 : 2;
    if (this.points.length < min) {
      this.clear();
      return;
    }
    this.finished = true;
    this.hover = null;
    this.endInput();
    this.update(true);
    this.deps.changed();
  }

  /** Stop the tool and remove its geometry. */
  clear(): void {
    const had = this.mode !== null;
    this.endInput();
    this.mode = null;
    this.points = [];
    this.finished = false;
    this.result = null;
    this.hover = null;
    this.deps.setOverlay(LAYER, null, {});
    this.deps.setOverlay(PREVIEW, null, {});
    if (had) {
      this.deps.report(null, true);
      this.deps.changed();
    }
  }

  /** Remove the last point. */
  removeLast(): void {
    if (!this.active || this.points.length === 0) return;
    this.points.pop();
    this.update(false);
  }

  dispose(): void {
    this.clear();
    this.listen(false);
  }

  // =========================================================================
  // Input
  // =========================================================================

  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    const c = this.deps.canvas;
    const m = on ? 'addEventListener' : 'removeEventListener';
    // Capture: decide about a drag before the camera controls see the press
    c[m]('pointerdown', this.onDown as EventListener, true);
    c[m]('pointermove', this.onMove as EventListener);
    c[m]('pointerup', this.onUp as EventListener);
    c[m]('pointercancel', this.onCancel as EventListener);
    c[m]('pointerleave', this.onLeave as EventListener);
    c[m]('dblclick', this.onDblClick as EventListener);
    document[m]('keydown', this.onKey as EventListener, true);
  }

  private endInput(): void {
    if (this.longPress !== null) clearTimeout(this.longPress);
    this.longPress = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.drag) this.deps.setControlsEnabled(true);
    this.drag = null;
    this.press = null;
    this.listen(false);
    if (this.deps.container.style.cursor === 'crosshair') this.deps.container.style.cursor = this.cursor;
  }

  private local(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.deps.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hit(x: number, y: number): number {
    for (let i = this.points.length - 1; i >= 0; i--) {
      const s = this.deps.project(this.points[i]);
      if (s && Math.hypot(s.x - x, s.y - y) <= HIT_RADIUS) return i;
    }
    return -1;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = this.local(e);
    this.press = { ...p, id: e.pointerId, time: performance.now(), type: e.pointerType };
    const index = this.hit(p.x, p.y);
    if (index >= 0) {
      // Drag the point instead of the map
      this.drag = { index, id: e.pointerId };
      this.deps.setControlsEnabled(false);
      try { this.deps.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      e.preventDefault();
      return;
    }
    if (e.pointerType !== 'mouse') {
      if (this.longPress !== null) clearTimeout(this.longPress);
      this.longPress = setTimeout(() => {
        this.longPress = null;
        this.press = null;
        this.finish();
      }, LONG_PRESS_MS);
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.active) return;
    const p = this.local(e);
    if (this.press && this.press.id === e.pointerId && Math.hypot(p.x - this.press.x, p.y - this.press.y) > CLICK_SLOP) {
      if (this.longPress !== null) { clearTimeout(this.longPress); this.longPress = null; }
    }
    if (!this.drag && e.pointerType !== 'mouse') return;
    if (!this.drag && this.press) return; // the map is being panned
    this.pendingMove = p;
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        const m = this.pendingMove;
        this.pendingMove = null;
        if (!m || !this.active) return;
        const pick = this.deps.pick(m.x, m.y);
        if (this.drag) {
          if (pick) {
            this.points[this.drag.index] = pick.lngLat;
            this.update(false);
          }
        } else {
          this.hover = pick?.lngLat ?? null;
          this.draw();
          this.computeLive();
        }
      });
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.longPress !== null) { clearTimeout(this.longPress); this.longPress = null; }
    if (this.drag && this.drag.id === e.pointerId) {
      this.drag = null;
      this.deps.setControlsEnabled(true);
      this.press = null;
      this.update(false);
      return;
    }
    const press = this.press;
    this.press = null;
    if (!this.active || !press || press.id !== e.pointerId) return;
    const p = this.local(e);
    if (Math.hypot(p.x - press.x, p.y - press.y) > CLICK_SLOP || performance.now() - press.time > CLICK_MS) return;
    const pick = this.deps.pick(p.x, p.y);
    if (!pick) return;
    // The second click of a double-click lands on the first: ignore it
    const last = this.points[this.points.length - 1];
    if (last) {
      const s = this.deps.project(last);
      if (s && Math.hypot(s.x - p.x, s.y - p.y) < 4) return;
    }
    this.points.push(pick.lngLat);
    if (this.mode === 'sight' && this.points.length >= 2) {
      this.finish();
      return;
    }
    this.update(false);
  };

  private onCancel = (): void => {
    if (this.longPress !== null) { clearTimeout(this.longPress); this.longPress = null; }
    if (this.drag) this.deps.setControlsEnabled(true);
    this.drag = null;
    this.press = null;
  };

  private onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && this.hover) {
      this.hover = null;
      this.draw();
      this.computeLive();
    }
  };

  private onDblClick = (e: MouseEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    this.finish();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.clear();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.finish();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      this.removeLast();
    }
  };

  // =========================================================================
  // Results and drawing
  // =========================================================================

  private update(final: boolean): void {
    this.compute(final);
    this.draw();
    this.deps.changed();
  }

  /** Result including the point under the pointer (live, while drawing). */
  private computeLive(): void {
    if (!this.hover || this.finished) {
      this.compute(false);
      return;
    }
    this.compute(false, [...this.points, this.hover]);
  }

  private compute(final: boolean, points = this.points): void {
    const mode = this.mode;
    if (!mode) return;
    let result: ToolResult | null = null;
    if ((mode === 'distance' || mode === 'profile') && points.length >= 2) {
      result = { mode, points: [...points], path: this.deps.measureDistance(points) };
    } else if (mode === 'area' && points.length >= 3) {
      result = { mode, points: [...points], area: this.deps.measureArea(points, final ? 256 : 64) };
    } else if (mode === 'sight' && points.length >= 2) {
      result = { mode, points: [...points], sight: this.deps.lineOfSight(points[0], points[1]) };
    }
    this.result = result;
    this.deps.report(result, final);
  }

  private draw(): void {
    const pts = this.points;
    const coords = pts.map((p) => [p.lng, p.lat]);
    const features: ReturnType<typeof feature>[] = [];
    const style: OverlayStyle = {
      color: TOOL_COLOR, lineWidth: 3, pointRadius: 4.5, pointStrokeWidth: 2, fillColor: null,
      label: 'label', labelColor: '#0b3d6e',
    };

    if (this.mode === 'sight' && this.result?.mode === 'sight' && this.result.sight) {
      const s = this.result.sight;
      const block = s.obstruction;
      if (block) {
        features.push(feature({ type: 'LineString', coordinates: [coords[0], [block.lngLat.lng, block.lngLat.lat]] }, { c: VISIBLE_COLOR }));
        features.push(feature({ type: 'LineString', coordinates: [[block.lngLat.lng, block.lngLat.lat], coords[1]] }, { c: BLOCKED_COLOR }));
        features.push(feature({ type: 'Point', coordinates: [block.lngLat.lng, block.lngLat.lat] }, { c: BLOCKED_COLOR, r: 3.5 }));
      } else {
        features.push(feature({ type: 'LineString', coordinates: coords }, { c: VISIBLE_COLOR }));
      }
      features.push(feature({ type: 'Point', coordinates: coords[0] }, { label: 'Observer' }));
      features.push(feature({ type: 'Point', coordinates: coords[1] }, { label: s.visible ? 'Visible' : 'Hidden', c: s.visible ? VISIBLE_COLOR : BLOCKED_COLOR }));
      // Colors and sizes per feature
      this.deps.setOverlay(LAYER, { type: 'FeatureCollection', features }, (f: Feature): OverlayStyle => {
        const prop = f.properties ?? {};
        return { ...style, color: (prop.c as string | undefined) ?? TOOL_COLOR, pointRadius: (prop.r as number | undefined) ?? style.pointRadius };
      });
      this.deps.setOverlay(PREVIEW, null, {});
      return;
    }

    const ring = this.mode === 'area' && pts.length >= 3;
    if (pts.length >= 2) {
      features.push(feature({ type: 'LineString', coordinates: ring ? [...coords, coords[0]] : coords }));
    }
    const endLabel = this.labelForEnd();
    pts.forEach((_, i) => {
      features.push(feature({ type: 'Point', coordinates: coords[i] }, i === pts.length - 1 && endLabel ? { label: endLabel } : {}));
    });
    this.deps.setOverlay(LAYER, { type: 'FeatureCollection', features }, style);

    // Rubber band to the pointer
    if (this.hover && !this.finished && pts.length > 0) {
      const h = [this.hover.lng, this.hover.lat];
      const band = this.mode === 'area' && pts.length >= 2 ? [coords[pts.length - 1], h, coords[0]] : [coords[pts.length - 1], h];
      this.deps.setOverlay(PREVIEW, { type: 'LineString', coordinates: band }, { color: TOOL_COLOR, lineWidth: 2, opacity: 0.55, fillColor: null });
    } else {
      this.deps.setOverlay(PREVIEW, null, {});
    }
  }

  private labelForEnd(): string | null {
    const r = this.result;
    if (!r || this.hover) return null;
    if (r.mode === 'distance' || r.mode === 'profile') return formatDistance(r.path.distance);
    if (r.mode === 'area') return formatArea(r.area.area);
    return null;
  }
}
