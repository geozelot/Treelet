// ============================================================================
// treelet.js - Overlay Renderer
//
// Draws GeoJSON overlays on the terrain:
//   Lines    densified to the resolution of the terrain in view and draped
//            with the CPU elevation sampler; wide lines in CSS pixels
//            (LineSegments2), one object per line width and style opacity,
//            colors per vertex. Translucent lines cover each pixel once.
//   Points   round markers with an outline (one Points object per overlay).
//   Fills    polygons rasterized into an RGBA image shown as a coat the
//            overlay owns (it follows the overlay's visibility, opacity and
//            zoom range, keeps its place in the stack across data and style
//            changes), so fills lie exactly on the ground with no z-fighting.
//   Labels   DOM text placed over the map, left out where they would overlap
//            an earlier label or terrain hides them.
// Each overlay's geometry is relative to an anchor near its data (precise
// in float32 however far from the world origin) and scaled by the terrain
// exaggeration. As finer terrain loads, only the vertices under the tiles
// that changed get new heights, in place (at most every DRAPE_INTERVAL_MS
// while tiles stream in); the lines are densified again only when the
// terrain in view gets much finer or coarser.
// ============================================================================

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  Vector2,
  Vector3,
  type InterleavedBufferAttribute,
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
import { createLineMaterial, setLineOpacity, createPointMaterial, srgbToLinear } from './materials';

/** Re-drape a streaming overlay at most this often. */
const DRAPE_INTERVAL_MS = 200;
/** Most line vertices per overlay (the draping step grows to stay below). */
const MAX_LINE_VERTICES = 400_000;
/** Longer side of a fill raster in pixels. */
const FILL_RASTER_SIZE = 2048;
/** Most labels placed per frame, and how often their occlusion is checked. */
const MAX_LABELS = 300;
const OCCLUSION_INTERVAL_MS = 250;
/** Segments per bounding box when finding the vertices under changed terrain. */
const CHUNK = 128;
/** Screen cell (px) of the label overlap grid. */
const LABEL_CELL = 64;

/** A world rectangle (x east, y north). */
export interface WorldRect {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface OverlayRendererDeps {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  labels: TreeletLabels | null;
  toWorld: (lngLat: LngLat) => { x: number; y: number };
  /** Scene height of the terrain at a world point with exaggeration 1, or null where nothing is loaded. */
  groundHeight: (x: number, y: number) => number | null;
  /** The terrain exaggeration (heights scale with it). */
  exaggeration: () => number;
  /** World size of a texel of the finest terrain in view (the draping step). */
  texelWorld: () => number;
  /** Changes whenever the loaded elevations change. */
  terrainVersion: () => number;
  /** Where elevations may differ since a version, or null when anything may have changed. */
  changesSince: (version: number) => WorldRect[] | null;
  zoom: () => number;
  requestRender: () => void;
  /** Whether terrain hides a world point (scene height with exaggeration) from the camera. */
  isOccluded: (x: number, y: number, z: number) => boolean;
  /** Polygon fills as image coats owned by their overlay. */
  fills: {
    /** Add a fill coat for overlay `owner`; returns its id, or null when it can't be shown. */
    add: (name: string, raster: RasterInput, owner: string) => string | null;
    /** Draw a new raster in an existing fill coat; false when the coat is gone. */
    update: (id: string, raster: RasterInput) => boolean;
    remove: (id: string) => void;
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
  /** Ground height with exaggeration 1. */
  z: number;
  style: ResolvedStyle;
  occluded: boolean;
}

/** The lines of one width and style opacity: one draw call. */
interface LineGroup {
  width: number;
  /** The style's line opacity (the overlay's opacity multiplies it). */
  baseOpacity: number;
  material: LineMaterial;
  object: LineSegments2;
  geometry: LineSegmentsGeometry;
  /** Segment ends relative to the anchor, [x0, y0, z0, x1, y1, z1] per segment (the geometry's own array). */
  pos: Float32Array;
  /** Bounds of each run of CHUNK segments, relative to the anchor: [west, south, east, north] per chunk. */
  chunks: Float32Array;
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
  lineGroups: LineGroup[];
  pointObject: Points | null;
  pointMaterial: ShaderMaterial | null;
  /** Whether the line and point geometry exist for the current data and style. */
  built: boolean;
  /** Terrain version the heights were sampled at, the densifying step, and when. */
  drapedVersion: number;
  step: number;
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

function inRects(x: number, y: number, rects: readonly WorldRect[]): boolean {
  for (const r of rects) if (x >= r.west && x <= r.east && y >= r.south && y <= r.north) return true;
  return false;
}

export class OverlayRenderer {
  private readonly entries = new Map<string, Entry>();
  private readonly resolution = new Vector2(1, 1);
  private pixelRatio = 1;
  private labelsDirty = false;
  private lastOcclusion = -Infinity;
  private occlusionPending = false;
  private readonly scratch = new Vector3();
  private readonly sizeScratch = new Vector2();
  private disposed = false;

