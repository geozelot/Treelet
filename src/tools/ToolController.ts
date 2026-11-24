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
//
// Live results stay cheap: the committed points are measured once when they
// change; while the pointer moves only the part that moves is measured and
// joined to them, and the committed geometry is not drawn again.
// ============================================================================

import type { LngLat, TerrainPick, LineOfSightResult } from '../core/types';
import type { Feature, GeoJSON, OverlayStyle, OverlayStyleSpec } from '../overlays/types';
import { geodesicAreaOf, joinPathMeasures, type PathMeasure, type AreaMeasure } from './measure';
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
/** A touch held this long without moving (and without a second finger) finishes the tool. */
const LONG_PRESS_MS = 650;
/** Points within this many pixels can be dragged. */
const HIT_RADIUS = 11;
/** Surface-area grid cells: while drawing, and for the final result. */
const LIVE_AREA_CELLS = 64;
const FINAL_AREA_CELLS = 256;
/**
 * While the pointer moves a polygon's corner, its surface area is estimated
 * from the last exact one and measured again at most this often (ms).
 */
const AREA_REFINE_MS = 150;

const TOOL_COLOR = '#1c7ed6';
const VISIBLE_COLOR = '#2f9e44';
const BLOCKED_COLOR = '#e03131';

const LAYER = '__tool__';
const PREVIEW = '__tool_preview__';

const BASE_STYLE: OverlayStyle = {
  color: TOOL_COLOR, lineWidth: 3, pointRadius: 4.5, pointStrokeWidth: 2, fillColor: null,
  label: 'label', labelColor: '#0b3d6e',
};
const BAND_STYLE: OverlayStyle = { color: TOOL_COLOR, lineWidth: 2, opacity: 0.55, fillColor: null };
/** Line of sight: colors and sizes per feature. */
const SIGHT_STYLE = (f: Feature): OverlayStyle => {
  const prop = f.properties ?? {};
  return { ...BASE_STYLE, color: (prop.c as string | undefined) ?? TOOL_COLOR, pointRadius: (prop.r as number | undefined) ?? BASE_STYLE.pointRadius };
};

export const TOOL_HINTS: Record<ToolMode, string> = {
  distance: 'Click to add points · double-click or Enter to finish',
  area: 'Click the corners · double-click or Enter to finish',
  profile: 'Click to add points · double-click or Enter to finish',
  sight: 'Click the observer, then the target',
};

/** Controls that own Enter, Backspace and Escape while focused (the tool keys are theirs). */
const CONTROL_SELECTOR = 'input, textarea, select, button, option, summary, a[href], area[href], audio[controls], video[controls], [contenteditable]:not([contenteditable="false"])';
const CONTROL_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'grid', 'gridcell', 'link', 'listbox', 'menu', 'menubar', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'radiogroup', 'scrollbar', 'searchbox',
  'slider', 'spinbutton', 'switch', 'tab', 'tablist', 'textbox', 'tree', 'treegrid', 'treeitem',
]);

/** Whether a key event's (innermost) target is an interactive control. */
function isControl(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null | undefined;
  if (!el || typeof el.matches !== 'function') return false;
  if (el.isContentEditable || el.matches(CONTROL_SELECTOR)) return true;
  const role = el.getAttribute('role');
  return !!role && role.trim().split(/\s+/).some((r) => CONTROL_ROLES.has(r.toLowerCase()));
}

type Coord = [number, number];
const coord = (p: LngLat): Coord => [p.lng, p.lat];
const sameLngLat = (a: LngLat | null, b: LngLat | null): boolean =>
  a === b || (!!a && !!b && a.lng === b.lng && a.lat === b.lat);

function feature(geometry: GeoJSON, properties: Record<string, unknown> = {}) {
  return { type: 'Feature' as const, geometry: geometry as never, properties };
}

