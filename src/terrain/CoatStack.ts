// ============================================================================
// treelet.js - Coat Stack
//
// Packs the visible coats (imagery and analysis layers) into what the
// shader consumes: per-coat uniforms and one ramp-texture row per coat.
// Coats whose value domain is 'auto' follow the visible elevation range,
// which the renderer reports every frame.
// ============================================================================

import { DataTexture, NearestFilter, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType, NoColorSpace } from 'three';
import type { CoatBlendMode, RampSpec, Vec4 } from '../analysis/types';
import { MAX_COATS } from '../analysis/registry';
import { RAMP_WIDTH, writeRampRow } from '../analysis/ramps';
import type { PackedCoat } from '../shaders/TerrainMaterial';

/** A coat as the display layer hands it over. */
export interface CoatInput {
  id: string;
  kind: number;
  blendMode: CoatBlendMode;
  opacity: number;
  /** Resolved ramp for value kinds; null for color kinds. */
  ramp: RampSpec | null;
  /** Value domain the ramp spans; 'auto' = the visible elevation range. */
  domain: [number, number] | 'auto';
  /** Raster slot the coat draws, or -1 (default). */
  raster?: number;
  pack: (domain: [number, number]) => { p0: Vec4; p1: Vec4 };
}

export class CoatStack {
  /** RAMP_WIDTH × MAX_COATS RGBA8, row i = coat i. */
  readonly texture: DataTexture;
  private readonly data: Uint8Array;
  private inputs: CoatInput[] = [];
  private readonly packedCoats: PackedCoat[] = [];
  private autoRange: [number, number] = [0, 4000];
  private hasAuto = false;

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

  /** The packed coats, bottom first. */
  get packed(): readonly PackedCoat[] {
    return this.packedCoats;
  }

  /** Visible elevation range used for 'auto' domains. */
  get autoDomain(): [number, number] {
    return [this.autoRange[0], this.autoRange[1]];
  }

  /** Whether any coat follows the visible elevation range. */
  get needsAutoRange(): boolean {
    return this.hasAuto;
  }

  /** Replace the stack (bottom first; beyond MAX_COATS is dropped). */
  set(coats: readonly CoatInput[]): void {
    this.inputs = coats.slice(0, MAX_COATS);
    this.hasAuto = this.inputs.some((c) => c.domain === 'auto');
    this.packedCoats.length = 0;
    for (let i = 0; i < this.inputs.length; i++) this.packedCoats.push(this.packOne(i));
  }

  /** Update the visible elevation range; returns true when a coat changed. */
  setAutoRange(min: number, max: number): boolean {
    if (this.autoRange[0] === min && this.autoRange[1] === max) return false;
    this.autoRange = [min, max];
    if (!this.hasAuto) return false;
    for (let i = 0; i < this.inputs.length; i++) {
      if (this.inputs[i].domain === 'auto') this.packedCoats[i] = this.packOne(i);
    }
    return true;
  }

  private packOne(i: number): PackedCoat {
    const c = this.inputs[i];
    const domain = c.domain === 'auto' ? this.autoRange : c.domain;
    const { p0, p1 } = c.pack(domain);
    let rampRow = -1;
    if (c.ramp) {
      writeRampRow(this.data, i * RAMP_WIDTH * 4, RAMP_WIDTH, c.ramp, domain);
      this.texture.needsUpdate = true;
      rampRow = i;
    }
    return { kind: c.kind, blendMode: c.blendMode, opacity: c.opacity, rampRow, raster: c.raster ?? -1, p0, p1 };
  }

  dispose(): void {
    this.texture.dispose();
  }
}
