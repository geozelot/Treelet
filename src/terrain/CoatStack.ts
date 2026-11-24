// ============================================================================
// treelet.js - Coat Stack
//
// Packs the coats (imagery and analysis layers) into what the shader
// consumes: per-coat uniforms and one ramp-texture row per coat. Only the
// coats that are drawn are packed: those in their zoom range with an
// opacity above 0, at most MAX_COATS. Value domains may depend on the
// visible elevation range, which the renderer reports as it changes; ramp
// rows are rewritten only when their ramp or domain changed.
// ============================================================================

import { DataTexture, NearestFilter, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType, NoColorSpace } from 'three';
import type { CoatBlendMode, RampSpec, Vec4 } from '../analysis/types';
import { MAX_COATS } from '../analysis/registry';
import { RAMP_WIDTH, writeRampRow } from '../analysis/ramps';
import type { PackedCoat } from '../shaders/TerrainMaterial';

/** Visible elevation range assumed until the first tiles are drawn. */
export const DEFAULT_VISIBLE_RANGE: readonly [number, number] = [0, 4000];

/** A value domain: fixed, 'auto' (the visible elevation range) or derived from it. */
export type CoatDomain = [number, number] | 'auto' | ((visible: [number, number]) => [number, number]);

/** A coat as the display layer hands it over. */
export interface CoatInput {
  id: string;
  kind: number;
  blendMode: CoatBlendMode;
  opacity: number;
  /** Resolved ramp for value kinds; null for color kinds. */
  ramp: RampSpec | null;
  /** Value domain the ramp spans. */
  domain: CoatDomain;
  /** Raster slot the coat draws, or -1 (default). */
  raster?: number;
  /** Zoom range the coat is drawn in (default: every zoom). */
  minZoom?: number;
  maxZoom?: number;
  /** The coat reads the terrain shadow map. */
  shadowMap?: boolean;
  pack: (domain: [number, number]) => { p0: Vec4; p1: Vec4 };
}

/**
 * The domain a class ramp's row is written over: the coat's domain widened
 * to every break plus one texel, so values outside the domain still land in
 * their own class (the shader clamps to the row's edge texels).
 */
export function rampRowDomain(ramp: RampSpec | null, domain: [number, number]): [number, number] {
  if (!ramp || ramp.type !== 'classes' || ramp.breaks.length === 0) return domain;
  const b0 = ramp.breaks[0];
  const bn = ramp.breaks[ramp.breaks.length - 1];
  const lo = Math.min(domain[0], b0);
  const hi = Math.max(domain[1], bn);
  const texel = Math.max(hi - lo, 1e-9) / (RAMP_WIDTH - 2);
  return [Math.min(domain[0], b0 - texel), Math.max(domain[1], bn + texel)];
}