/** Features of a line of sight: the sight line (split at an obstruction) and the target, with the observer optionally. */
function sightFeatures(points: readonly LngLat[], s: LineOfSightResult, observer: boolean) {
  const [from, to] = [coord(points[0]), coord(points[1])];
  const features: ReturnType<typeof feature>[] = [];
  const block = s.obstruction;
  if (block) {
    const b = coord(block.lngLat);
    features.push(feature({ type: 'LineString', coordinates: [from, b] }, { c: VISIBLE_COLOR }));
    features.push(feature({ type: 'LineString', coordinates: [b, to] }, { c: BLOCKED_COLOR }));
    features.push(feature({ type: 'Point', coordinates: b }, { c: BLOCKED_COLOR, r: 3.5 }));
  } else {
    features.push(feature({ type: 'LineString', coordinates: [from, to] }, { c: VISIBLE_COLOR }));
  }
  if (observer) features.push(feature({ type: 'Point', coordinates: from }, { label: 'Observer' }));
  features.push(feature({ type: 'Point', coordinates: to }, { label: s.visible ? 'Visible' : 'Hidden', c: s.visible ? VISIBLE_COLOR : BLOCKED_COLOR }));
  return { type: 'FeatureCollection' as const, features };
}

interface Drag {
  index: number;
  id: number;
  /** Whether the point was moved (the committed measure must be redone). */
  moved: boolean;
  /** Measures of the path before and after the dragged point (distance tools), made on the first move. */
  parts: { before: PathMeasure | null; after: PathMeasure | null } | null;
}

