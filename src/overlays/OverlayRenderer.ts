// ============================================================================
// treelet.js - Overlay Renderer
//
// Draws GeoJSON overlays on the terrain:
//   Lines    densified to the loaded terrain's resolution and draped with the
//            CPU elevation sampler; wide lines in CSS pixels (LineSegments2),
//            one object per line width / opacity, colors per vertex.
//   Points   round markers with an outline (one Points object per overlay).
//   Fills    polygons rasterized into an RGBA image shown as a coat, so they
//            lie exactly on the ground with no z-fighting.
//   Labels   DOM text placed over the map, hidden behind terrain and where
//            they would overlap an earlier label.
// Each overlay's geometry is relative to an anchor near its data (precise
// in float32 however far from the world origin). Overlays are draped again
// whenever finer terrain loads or the exaggeration changes (at most every
// DRAPE_INTERVAL_MS while tiles stream in).
// ============================================================================

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type Scene,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { LngLat } from '../core/types';
import type { RasterInput } from '../terrain/RasterSet';
import type { TreeletLabels, PlacedLabel } from '../ui/TreeletLabels';
import type { GeoJSON, OverlayStyleSpec, ResolvedStyle } from './types';
import { normalizeGeoJSON, type NormalizedOverlay } from './geojson';
import { resolveStyle } from './style';
import { densify, rasterizePolygons } from './rasterize';
import { createLineMaterial, createPointMaterial, srgbToLinear } from './materials';

/** Re-drape a streaming overlay at most this often. */
const DRAPE_INTERVAL_MS = 200;
/** Most line vertices per overlay (the draping step grows to stay below). */
const MAX_LINE_VERTICES = 400_000;
/** Longer side of a fill raster in pixels. */
const FILL_RASTER_SIZE = 2048;
/** Most labels placed per frame, and how often their occlusion is checked. */
const MAX_LABELS = 300;
const OCCLUSION_INTERVAL_MS = 250;

export interface OverlayRendererDeps {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  labels: TreeletLabels | null;
  toWorld: (lngLat: LngLat) => { x: number; y: number };
  /** Scene height of the terrain at a world point (exaggerated), or null where nothing is loaded. */
  groundZ: (x: number, y: number) => number | null;
  /** World size of the finest loaded terrain texel (the draping step). */
  texelWorld: () => number;
  /** Changes whenever the loaded elevations or the exaggeration change. */
  terrainKey: () => string;
  zoom: () => number;
  requestRender: () => void;
  /** Whether terrain hides a world point from the camera. */
  isOccluded: (x: number, y: number, z: number) => boolean;
  /** Polygon fills as image coats. */
  fills: {
    add: (name: string, raster: RasterInput, opacity: number) => string | null;
    remove: (id: string) => void;
    setVisible: (id: string, visible: boolean) => void;
    setOpacity: (id: string, opacity: number) => void;
  };
}

export interface OverlayInput {
  name: string;
  data: GeoJSON | null;
  style?: OverlayStyleSpec;
  visible?: boolean;
  /** Multiplies line, point, fill and label opacity (default 1). */
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Rasterize polygon fills into a coat (default true). */
  fills?: boolean;
  /** Show labels (default true). */
  labels?: boolean;
  /** Draw order among overlays (higher on top). */
  order?: number;
}

interface LabelSite {
  text: string;
  x: number;
  y: number;
  z: number;
  style: ResolvedStyle;
  occluded: boolean;
}

interface Entry {
  id: string;
  input: Required<Omit<OverlayInput, 'style' | 'data'>> & { style?: OverlayStyleSpec };
  data: NormalizedOverlay;
  styles: ResolvedStyle[];
  anchorX: number;
  anchorY: number;
  /** World positions of points and line vertices. */
  points: Array<{ x: number; y: number; feature: number }>;
  lines: Array<{ pts: Array<[number, number]>; feature: number }>;
  labels: LabelSite[];
  group: Group;
  lineObjects: LineSegments2[];
  lineMaterials: Map<string, LineMaterial>;
  pointObject: Points | null;
  pointMaterial: ShaderMaterial | null;
  drapedKey: string | null;
  lastDrape: number;
  fillCoat: string | null;
}

