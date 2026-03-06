// ============================================================================
// treelet.js - Tile Worker
//
// Web Worker entry point exposed via Comlink. Handles:
//   1. Fetching tile images
//   2. Extracting pixel data (OffscreenCanvas)
//   3. Decoding elevation from pixels
//   4. Building displaced mesh arrays
//
// All heavy computation runs off the main thread.
// ============================================================================

import * as Comlink from 'comlink';
import {
  terrainRGBDecoder,
  terrariumDecoder,
  type ElevationDecoder,
} from '../layers/base/ElevationDecoder';
import { buildMeshArrays, type MeshArrays } from './meshBuilder';

// Built-in decoder lookup (workers can't share the main-thread registry)
const decoders: Record<string, ElevationDecoder> = {
  'terrain-rgb': terrainRGBDecoder,
  'mapbox': terrainRGBDecoder,
  'terrarium': terrariumDecoder,
};

/** Reusable OffscreenCanvas for pixel extraction (resized as needed). */
let reusableCanvas: OffscreenCanvas | null = null;
let reusableCanvasW = 0;
let reusableCanvasH = 0;

/**
 * Get or create a reusable OffscreenCanvas of the given dimensions.
 */
function getCanvas(w: number, h: number): OffscreenCanvas {
  if (!reusableCanvas || reusableCanvasW !== w || reusableCanvasH !== h) {
    reusableCanvas = new OffscreenCanvas(w, h);
    reusableCanvasW = w;
    reusableCanvasH = h;
  }
  return reusableCanvas;
}

/**
 * Result of a full tile processing pipeline (fetch → decode → mesh).
 */
export interface TileProcessResult extends MeshArrays {
  elevations: Float32Array;
  elevWidth: number;
  elevHeight: number;
}

/**
 * Public API exposed to the main thread via Comlink.
 */
const api = {
  /**
   * Decode elevation from raw pixel data.
   */
  decodeElevation(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    decoderType: string,
  ): Float32Array {
    const decoder = decoders[decoderType];
    if (!decoder) throw new Error(`treelet worker: unknown decoder "${decoderType}"`);
    return decoder.decode(pixels, width, height);
  },

  /**
   * Build mesh arrays from elevation data.
   */
  buildMesh(
    elevations: Float32Array,
    elevWidth: number,
    elevHeight: number,
    segments: number,
    tileWorldSize: number,
    exaggeration: number,
    metersToScene: number,
  ): MeshArrays {
    return buildMeshArrays(
      elevations,
      elevWidth,
      elevHeight,
      segments,
      tileWorldSize,
      exaggeration,
      metersToScene,
    );
  },

  /**
   * Full pipeline: fetch tile image → extract pixels → decode elevation → build mesh.
   *
   * This runs entirely in the worker, keeping the main thread free.
   * Returns typed arrays that can be transferred (zero-copy) to main thread.
   */
  async fetchDecodeAndBuild(
    url: string,
    decoderType: string,
    segments: number,
    tileWorldSize: number,
    exaggeration: number,
    metersToScene: number,
  ): Promise<TileProcessResult> {
    // 1. Fetch tile image
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`treelet worker: fetch failed for ${url} (${response.status})`);
    }

    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    // 2. Extract pixel data via reusable OffscreenCanvas
    const w = imageBitmap.width;
    const h = imageBitmap.height;
    const canvas = getCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    imageBitmap.close();

    // 3. Decode elevation
    const decoder = decoders[decoderType];
    if (!decoder) throw new Error(`treelet worker: unknown decoder "${decoderType}"`);
    const elevations = decoder.decode(imageData.data, w, h);

    // 4. Build mesh arrays
    const mesh = buildMeshArrays(
      elevations,
      w,
      h,
      segments,
      tileWorldSize,
      exaggeration,
      metersToScene,
    );

    // Return with Comlink.transfer for zero-copy ArrayBuffer transfer
    const result: TileProcessResult = {
      elevations,
      elevWidth: w,
      elevHeight: h,
      ...mesh,
    };

    return Comlink.transfer(result, [
      result.elevations.buffer,
      result.positions.buffer,
      result.normals.buffer,
      result.uvs.buffer,
      result.indices.buffer,
    ]);
  },
};

/** Type of the worker API (imported by WorkerPool for typing). */
export type TileWorkerAPI = typeof api;

Comlink.expose(api);