export class ToolController {
  mode: ToolMode | null = null;
  points: LngLat[] = [];
  finished = false;
  result: ToolResult | null = null;
  private hover: LngLat | null = null;
  /** Result of the committed points alone (measured once per change). */
  private base: ToolResult | null = null;
  /** The last exact area measure: its surface-to-area ratio and elevations stand in while a corner moves. */
  private areaRef: AreaMeasure | null = null;
  /** Whether `result` holds an estimated surface area (refined by `refineTimer`). */
  private estimated = false;
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  private press: { x: number; y: number; id: number; time: number } | null = null;
  private drag: Drag | null = null;
  /** Touch and pen pointers down on the canvas. */
  private readonly touches = new Set<number>();
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private pendingMove: { x: number; y: number; drag: boolean } | null = null;
  /** What each overlay shows (its data serialized), to send only changes. */
  private readonly shown = new Map<string, string>([[LAYER, ''], [PREVIEW, '']]);
  /** Bumped whenever the points change: the committed geometry is rebuilt only then, not per pointer move. */
  private pointsRev = 0;
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
    this.measureCommitted(true);
    this.draw();
    this.deps.report(this.result, true);
    this.deps.changed();
  }

  /** Stop the tool and remove its geometry. */
  clear(): void {
    const had = this.mode !== null;
    this.endInput();
    this.mode = null;
    this.points = [];
    this.pointsRev++;
    this.finished = false;
    this.result = null;
    this.base = null;
    this.areaRef = null;
    this.estimated = false;
    this.hover = null;
    this.sendOverlay(LAYER, null, {}, true);
    this.sendOverlay(PREVIEW, null, {}, true);
    if (had) {
      this.deps.report(null, true);
      this.deps.changed();
    }
  }

  /** Remove the last point. */
  removeLast(): void {
    if (!this.active || this.points.length === 0) return;
    this.cancelDrag(); // the dragged point may be the one removed
    this.points.pop();
    this.pointsRev++;
    this.commit();
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
    this.cancelLongPress();
    this.cancelRefine();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pendingMove = null;
    if (this.drag) this.deps.setControlsEnabled(true);
    this.drag = null;
    this.press = null;
    this.touches.clear();
    this.listen(false);
    if (this.deps.container.style.cursor === 'crosshair') this.deps.container.style.cursor = this.cursor;
  }

  private cancelLongPress(): void {
    if (this.longPress !== null) clearTimeout(this.longPress);
    this.longPress = null;
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
    if (!this.active) return;
    const touch = e.pointerType !== 'mouse';
    if (touch) {
      // The first finger of a gesture: no other touch is down, whatever was missed
      if (e.isPrimary) this.touches.clear();
      this.touches.add(e.pointerId);
      if (this.touches.size > 1) {
        // A second finger pinches or rotates the map: neither a tap nor a long press
        this.cancelLongPress();
        this.press = null;
        return;
      }
    } else if (e.button !== 0) {
      return;
    }
    if (this.drag) return;
    const p = this.local(e);
    this.press = { ...p, id: e.pointerId, time: performance.now() };
    const index = this.hit(p.x, p.y);
    if (index >= 0) {
      // Drag the point instead of the map
      this.startDrag(index, e.pointerId);
      try { this.deps.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      e.preventDefault();
      return;
    }
    if (touch) {
      this.cancelLongPress();
      this.longPress = setTimeout(() => {
        this.longPress = null;
        if (this.touches.size > 1) return;
        this.press = null;
        this.finish();
      }, LONG_PRESS_MS);
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.active) return;
    const p = this.local(e);
    if (this.press && this.press.id === e.pointerId && Math.hypot(p.x - this.press.x, p.y - this.press.y) > CLICK_SLOP) {
      this.cancelLongPress();
    }
    if (this.drag) {
      if (e.pointerId === this.drag.id) this.queueMove(p, true);
      return;
    }
    // Only a mouse hovers; a touch or a pressed mouse moves the map
    if (e.pointerType !== 'mouse' || this.press) return;
    this.queueMove(p, false);
  };

  /** Apply pointer moves once per frame (picking and measuring are not free). */
  private queueMove(p: { x: number; y: number }, drag: boolean): void {
    this.pendingMove = { x: p.x, y: p.y, drag };
    if (this.frame === null) this.frame = requestAnimationFrame(this.flushMove);
  }

  private flushMove = (): void => {
    this.frame = null;
    const m = this.pendingMove;
    this.pendingMove = null;
    if (!m || !this.active) return;
    if (m.drag) {
      if (!this.drag) return;
      const pick = this.deps.pick(m.x, m.y);
      if (pick) this.dragTo(pick.lngLat);
    } else if (!this.drag) {
      this.setHover(this.deps.pick(m.x, m.y)?.lngLat ?? null);
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    this.cancelLongPress();
    if (this.drag && this.drag.id === e.pointerId) {
      this.endDrag(true);
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
    this.pointsRev++;
    if (this.mode === 'sight' && this.points.length >= 2) {
      this.finish();
      return;
    }
    this.commit();
  };

  private onCancel = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    this.cancelLongPress();
    if (this.drag && this.drag.id === e.pointerId) this.endDrag(false);
    else if (this.press?.id === e.pointerId) this.press = null;
  };

  private onLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.drag) return;
    // A move still waiting for its frame must not bring the hover back
    if (this.pendingMove && !this.pendingMove.drag) this.pendingMove = null;
    this.setHover(null);
  };

  private onDblClick = (e: MouseEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    this.finish();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.active || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== 'Backspace') return;
    // At the document the target of a key in a shadow root is its host: look inside
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (isControl(path[0] ?? e.target)) return;
    e.preventDefault();
    if (e.key === 'Escape') this.clear();
    else if (e.key === 'Enter') this.finish();
    else this.removeLast();
  };

  // =========================================================================
  // Dragging
  // =========================================================================

  private startDrag(index: number, id: number): void {
    this.drag = { index, id, moved: false, parts: null };
    this.deps.setControlsEnabled(false);
    this.pendingMove = null; // a hover waiting for its frame is outdated
    this.setHover(null);
  }

  /** Move the dragged point: measure only around it and join the rest. */
  private dragTo(lngLat: LngLat): void {
    const d = this.drag!;
    const { mode, points } = this;
    points[d.index] = lngLat;
    d.moved = true;
    this.estimated = false;
    let result: ToolResult | null = null;
    const n = points.length;
    const i = d.index;
    if ((mode === 'distance' || mode === 'profile') && n >= 2) {
      d.parts ??= {
        before: i >= 2 ? this.deps.measureDistance(points.slice(0, i)) : null,
        after: n - i - 1 >= 2 ? this.deps.measureDistance(points.slice(i + 1)) : null,
      };
      let path = this.deps.measureDistance(points.slice(Math.max(0, i - 1), i + 2));
      if (d.parts.before) path = joinPathMeasures(d.parts.before, path);
      if (d.parts.after) path = joinPathMeasures(path, d.parts.after);
      result = { mode, points: [...points], path };
    } else if (mode === 'area' && n >= 3) {
      const ring = [...points];
      result = { mode, points: ring, area: this.estimateArea(ring) };
    } else if (mode === 'sight' && n >= 2) {
      result = { mode, points: [...points], sight: this.deps.lineOfSight(points[0], points[1]) };
    }
    this.result = result;
    this.draw();
    this.deps.report(result, false);
  }

  /** End a drag: `apply` takes the move still waiting for its frame (the final position). */
  private endDrag(apply: boolean): void {
    const d = this.drag;
    if (!d) return;
    const m = this.pendingMove;
    this.pendingMove = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (apply && m?.drag) {
      const pick = this.deps.pick(m.x, m.y);
      if (pick) {
        this.points[d.index] = pick.lngLat;
        this.pointsRev++;
        d.moved = true;
      }
    }
    this.drag = null;
    this.press = null;
    this.deps.setControlsEnabled(true);
    if (d.moved) this.commit();
  }

  /** Stop dragging without applying anything further. */
  private cancelDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.press = null;
    this.pendingMove = null;
    this.deps.setControlsEnabled(true);
  }

  // =========================================================================
  // Results
  // =========================================================================

  /** The committed points changed: measure them, draw and report. */
  private commit(): void {
    this.measureCommitted(false);
    this.draw();
    this.deps.report(this.result, false);
    this.deps.changed();
  }

  /** Measure the committed points (without the pointer). */
  private measureCommitted(final: boolean): void {
    this.cancelRefine();
    this.estimated = false;
    const mode = this.mode;
    const points = [...this.points];
    let result: ToolResult | null = null;
    if ((mode === 'distance' || mode === 'profile') && points.length >= 2) {
      result = { mode, points, path: this.deps.measureDistance(points) };
    } else if (mode === 'area' && points.length >= 3) {
      const area = this.deps.measureArea(points, final ? FINAL_AREA_CELLS : LIVE_AREA_CELLS);
      this.areaRef = area;
      result = { mode, points, area };
    } else if (mode === 'sight' && points.length >= 2) {
      result = { mode, points, sight: this.deps.lineOfSight(points[0], points[1]) };
    }
    this.base = result;
    this.result = result;
  }

  /** The point under the pointer changed: the live result, then the drawing. */
  private setHover(hover: LngLat | null): void {
    if (!this.active || sameLngLat(hover, this.hover)) return;
    this.hover = hover;
    const before = this.result;
    if (hover && this.points.length > 0) {
      this.result = this.measureLive(hover);
    } else {
      this.cancelRefine();
      this.estimated = false;
      this.result = this.base;
    }
    this.draw();
    if (this.result !== before) this.deps.report(this.result, false);
  }

  /** Result including the point under the pointer: only its segment is measured. */
  private measureLive(hover: LngLat): ToolResult | null {
    const { mode, points } = this;
    const all = [...points, hover];
    this.estimated = false;
    if (mode === 'distance' || mode === 'profile') {
      const segment = this.deps.measureDistance([points[points.length - 1], hover]);
      const base = this.base && this.base.mode === mode ? this.base.path : null;
      return { mode, points: all, path: base ? joinPathMeasures(base, segment) : segment };
    }
    if (mode === 'area') {
      return all.length >= 3 ? { mode, points: all, area: this.estimateArea(all) } : null;
    }
    if (mode === 'sight') {
      return { mode, points: [points[0], hover], sight: this.deps.lineOfSight(points[0], hover) };
    }
    return null;
  }

  /**
   * Area of a changing polygon: the geodesic figures exactly; the surface
   * area scaled from the last exact one and measured again shortly.
   */
  private estimateArea(ring: LngLat[]): AreaMeasure {
    const { area, perimeter } = geodesicAreaOf(ring);
    const ref = this.areaRef;
    const ratio = ref && ref.area > 0 && ref.surfaceArea > 0 ? ref.surfaceArea / ref.area : 1;
    this.estimated = true;
    this.scheduleRefine();
    return {
      area,
      perimeter,
      surfaceArea: area * ratio,
      minElevation: ref?.minElevation ?? null,
      maxElevation: ref?.maxElevation ?? null,
    };
  }

  /** Measure the estimated result exactly, at most every AREA_REFINE_MS (also while moving). */
  private scheduleRefine(): void {
    if (this.refineTimer !== null) return;
    this.refineTimer = setTimeout(() => {
      this.refineTimer = null;
      const r = this.result;
      if (!this.active || !this.estimated || r?.mode !== 'area') return;
      const area = this.deps.measureArea(r.points, LIVE_AREA_CELLS);
      this.areaRef = area;
      this.estimated = false;
      this.result = { mode: 'area', points: r.points, area };
      this.deps.report(this.result, false);
    }, AREA_REFINE_MS);
  }

  private cancelRefine(): void {
    if (this.refineTimer !== null) clearTimeout(this.refineTimer);
    this.refineTimer = null;
  }

  // =========================================================================
  // Drawing
  // =========================================================================

  /** Send an overlay only when what it shows changed (`force`: always). */
  private sendOverlay(id: string, data: GeoJSON | null, style: OverlayStyleSpec, force = false): void {
    const key = data ? `${style === SIGHT_STYLE ? 's' : style === BAND_STYLE ? 'b' : 'p'}${JSON.stringify(data)}` : '';
    if (!force && this.shown.get(id) === key) return;
    this.shown.set(id, key);
    this.deps.setOverlay(id, data, style);
  }

  /**
   * Draw the committed geometry (LAYER) and what follows the pointer
   * (PREVIEW). Each is sent only when it changed: moving the pointer
   * redraws the preview alone.
   */
  private draw(): void {
    const mode = this.mode;
    if (!mode) return;
    const pts = this.points;
    const hover = this.finished ? null : this.hover;
    const r = this.result;
    const sight = r?.mode === 'sight' && r.sight && r.points.length >= 2 ? { points: r.points, s: r.sight } : null;

    if (mode === 'sight' && (sight || !this.finished)) {
      if (this.finished) {
        this.sendOverlay(LAYER, sightFeatures(sight!.points, sight!.s, true), SIGHT_STYLE);
        this.sendOverlay(PREVIEW, null, {});
        return;
      }
      // Drawing: the observer stays; the sight line to the pointer is the preview
      this.sendOverlay(LAYER, pts.length ? {
        type: 'FeatureCollection',
        features: pts.map((p, i) => feature({ type: 'Point', coordinates: coord(p) }, i === 0 ? { label: 'Observer' } : {})),
      } : null, BASE_STYLE);
      if (hover && sight) this.sendOverlay(PREVIEW, sightFeatures(sight.points, sight.s, false), SIGHT_STYLE);
      else if (hover && pts.length) this.sendOverlay(PREVIEW, { type: 'LineString', coordinates: [coord(pts[0]), coord(hover)] }, BAND_STYLE);
      else this.sendOverlay(PREVIEW, null, {});
      return;
    }

    const coords = pts.map(coord);
    const ring = mode === 'area' && pts.length >= 3;
    const endLabel = this.labelForEnd();
    // The committed geometry: built and sent only when the points or the end label changed
    const layerKey = `points|${mode}|${this.pointsRev}|${endLabel ?? ''}`;
    if (this.shown.get(LAYER) !== layerKey) {
      const features: ReturnType<typeof feature>[] = [];
      if (pts.length >= 2) {
        features.push(feature({ type: 'LineString', coordinates: ring ? [...coords, coords[0]] : coords }));
      }
      coords.forEach((c, i) => {
        features.push(feature({ type: 'Point', coordinates: c }, i === coords.length - 1 && endLabel ? { label: endLabel } : {}));
      });
      this.shown.set(LAYER, layerKey);
      this.deps.setOverlay(LAYER, features.length ? { type: 'FeatureCollection', features } : null, BASE_STYLE);
    }

    // Rubber band to the pointer
    if (hover && pts.length > 0) {
      const h = coord(hover);
      const band = mode === 'area' && pts.length >= 2 ? [coords[pts.length - 1], h, coords[0]] : [coords[pts.length - 1], h];
      this.sendOverlay(PREVIEW, { type: 'LineString', coordinates: band }, BAND_STYLE);
    } else {
      this.sendOverlay(PREVIEW, null, {});
    }
  }

  /** The label on the last point: the committed result while the pointer is off the map, and when finished. */
  private labelForEnd(): string | null {
    const r = this.result;
    if (!r || (this.hover && !this.finished)) return null;
    if (r.mode === 'distance' || r.mode === 'profile') return formatDistance(r.path.distance);
    if (r.mode === 'area') return formatArea(r.area.area);
    return null;
  }
}