function sameDomain(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export class CoatStack {
  /** RAMP_WIDTH × MAX_COATS RGBA8, row i = drawn coat i. */
  readonly texture: DataTexture;
  private readonly data: Uint8Array;
  private inputs: CoatInput[] = [];
  /** Indexes into `inputs` of the coats drawn, bottom first. */
  private drawn: number[] = [];
  /** Resolved domain of each input (same order as `inputs`). */
  private domains: Array<[number, number]> = [];
  private readonly packedCoats: PackedCoat[] = [];
  /** What each ramp row was last written with (ramp + domain), to skip rewriting it. */
  private readonly rowKeys: string[] = new Array<string>(MAX_COATS).fill('');
  private autoRange: [number, number] = [DEFAULT_VISIBLE_RANGE[0], DEFAULT_VISIBLE_RANGE[1]];
  private zoom = NaN;
  private limitWarned = false;
  /** Coats whose domain() or pack() failed (reported once). */
  private readonly failed = new Set<string>();

  constructor() {
    this.data = new Uint8Array(RAMP_WIDTH * MAX_COATS * 4);
    this.texture = new DataTexture(this.data, RAMP_WIDTH, MAX_COATS, RGBAFormat, UnsignedByteType);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = NoColorSpace;
    this.texture.needsUpdate = true;
  }

  get width(): number { return RAMP_WIDTH; }
  get height(): number { return MAX_COATS; }

  /** The packed coats that are drawn, bottom first. */
  get packed(): readonly PackedCoat[] {
    return this.packedCoats;
  }

  /** Visible elevation range used for 'auto' and derived domains. */
  get autoDomain(): [number, number] {
    return [this.autoRange[0], this.autoRange[1]];
  }

  /** Whether any coat's domain depends on the visible elevation range. */
  get needsAutoRange(): boolean {
    return this.inputs.some((c) => typeof c.domain !== 'object');
  }

  /** Ids of the coats drawn (in their zoom range, opacity above 0, within MAX_COATS), bottom first. */
  get drawnIds(): string[] {
    return this.drawn.map((i) => this.inputs[i].id);
  }

  /** Whether a drawn coat reads the terrain shadow map. */
  get needsShadows(): boolean {
    return this.drawn.some((i) => this.inputs[i].shadowMap === true);
  }

  /** Replace the stack (bottom first). */
  set(coats: readonly CoatInput[]): void {
    this.inputs = coats.slice();
    this.domains = this.inputs.map((c) => this.resolveDomain(c));
    this.repack();
  }

  /** Current map zoom (coats outside their zoom range are not drawn). Returns true when the drawn coats changed. */
  setZoom(zoom: number): boolean {
    if (zoom === this.zoom) return false;
    const before = this.drawn.join(',');
    this.zoom = zoom;
    if (this.selectDrawn().join(',') === before) return false;
    this.repack();
    return true;
  }

  /** Update the visible elevation range; returns true when a drawn coat changed. */
  setAutoRange(min: number, max: number): boolean {
    if (this.autoRange[0] === min && this.autoRange[1] === max) return false;
    this.autoRange = [min, max];
    let changed = false;
    for (let i = 0; i < this.inputs.length; i++) {
      if (typeof this.inputs[i].domain === 'object') continue;
      // A custom analysis' domain() or pack() failing for this range keeps the coat as it was
      try {
        const d = this.resolveDomain(this.inputs[i]);
        if (sameDomain(d, this.domains[i])) continue;
        const row = this.drawn.indexOf(i);
        const packed = row >= 0 ? this.packOne(i, row, d) : null;
        this.domains[i] = d;
        if (packed) {
          this.packedCoats[row] = packed;
          changed = true;
        }
      } catch (err) {
        this.warnOnce(this.inputs[i].id, err);
      }
    }
    return changed;
  }

  private resolveDomain(c: CoatInput): [number, number] {
    if (c.domain === 'auto') return [this.autoRange[0], this.autoRange[1]];
    if (typeof c.domain === 'function') {
      const d = c.domain([this.autoRange[0], this.autoRange[1]]);
      return Number.isFinite(d[0]) && Number.isFinite(d[1]) ? [d[0], d[1]] : [0, 1];
    }
    return c.domain;
  }

  private selectDrawn(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.inputs.length; i++) {
      const c = this.inputs[i];
      if (!(c.opacity > 0)) continue;
      if (!Number.isNaN(this.zoom) && (this.zoom < (c.minZoom ?? -Infinity) || this.zoom > (c.maxZoom ?? Infinity))) continue;
      out.push(i);
    }
    if (out.length > MAX_COATS && !this.limitWarned) {
      this.limitWarned = true;
      console.warn(`treelet: only the lowest ${MAX_COATS} drawn coats are shown (${out.length} drawn)`);
    }
    return out.slice(0, MAX_COATS);
  }

  private repack(): void {
    this.drawn = this.selectDrawn();
    this.packedCoats.length = 0;
    for (let row = 0; row < this.drawn.length; row++) this.packedCoats.push(this.packOne(this.drawn[row], row));
  }

  private packOne(i: number, row: number, valueDomain = this.domains[i]): PackedCoat {
    const c = this.inputs[i];
    const domain = rampRowDomain(c.ramp, valueDomain);
    const { p0, p1 } = c.pack(domain);
    let rampRow = -1;
    if (c.ramp) {
      const key = `${JSON.stringify(c.ramp)}|${domain[0]}|${domain[1]}`;
      if (this.rowKeys[row] !== key) {
        writeRampRow(this.data, row * RAMP_WIDTH * 4, RAMP_WIDTH, c.ramp, domain);
        this.rowKeys[row] = key;
        this.texture.needsUpdate = true;
      }
      rampRow = row;
    }
    return { kind: c.kind, blendMode: c.blendMode, opacity: c.opacity, rampRow, raster: c.raster ?? -1, p0, p1 };
  }

  private warnOnce(id: string, err: unknown): void {
    if (this.failed.has(id)) return;
    this.failed.add(id);
    console.warn(`treelet: coat "${id}" failed to follow the visible range:`, (err as Error)?.message ?? err);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