function dataCenter(o: NormalizedOverlay, toWorld: OverlayRendererDeps['toWorld']): { x: number; y: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: LngLat) => {
    const w = toWorld(p);
    if (w.x < x0) x0 = w.x; if (w.x > x1) x1 = w.x;
    if (w.y < y0) y0 = w.y; if (w.y > y1) y1 = w.y;
  };
  for (const p of o.points) add(p.lngLat);
  for (const l of o.lines) for (const p of l.coords) add(p);
  return x0 <= x1 ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : { x: 0, y: 0 };
}

/** Rough label anchor of a polygon ring: the mean of its vertices. */
function ringCenter(ring: LngLat[]): LngLat {
  let lng = 0, lat = 0;
  for (const p of ring) { lng += p.lng; lat += p.lat; }
  return { lng: lng / ring.length, lat: lat / ring.length };
}

export class OverlayRenderer {
  private readonly entries = new Map<string, Entry>();
  private readonly resolution = new Vector2(1, 1);
  private pixelRatio = 1;
  private labelsDirty = false;
  private lastOcclusion = -Infinity;
  private occlusionPending = false;
  private readonly scratch = new Vector3();
  private disposed = false;

  constructor(private readonly deps: OverlayRendererDeps) {
    this.syncSize();
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Add an overlay or replace its data and options. */
  set(id: string, input: OverlayInput): void {
    if (this.disposed) return;
    const old = this.entries.get(id);
    if (old) this.teardown(old, false);
    const data = normalizeGeoJSON(input.data);
    const { toWorld } = this.deps;
    const anchor = dataCenter(data, toWorld);
    const group = old?.group ?? new Group();
    group.position.set(anchor.x, anchor.y, 0);
    group.updateMatrix();
    group.matrixAutoUpdate = false;
    if (!old) this.deps.scene.add(group);
    const entry: Entry = {
      id,
      input: {
        name: input.name,
        style: input.style,
        visible: input.visible ?? true,
        opacity: Math.max(0, Math.min(1, input.opacity ?? 1)),
        minZoom: input.minZoom ?? 0,
        maxZoom: input.maxZoom ?? 24,
        fills: input.fills ?? true,
        labels: input.labels ?? true,
        order: input.order ?? 0,
      },
      data,
      styles: [],
      anchorX: anchor.x,
      anchorY: anchor.y,
      points: data.points.map((p) => ({ ...toWorld(p.lngLat), feature: p.feature })),
      lines: data.lines.map((l) => ({ pts: l.coords.map((c) => { const w = toWorld(c); return [w.x, w.y] as [number, number]; }), feature: l.feature })),
      labels: [],
      group,
      lineObjects: [],
      lineMaterials: old?.lineMaterials ?? new Map(),
      pointObject: null,
      pointMaterial: old?.pointMaterial ?? null,
      drapedKey: null,
      lastDrape: -Infinity,
      fillCoat: null,
    };
    this.entries.set(id, entry);
    this.applyStyles(entry);
    this.deps.requestRender();
  }

  setStyle(id: string, style: OverlayStyleSpec | undefined): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.input.style = style;
    this.teardown(e, false);
    this.applyStyles(e);
    this.deps.requestRender();
  }

  setVisible(id: string, visible: boolean): void {
    const e = this.entries.get(id);
    if (!e || e.input.visible === visible) return;
    e.input.visible = visible;
    if (e.fillCoat) this.deps.fills.setVisible(e.fillCoat, visible);
    this.labelsDirty = true;
    this.deps.requestRender();
  }

  setOpacity(id: string, opacity: number): void {
    const e = this.entries.get(id);
    if (!e || !Number.isFinite(opacity)) return;
    e.input.opacity = Math.max(0, Math.min(1, opacity));
    if (e.fillCoat) this.deps.fills.setOpacity(e.fillCoat, e.input.opacity);
    e.drapedKey = null; // rebuild with the new opacity
    this.labelsDirty = true;
    this.deps.requestRender();
  }

