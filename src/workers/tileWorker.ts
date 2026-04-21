// ============================================================================
// treelet.js - Tile Worker
//
// Web Worker entry point exposed via Comlink. Handles:
//   1. Fetching tile images (URL-based)
//   2. Extracting pixel data (OffscreenCanvas)
//   3. Decoding elevation from pixels
//
// All heavy computation runs off the main thread.
// ============================================================================

import * as Comlink from 'comlink';
import {
  RawRGBDecoder,
  TerrariumDecoder,
  type ElevationDecoder,
} from '../decoders/ElevationDecoder';

// Built-in decoder lookup (workers can't share the main-thread registry)
const decoders: Record<string, ElevationDecoder> = {
  'terrain-rgb': RawRGBDecoder,
  'mapbox': RawRGBDecoder,
  'terrarium': TerrariumDecoder,
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
 * Public API exposed to the main thread via Comlink.
 */
const api = {
  /**
   * Elevation-only: fetch URL tile → decode → return Float32Array (no mesh building).
   * Used by the terrain renderer for VTF heightmap updates.
   */
  async fetchDecodeElevation(
    url: string,
    decoderType: string,
  ): Promise<{ elevations: Float32Array; width: number; height: number }> {
    // 1. Fetch tile image
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`treelet worker: fetch failed for ${url} (${response.status})`);
    }

    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    // 2. Extract pixel data
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
    const elevations = decoder(imageData.data, w, h);

    return Comlink.transfer(
      { elevations, width: w, height: h },
      [elevations.buffer],
    );
  },
};

/** Type of the worker API (imported by WorkerPool for typing). */
export type TileWorkerAPI = typeof api;

Comlink.expose(api);
