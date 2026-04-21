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

// Built-in decoder lookup. The main-thread registry doesn't cross the worker
// boundary, so non-built-in decoders arrive as source strings (see below).
const decoders: Record<string, ElevationDecoder> = {
  'terrain-rgb': RawRGBDecoder,
  'mapbox': RawRGBDecoder,
  'terrarium': TerrariumDecoder,
};

/**
 * Cache of compiled custom decoders, keyed by source string. Multiple fetches
 * using the same decoder source share a single compiled function.
 */
const compiledDecoders = new Map<string, ElevationDecoder>();

/**
 * Compile a decoder function from its source string and cache it.
 *
 * Uses `new Function` (not `eval`) to compile in the global scope, so the
 * decoder is isolated from worker internals. Decoders must be pure
 * (no closure captures) — they run with access only to their three
 * arguments.
 */
function compileDecoder(source: string): ElevationDecoder {
  const cached = compiledDecoders.get(source);
  if (cached) return cached;
  // Wrap the source as an expression body so it works for both
  // arrow functions and `function` declarations.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(
    'pixels',
    'width',
    'height',
    `return (${source})(pixels, width, height);`,
  ) as ElevationDecoder;
  compiledDecoders.set(source, fn);
  return fn;
}

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
    decoderSource?: string,
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

    // 3. Decode elevation: built-ins via local map; anything else via
    //    on-demand compile from the source string shipped by BaseLayer.
    let decoder: ElevationDecoder | undefined = decoders[decoderType];
    if (!decoder && decoderSource) {
      decoder = compileDecoder(decoderSource);
    }
    if (!decoder) {
      throw new Error(
        `treelet worker: unknown decoder "${decoderType}" ` +
        `(no built-in match and no decoderSource provided)`,
      );
    }
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