  remove(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    this.teardown(e, true);
    this.entries.delete(id);
    this.labelsDirty = true;
    this.deps.requestRender();
    return true;
  }

  /** Normalized data of an overlay (tests, diagnostics). */
  getData(id: string): NormalizedOverlay | null {
    return this.entries.get(id)?.data ?? null;
  }

  /**
   * Per frame: show / hide by zoom, drape again when the terrain changed,
   * place labels. Returns true when the scene must be redrawn.
   */
  update(cameraMoved: boolean, now = performance.now()): boolean {
    if (this.disposed) return false;
    let changed = this.syncSize();
    const zoom = this.deps.zoom();
    const key = this.deps.terrainKey();
    for (const e of this.entries.values()) {
      const shown = e.input.visible && zoom >= e.input.minZoom && zoom <= e.input.maxZoom;
      if (e.group.visible !== shown) {
        e.group.visible = shown;
        this.labelsDirty = true;
        changed = true;
      }
      if (!shown) continue;
      if (e.drapedKey !== key && (e.drapedKey === null || now - e.lastDrape >= DRAPE_INTERVAL_MS)) {
        this.drape(e, key, now);
        changed = true;
      }
    }
    if (cameraMoved || changed) this.occlusionPending = true;
    if (cameraMoved || changed || this.labelsDirty) this.placeLabels(now);
    else if (this.occlusionPending && now - this.lastOcclusion >= OCCLUSION_INTERVAL_MS) this.placeLabels(now);
    return changed;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const e of this.entries.values()) this.teardown(e, true);
    this.entries.clear();
    this.deps.labels?.show([]);
    this.disposed = true;
  }

  // =========================================================================
  // Building
  // =========================================================================

  private applyStyles(e: Entry): void {
    e.styles = e.data.features.map((f) => resolveStyle(e.input.style, f));
    e.labels = [];
    if (e.input.labels) {
      const labelled = new Set<number>();
      const site = (feature: number, at: LngLat) => {
        const st = e.styles[feature];
        if (!st?.label || labelled.has(feature)) return;
        labelled.add(feature);
        const w = this.deps.toWorld(at);
        e.labels.push({ text: st.label, x: w.x, y: w.y, z: 0, style: st, occluded: false });
      };
      for (const p of e.data.points) site(p.feature, p.lngLat);
      for (const poly of e.data.polygons) site(poly.feature, ringCenter(poly.rings[0]));
      for (const l of e.data.lines) if (!l.outline) site(l.feature, l.coords[Math.floor(l.coords.length / 2)]);
    }
    this.buildFill(e);
    e.drapedKey = null;
    this.labelsDirty = true;
  }

  /** Rasterize the polygon fills into an image coat. */
  private buildFill(e: Entry): void {
    if (!e.input.fills) return;
    const polys = e.data.polygons.filter((p) => e.styles[p.feature]?.fillColor && e.styles[p.feature].fillOpacity > 0);
    if (polys.length === 0) return;
    const { toWorld } = this.deps;
    const worldRings = polys.map((p) => p.rings.map((r) => r.map((c) => { const w = toWorld(c); return [w.x, w.y] as [number, number]; })));
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const rings of worldRings) for (const [x, y] of rings[0]) {
      if (x < west) west = x; if (x > east) east = x;
      if (y < south) south = y; if (y > north) north = y;
    }
    if (!(east > west && north > south)) return;
    const long = Math.max(east - west, north - south);
    const width = Math.max(1, Math.round((FILL_RASTER_SIZE * (east - west)) / long));
    const height = Math.max(1, Math.round((FILL_RASTER_SIZE * (north - south)) / long));
    const sx = width / (east - west);
    const sy = height / (north - south);
    const image = rasterizePolygons(polys.map((p, k) => {
      const st = e.styles[p.feature];
      const c = st.fillColor!;
      return {
        rings: worldRings[k].map((r) => r.map(([x, y]) => [(x - west) * sx, (north - y) * sy] as [number, number])),
        color: [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), Math.round(st.fillOpacity * 255)] as [number, number, number, number],
      };
    }), width, height);
    e.fillCoat = this.deps.fills.add(e.input.name, { width, height, data: image, bounds: { west, south, east, north } }, e.input.opacity);
    if (e.fillCoat && !e.input.visible) this.deps.fills.setVisible(e.fillCoat, false);
  }

  /** Remove the scene objects (and with `all`, the group and fill coat). */
  private teardown(e: Entry, all: boolean): void {
    for (const o of e.lineObjects) {
      e.group.remove(o);
      o.geometry.dispose();
    }
    e.lineObjects = [];
    if (e.pointObject) {
      e.group.remove(e.pointObject);
      e.pointObject.geometry.dispose();
      e.pointObject = null;
    }
    if (e.fillCoat) {
      this.deps.fills.remove(e.fillCoat);
      e.fillCoat = null;
    }
    if (all) {
      for (const m of e.lineMaterials.values()) m.dispose();
      e.lineMaterials.clear();
      e.pointMaterial?.dispose();
      e.pointMaterial = null;
      this.deps.scene.remove(e.group);
    }
  }

  /** Build line and point geometry on the current terrain. */
  private drape(e: Entry, key: string, now: number): void {
    const { groundZ } = this.deps;
    const ax = e.anchorX;
    const ay = e.anchorY;
    const z = (x: number, y: number) => groundZ(x, y) ?? 0;
    const order = 10 + e.input.order * 2;

    // ==== Lines ====
    for (const o of e.lineObjects) {
      e.group.remove(o);
      o.geometry.dispose();
    }
    e.lineObjects = [];
    let step = Math.max(this.deps.texelWorld() * 2, 1e-9);
    let total = 0;
    for (const l of e.lines) for (let i = 1; i < l.pts.length; i++) total += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]);
    if (total / step > MAX_LINE_VERTICES) step = total / MAX_LINE_VERTICES;

    const groups = new Map<string, { width: number; opacity: number; pos: number[]; col: number[] }>();
    for (const l of e.lines) {
      const st = e.styles[l.feature];
      if (!st) continue;
      const opacity = st.lineOpacity * e.input.opacity;
      if (opacity <= 0) continue;
      const gk = `${st.lineWidth}|${opacity}`;
      let g = groups.get(gk);
      if (!g) { g = { width: st.lineWidth, opacity, pos: [], col: [] }; groups.set(gk, g); }
      const d = densify(l.pts, step);
      const r = srgbToLinear(st.lineColor[0]);
      const gc = srgbToLinear(st.lineColor[1]);
      const b = srgbToLinear(st.lineColor[2]);
      let px = d[0], py = d[1], pz = z(px, py);
      for (let i = 2; i < d.length; i += 2) {
        const x = d[i], y = d[i + 1], zz = z(x, y);
        g.pos.push(px - ax, py - ay, pz, x - ax, y - ay, zz);
        g.col.push(r, gc, b, r, gc, b);
        px = x; py = y; pz = zz;
      }
    }
    for (const [gk, g] of groups) {
      if (g.pos.length === 0) continue;
      let material = e.lineMaterials.get(gk);
      if (!material) {
        material = createLineMaterial(g.width, g.opacity, this.resolution);
        e.lineMaterials.set(gk, material);
      }
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(new Float32Array(g.pos));
      geometry.setColors(new Float32Array(g.col));
      const obj = new LineSegments2(geometry, material);
      obj.renderOrder = order;
      e.group.add(obj);
      e.lineObjects.push(obj);
    }

    // ==== Points ====
    if (e.pointObject) {
      e.group.remove(e.pointObject);
      e.pointObject.geometry.dispose();
      e.pointObject = null;
    }
    if (e.points.length > 0) {
      const n = e.points.length;
      const pos = new Float32Array(n * 3);
      const color = new Float32Array(n * 3);
      const stroke = new Float32Array(n * 3);
      const radius = new Float32Array(n);
      const strokeWidth = new Float32Array(n);
      const alpha = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = e.points[i];
        const st = e.styles[p.feature];
        pos.set([p.x - ax, p.y - ay, z(p.x, p.y)], i * 3);
        color.set(st.pointColor, i * 3);
        stroke.set(st.pointStroke, i * 3);
        radius[i] = st.pointRadius;
        strokeWidth[i] = st.pointStrokeWidth;
        alpha[i] = st.pointOpacity;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
      geometry.setAttribute('strokeColor', new Float32BufferAttribute(stroke, 3));
      geometry.setAttribute('radius', new Float32BufferAttribute(radius, 1));
      geometry.setAttribute('strokeWidth', new Float32BufferAttribute(strokeWidth, 1));
      geometry.setAttribute('alpha', new Float32BufferAttribute(alpha, 1));
      if (!e.pointMaterial) e.pointMaterial = createPointMaterial(1, this.pixelRatio);
      e.pointMaterial.uniforms.uOpacity.value = e.input.opacity;
      const obj = new Points(geometry, e.pointMaterial);
      obj.renderOrder = order + 1;
      obj.frustumCulled = false;
      e.group.add(obj);
      e.pointObject = obj;
    }

    // ==== Label heights ====
    for (const l of e.labels) l.z = z(l.x, l.y);

    e.drapedKey = key;
    e.lastDrape = now;
    this.labelsDirty = true;
  }

  // =========================================================================
  // Size and labels
  // =========================================================================

  /** Follow the canvas size (line widths are in CSS pixels). */
  private syncSize(): boolean {
    const r = this.deps.renderer;
    const size = r.getSize(new Vector2());
    const ratio = r.getPixelRatio();
    if (size.x === this.resolution.x && size.y === this.resolution.y && ratio === this.pixelRatio) return false;
    this.resolution.copy(size);
    this.pixelRatio = ratio;
    for (const e of this.entries.values()) {
      for (const m of e.lineMaterials.values()) m.resolution.copy(size);
      if (e.pointMaterial) e.pointMaterial.uniforms.uPixelRatio.value = ratio;
    }
    this.labelsDirty = true;
    return true;
  }

  private placeLabels(now: number): void {
    this.labelsDirty = false;
    const target = this.deps.labels;
    if (!target) return;
    const checkOcclusion = this.occlusionPending && now - this.lastOcclusion >= OCCLUSION_INTERVAL_MS;
    if (checkOcclusion) {
      this.lastOcclusion = now;
      this.occlusionPending = false;
    }
    const cam = this.deps.camera;
    cam.updateMatrixWorld();
    const w = this.resolution.x;
    const h = this.resolution.y;
    const placed: PlacedLabel[] = [];
    const boxes: Array<[number, number, number, number]> = [];
    let checked = 0;
    for (const e of this.entries.values()) {
      if (!e.group.visible) continue;
      const alpha = e.input.opacity;
      if (alpha <= 0) continue;
      for (const l of e.labels) {
        if (placed.length >= MAX_LABELS) break;
        const v = this.scratch.set(l.x, l.y, l.z).project(cam);
        if (v.z > 1 || v.z < -1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
        if (checkOcclusion && checked < MAX_LABELS * 2) {
          checked++;
          l.occluded = this.deps.isOccluded(l.x, l.y, l.z);
        }
        if (l.occluded) continue;
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h - l.style.pointRadius - 3;
        const bw = l.text.length * l.style.labelSize * 0.58 + 6;
        const bh = l.style.labelSize * 1.3;
        const box: [number, number, number, number] = [sx - bw / 2, sy - bh, sx + bw / 2, sy];
        if (boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
        boxes.push(box);
        placed.push({
          text: l.text,
          x: sx,
          y: sy,
          size: l.style.labelSize,
          color: alpha < 1 ? `color-mix(in srgb, ${l.style.labelColor} ${Math.round(alpha * 100)}%, transparent)` : l.style.labelColor,
          halo: l.style.labelHalo,
        });
      }
    }
    target.show(placed);
  }
}