  constructor(private readonly deps: OverlayRendererDeps) {
    this.syncSize();
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Add an overlay or replace its data and options (its fill coat keeps its id and place). */
  set(id: string, input: OverlayInput): void {
    if (this.disposed) return;
    const old = this.entries.get(id);
    if (old) this.teardownGeometry(old);
    const data = normalizeGeoJSON(input.data);
    const { toWorld } = this.deps;
    const anchor = dataCenter(data, toWorld);
    const group = old?.group ?? new Group();
    group.position.set(anchor.x, anchor.y, 0);
    group.scale.set(1, 1, this.deps.exaggeration());
    group.matrixAutoUpdate = false;
    group.updateMatrix();
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
      lineGroups: [],
      pointObject: null,
      pointMaterial: old?.pointMaterial ?? null,
      built: false,
      drapedVersion: -1,
      step: 0,
      lastDrape: -Infinity,
      fillCoat: old?.fillCoat ?? null,
    };
    this.entries.set(id, entry);
    this.applyStyles(entry);
    this.deps.requestRender();
  }

  setStyle(id: string, style: OverlayStyleSpec | undefined): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.input.style = style;
    this.teardownGeometry(e);
    this.applyStyles(e);
    this.deps.requestRender();
  }

  /** Show or hide an overlay (its fill coat follows through its owner). */
  setVisible(id: string, visible: boolean): void {
    const e = this.entries.get(id);
    if (!e || e.input.visible === visible) return;
    e.input.visible = visible;
    this.labelsDirty = true;
    this.deps.requestRender();
  }

  /** Overlay opacity: applied to the line and point materials, without draping again. */
  setOpacity(id: string, opacity: number): void {
    const e = this.entries.get(id);
    if (!e || !Number.isFinite(opacity)) return;
    e.input.opacity = Math.max(0, Math.min(1, opacity));
    for (const g of e.lineGroups) this.applyGroupOpacity(e, g);
    if (e.pointMaterial) e.pointMaterial.uniforms.uOpacity.value = e.input.opacity;
    this.labelsDirty = true;
    this.deps.requestRender();
  }

  /** Turn polygon fills on or off (off removes the fill coat). */
  setFills(id: string, fills: boolean): void {
    const e = this.entries.get(id);
    if (!e || e.input.fills === fills) return;
    e.input.fills = fills;
    this.buildFill(e);
  }

  /** The overlay's fill coat was removed from outside (its fills are off from now on). */
  fillRemoved(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.fillCoat = null;
    e.input.fills = false;
  }

  remove(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    this.teardown(e);
    this.entries.delete(id);
    this.labelsDirty = true;
    this.deps.requestRender();
    return true;
  }

  /** Normalized data of an overlay (tests, diagnostics). */
  getData(id: string): NormalizedOverlay | null {
    return this.entries.get(id)?.data ?? null;
  }

  /** Id of an overlay's fill coat, or null. */
  getFillCoat(id: string): string | null {
    return this.entries.get(id)?.fillCoat ?? null;
  }

  /**
   * Per frame: show / hide by zoom, follow the exaggeration, drape where the
   * terrain changed, place labels. Returns true when the scene must be
   * redrawn.
   */
  update(cameraMoved: boolean, now = performance.now()): boolean {
    if (this.disposed) return false;
    let changed = this.syncSize();
    const zoom = this.deps.zoom();
    const version = this.deps.terrainVersion();
    const exaggeration = this.deps.exaggeration();
    for (const e of this.entries.values()) {
      const shown = e.input.visible && zoom >= e.input.minZoom && zoom <= e.input.maxZoom;
      if (e.group.visible !== shown) {
        e.group.visible = shown;
        this.labelsDirty = true;
        changed = true;
      }
      if (!shown) continue;
      if (e.group.scale.z !== exaggeration) {
        e.group.scale.z = exaggeration;
        e.group.updateMatrix();
        this.labelsDirty = true;
        changed = true;
      }
      if (!e.built) {
        this.build(e, version, now);
        changed = true;
      } else if (e.drapedVersion !== version && now - e.lastDrape >= DRAPE_INTERVAL_MS) {
        this.redrape(e, version, now);
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
    for (const e of this.entries.values()) this.teardown(e);
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
    e.built = false;
    this.labelsDirty = true;
  }

  /** The polygon fills as an image over their bounds, or null when there are none to draw. */
  private fillRaster(e: Entry): RasterInput | null {
    if (!e.input.fills) return null;
    const polys = e.data.polygons.filter((p) => e.styles[p.feature]?.fillColor && e.styles[p.feature].fillOpacity > 0);
    if (polys.length === 0) return null;
    const { toWorld } = this.deps;
    const worldRings = polys.map((p) => p.rings.map((r) => r.map((c) => { const w = toWorld(c); return [w.x, w.y] as [number, number]; })));
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const rings of worldRings) for (const [x, y] of rings[0]) {
      if (x < west) west = x; if (x > east) east = x;
      if (y < south) south = y; if (y > north) north = y;
    }
    if (!(east > west && north > south)) return null;
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
    return { width, height, data: image, bounds: { west, south, east, north } };
  }

  /** Show the fills in the overlay's coat: drawn again in place, added, or removed when there are none. */
  private buildFill(e: Entry): void {
    const raster = this.fillRaster(e);
    const { fills } = this.deps;
    if (!raster) {
      if (e.fillCoat) fills.remove(e.fillCoat);
      e.fillCoat = null;
      return;
    }
    if (e.fillCoat && fills.update(e.fillCoat, raster)) return;
    e.fillCoat = fills.add(e.input.name, raster, e.id);
  }

  /** Remove the line and point geometry (data or style changed). */
  private teardownGeometry(e: Entry): void {
    for (const g of e.lineGroups) {
      e.group.remove(g.object);
      g.geometry.dispose();
      g.material.dispose();
    }
    e.lineGroups = [];
    if (e.pointObject) {
      e.group.remove(e.pointObject);
      e.pointObject.geometry.dispose();
      e.pointObject = null;
    }
    e.built = false;
  }

  /** Remove everything of an overlay: geometry, materials, group and fill coat. */
  private teardown(e: Entry): void {
    this.teardownGeometry(e);
    e.pointMaterial?.dispose();
    e.pointMaterial = null;
    if (e.fillCoat) {
      this.deps.fills.remove(e.fillCoat);
      e.fillCoat = null;
    }
    this.deps.scene.remove(e.group);
  }

  private applyGroupOpacity(e: Entry, g: LineGroup): void {
    const opacity = g.baseOpacity * e.input.opacity;
    setLineOpacity(g.material, opacity);
    g.object.visible = opacity > 0;
  }

  /** The densifying step for the terrain in view (bounded by the vertex budget). */
  private stepFor(e: Entry): number {
    let step = Math.max(this.deps.texelWorld() * 2, 1e-9);
    let total = 0;
    for (const l of e.lines) for (let i = 1; i < l.pts.length; i++) total += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]);
    if (total / step > MAX_LINE_VERTICES) step = total / MAX_LINE_VERTICES;
    return step;
  }

  /** Build line and point geometry on the current terrain. */
  private build(e: Entry, version: number, now: number): void {
    this.teardownGeometry(e);
    const { groundHeight } = this.deps;
    const ax = e.anchorX;
    const ay = e.anchorY;
    const z = (x: number, y: number) => groundHeight(x, y) ?? 0;
    const order = 10 + e.input.order * 2;
    const step = this.stepFor(e);

    // ==== Lines: grouped by width and style opacity ====
    const groups = new Map<string, { width: number; opacity: number; pos: number[]; col: number[] }>();
    for (const l of e.lines) {
      const st = e.styles[l.feature];
      if (!st || st.lineOpacity <= 0) continue;
      const gk = `${st.lineWidth}|${st.lineOpacity}`;
      let g = groups.get(gk);
      if (!g) { g = { width: st.lineWidth, opacity: st.lineOpacity, pos: [], col: [] }; groups.set(gk, g); }
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
    for (const g of groups.values()) {
      if (g.pos.length === 0) continue;
      const pos = new Float32Array(g.pos);
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(pos); // keeps `pos` as its buffer: heights are updated in place
      geometry.setColors(new Float32Array(g.col));
      const material = createLineMaterial(g.width, g.opacity, this.resolution);
      const object = new LineSegments2(geometry, material);
      object.renderOrder = order;
      object.frustumCulled = false; // heights change in place; the bounds would go stale
      e.group.add(object);
      const group: LineGroup = { width: g.width, baseOpacity: g.opacity, material, object, geometry, pos, chunks: chunkBounds(pos) };
      this.applyGroupOpacity(e, group);
      e.lineGroups.push(group);
    }

    // ==== Points ====
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

    e.built = true;
    e.step = step;
    e.drapedVersion = version;
    e.lastDrape = now;
    this.labelsDirty = true;
  }

  /**
   * The terrain changed: give the vertices under the changed tiles their new
   * heights in place, or densify again when the terrain in view got much
   * finer (detail to follow) or coarser (vertices to spare).
   */
  private redrape(e: Entry, version: number, now: number): void {
    const step = this.stepFor(e);
    if (step < e.step / 2 || step > e.step * 4) {
      this.build(e, version, now);
      return;
    }
    const rects = this.deps.changesSince(e.drapedVersion);
    const { groundHeight } = this.deps;
    const ax = e.anchorX;
    const ay = e.anchorY;
    // Changed areas relative to the anchor (null: everything)
    const local = rects?.map((r) => ({ west: r.west - ax, east: r.east - ax, south: r.south - ay, north: r.north - ay })) ?? null;
    if (local === null || local.length > 0) {
      for (const g of e.lineGroups) {
        if (updateLineHeights(g, local, (x, y) => groundHeight(x + ax, y + ay) ?? 0)) {
          (g.geometry.attributes.instanceStart as InterleavedBufferAttribute).data.needsUpdate = true;
        }
      }
      const pts = e.pointObject?.geometry.getAttribute('position');
      if (pts) {
        const arr = pts.array as Float32Array;
        let any = false;
        for (let i = 0; i < e.points.length; i++) {
          const p = e.points[i];
          if (local && !inRects(p.x - ax, p.y - ay, local)) continue;
          arr[i * 3 + 2] = groundHeight(p.x, p.y) ?? 0;
          any = true;
        }
        if (any) pts.needsUpdate = true;
      }
      for (const l of e.labels) {
        if (local && !inRects(l.x - ax, l.y - ay, local)) continue;
        l.z = groundHeight(l.x, l.y) ?? 0;
      }
    }
    e.drapedVersion = version;
    e.lastDrape = now;
    this.labelsDirty = true;
  }

  // =========================================================================
  // Size and labels
  // =========================================================================

  /** Follow the canvas size (line widths are in CSS pixels). */
  private syncSize(): boolean {
    const r = this.deps.renderer;
    const size = r.getSize(this.sizeScratch);
    const ratio = r.getPixelRatio();
    if (size.x === this.resolution.x && size.y === this.resolution.y && ratio === this.pixelRatio) return false;
    this.resolution.copy(size);
    this.pixelRatio = ratio;
    for (const e of this.entries.values()) {
      for (const g of e.lineGroups) g.material.resolution.copy(size);
      if (e.pointMaterial) e.pointMaterial.uniforms.uPixelRatio.value = ratio;
    }
    this.labelsDirty = true;
    return true;
  }

  /**
   * Place the labels in order: off screen, overlapping an earlier label
   * (tested on a grid of screen cells) or hidden by terrain (tested last,
   * and only every OCCLUSION_INTERVAL_MS, as it marches through the
   * terrain) leaves a label out.
   */
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
    const grid = new Map<number, Array<[number, number, number, number]>>();
    const cells = (box: readonly number[], visit: (key: number) => boolean | void): boolean => {
      const cx0 = Math.floor(box[0] / LABEL_CELL), cx1 = Math.floor(box[2] / LABEL_CELL);
      const cy0 = Math.floor(box[1] / LABEL_CELL), cy1 = Math.floor(box[3] / LABEL_CELL);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) if (visit((cy + 4096) * 8192 + cx + 4096)) return true;
      }
      return false;
    };
    const overlaps = (box: [number, number, number, number]) => cells(box, (key) =>
      grid.get(key)?.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3]) === true);
    let checked = 0;
    for (const e of this.entries.values()) {
      if (!e.group.visible) continue;
      const alpha = e.input.opacity;
      if (alpha <= 0) continue;
      const exaggeration = e.group.scale.z;
      for (const l of e.labels) {
        if (placed.length >= MAX_LABELS) break;
        const z = l.z * exaggeration;
        const v = this.scratch.set(l.x, l.y, z).project(cam);
        if (v.z > 1 || v.z < -1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h - l.style.pointRadius - 3;
        const bw = l.text.length * l.style.labelSize * 0.58 + 6;
        const bh = l.style.labelSize * 1.3;
        const box: [number, number, number, number] = [sx - bw / 2, sy - bh, sx + bw / 2, sy];
        if (overlaps(box)) continue;
        if (checkOcclusion && checked < MAX_LABELS * 2) {
          checked++;
          l.occluded = this.deps.isOccluded(l.x, l.y, z);
        }
        if (l.occluded) continue;
        cells(box, (key) => { const list = grid.get(key); if (list) list.push(box); else grid.set(key, [box]); });
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

/** Bounds of each run of CHUNK segments of a segment array ([x0, y0, z0, x1, y1, z1] per segment). */
function chunkBounds(pos: Float32Array): Float32Array {
  const segments = pos.length / 6;
  const out = new Float32Array(Math.ceil(segments / CHUNK) * 4);
  for (let c = 0; c * CHUNK < segments; c++) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const end = Math.min(segments, (c + 1) * CHUNK);
    for (let i = c * CHUNK; i < end; i++) {
      const o = i * 6;
      for (const [x, y] of [[pos[o], pos[o + 1]], [pos[o + 3], pos[o + 4]]]) {
        if (x < w) w = x; if (x > e) e = x;
        if (y < s) s = y; if (y > n) n = y;
      }
    }
    out.set([w, s, e, n], c * 4);
  }
  return out;
}

/**
 * New heights for the segment ends inside `rects` (all ends when null), in
 * place. Returns whether any changed.
 */
function updateLineHeights(g: LineGroup, rects: readonly WorldRect[] | null, height: (x: number, y: number) => number): boolean {
  const pos = g.pos;
  const segments = pos.length / 6;
  let any = false;
  for (let c = 0; c * CHUNK < segments; c++) {
    if (rects) {
      const w = g.chunks[c * 4], s = g.chunks[c * 4 + 1], e = g.chunks[c * 4 + 2], n = g.chunks[c * 4 + 3];
      if (!rects.some((r) => r.west <= e && w <= r.east && r.south <= n && s <= r.north)) continue;
    }
    const end = Math.min(segments, (c + 1) * CHUNK);
    for (let i = c * CHUNK; i < end; i++) {
      for (let k = i * 6; k <= i * 6 + 3; k += 3) {
        if (rects && !inRects(pos[k], pos[k + 1], rects)) continue;
        pos[k + 2] = height(pos[k], pos[k + 1]);
        any = true;
      }
    }
  }
  return any;
}
