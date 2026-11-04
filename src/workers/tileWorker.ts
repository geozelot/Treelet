// ============================================================================
// treelet.js - Tile Worker
//
// Web Worker entry point exposed via Comlink. Everything that touches raw
// tile bytes runs here, off the main thread:
//
//   Elevation: fetch → decode (color-managed off, alpha → nodata) →
//              resample into a corner-aligned atlas slot (+ min/max)
//   Drape:     fetch 1..16 source images → composite into one slot →
//              gamma-correct mip chain
//
// Identical in-flight URLs are fetched once (overzoomed children share their
// parent's URL) and decoded elevation rasters are kept in a small LRU, so a
// parent tile is decoded once no matter how many children need it.
// Every request can be cancelled by id.
// ============================================================================

import * as Comlink from 'comlink';
import {
  RawRGBDecoder,
  TerrariumDecoder,
  type ElevationDecoder,
} from '../decoders/ElevationDecoder';
import { applyAlphaNodata, buildMipChain, hashString, resampleElevation } from './raster';
import {
  EMPTY_TILE_STATUSES,
  type DrapeRequest,
  type DrapeResponse,
  type ElevationRequest,
  type ElevationResponse,
  type TileRequestInit,
} from './protocol';

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

// Built-in decoder lookup. The main-thread registry doesn't cross the worker
// boundary, so non-built-in decoders arrive as source strings.
const builtinDecoders: Record<string, ElevationDecoder> = {
  'terrain-rgb': RawRGBDecoder,
  'mapbox': RawRGBDecoder,
  'terrarium': TerrariumDecoder,
};

/** Compiled custom decoders, keyed by source string. */
const compiledDecoders = new Map<string, ElevationDecoder>();

/**
 * Compile a decoder function from its source string and cache it.
 *
 * Uses `new Function` (global scope, no access to worker internals), so
 * decoders must be pure. Accepts arrow functions, `function` expressions
 * and object-method shorthand (`decode(p, w, h) { ... }`).
 */
function compileDecoder(source: string): ElevationDecoder {
  const cached = compiledDecoders.get(source);
  if (cached) return cached;
  let expr = source.trim();
  if (!/^(async\s+)?function\b/.test(expr) && !/=>/.test(expr.split('{')[0]) &&
      /^[A-Za-z_$][\w$]*\s*\(/.test(expr)) {
    expr = `function ${expr}`;
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(
    'pixels',
    'width',
    'height',
    `return (${expr})(pixels, width, height);`,
  ) as ElevationDecoder;
  compiledDecoders.set(source, fn);
  return fn;
}

function resolveDecoder(type: string, source?: string): ElevationDecoder {
  const builtin = builtinDecoders[type];
  if (builtin) return builtin;
  if (source) return compileDecoder(source);
  throw new Error(`treelet worker: unknown decoder "${type}" (no built-in match and no decoderSource provided)`);
}

// ---------------------------------------------------------------------------
// Cancellation helpers
// ---------------------------------------------------------------------------

function abortError(): DOMException {
  return new DOMException('Request cancelled', 'AbortError');
}

/** Reject as soon as `signal` aborts, otherwise settle with `promise`. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

/** Marker for tiles the server reports as nonexistent (404/410/204/empty body). */
class EmptyTile {
  constructor(readonly status: number) {}
}

interface SharedLoad<T> {
  promise: Promise<T>;
  controller: AbortController;
  refs: number;
}

/**
 * Load `url` once for all concurrent requesters. The underlying fetch is
 * aborted only when every requester has cancelled.
 */
function sharedLoad<T>(
  inflight: Map<string, SharedLoad<T>>,
  url: string,
  loader: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let entry = inflight.get(url);
  if (!entry) {
    const controller = new AbortController();
    const promise = loader(controller.signal);
    const created: SharedLoad<T> = { promise, controller, refs: 0 };
    // Requesters observe the result through raceAbort; swallow here so an
    // all-cancelled load doesn't surface as an unhandled rejection.
    promise.catch(() => {}).finally(() => {
      if (inflight.get(url) === created) inflight.delete(url);
    });
    inflight.set(url, created);
    entry = created;
  }
  const shared = entry;
  shared.refs++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    shared.refs--;
    if (shared.refs <= 0 && inflight.get(url) === shared) {
      inflight.delete(url);
      shared.controller.abort();
    }
  };
  signal.addEventListener('abort', release, { once: true });
  return raceAbort(shared.promise, signal).finally(() => {
    signal.removeEventListener('abort', release);
    released = true;
  });
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

/** Byte-bounded LRU (Map insertion order = recency). */
class LruCache<V> {
  private readonly map = new Map<string, V>();
  private bytes = 0;
  constructor(private readonly maxBytes: number, private readonly sizeOf: (v: V) => number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.bytes -= this.sizeOf(old);
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += this.sizeOf(value);
    for (const [k, v] of this.map) {
      if (this.bytes <= this.maxBytes || this.map.size <= 1) break;
      this.map.delete(k);
      this.bytes -= this.sizeOf(v);
    }
  }
}

interface DecodedElevation {
  data: Float32Array;
  w: number;
  h: number;
}

/** Decoded elevation rasters (per worker). Overzoomed children reuse their parent. */
const elevationCache = new LruCache<DecodedElevation | EmptyTile>(
  24 * 1024 * 1024,
  (v) => (v instanceof EmptyTile ? 64 : v.data.byteLength),
);
const elevationInflight = new Map<string, SharedLoad<DecodedElevation | EmptyTile>>();

/** Encoded drape images (Blobs are immutable, so sharing them is safe). */
const drapeBlobCache = new LruCache<Blob | EmptyTile>(
  16 * 1024 * 1024,
  (v) => (v instanceof EmptyTile ? 64 : v.size),
);
const drapeInflight = new Map<string, SharedLoad<Blob | EmptyTile>>();

/** Active request controllers by id (for cancel()). */
const requestControllers = new Map<number, AbortController>();

// ---------------------------------------------------------------------------
// Fetch + pixel access
// ---------------------------------------------------------------------------

async function fetchBlob(url: string, init: TileRequestInit | undefined, signal: AbortSignal): Promise<Blob | EmptyTile> {
  const response = await fetch(url, {
    signal,
    mode: 'cors',
    headers: init?.headers,
    credentials: init?.credentials,
    referrerPolicy: init?.referrerPolicy,
  });
  if (EMPTY_TILE_STATUSES.has(response.status)) return new EmptyTile(response.status);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }
  const blob = await response.blob();
  if (blob.size === 0) return new EmptyTile(response.status);
  return blob;
}

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

/** Reusable CPU-backed 2D context (willReadFrequently avoids GPU readbacks). */
function getContext(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!canvas) {
    canvas = new OffscreenCanvas(w, h);
    context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('treelet worker: 2D canvas context unavailable');
  } else if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return context!;
}

async function loadDecodedElevation(
  cacheKey: string,
  url: string,
  decoderType: string,
  decoderSource: string | undefined,
  init: TileRequestInit | undefined,
  signal: AbortSignal,
): Promise<DecodedElevation | EmptyTile> {
  const blob = await fetchBlob(url, init, signal);
  if (blob instanceof EmptyTile) {
    elevationCache.set(cacheKey, blob);
    return blob;
  }

  // Encoded DEM pixels are data, not color: disable color management and
  // premultiplication so RGB values reach the decoder bit-exact.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch (e) {
    throw new Error(`could not decode image (${blob.type || 'unknown type'}, ${blob.size} bytes): ${(e as Error).message}`);
  }

  const w = bitmap.width;
  const h = bitmap.height;
  const ctx = getContext(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' }).data;
  bitmap.close();

  const decoder = resolveDecoder(decoderType, decoderSource);
  const elevations = decoder(pixels, w, h);
  if (!(elevations instanceof Float32Array) || elevations.length !== w * h) {
    throw new Error(
      `decoder "${decoderType}" must return a Float32Array of length ${w * h}, ` +
      `got ${elevations?.constructor?.name ?? typeof elevations} of length ${(elevations as { length?: number })?.length}`,
    );
  }
  applyAlphaNodata(pixels, elevations);

  const decoded = { data: elevations, w, h };
  elevationCache.set(cacheKey, decoded);
  return decoded;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const api = {
  /**
   * Fetch, decode and resample one elevation tile into an atlas slot.
   * Resolves `{ status: 'empty' }` for tiles the server reports as missing;
   * rejects for network/HTTP/decode errors (the caller backs off and retries).
   */
  async loadElevation(req: ElevationRequest): Promise<ElevationResponse> {
    const controller = new AbortController();
    requestControllers.set(req.id, controller);
    try {
      // Decoded rasters depend on the decoder too: two layers may share a URL.
      const cacheKey = `${req.decoderType}:${req.decoderSource ? hashString(req.decoderSource) : ''}:${req.url}`;
      let decoded = elevationCache.get(cacheKey);
      if (!decoded) {
        decoded = await sharedLoad(
          elevationInflight,
          cacheKey,
          (signal) => loadDecodedElevation(cacheKey, req.url, req.decoderType, req.decoderSource, req.init, signal),
          controller.signal,
        );
      }
      if (decoded instanceof EmptyTile) return { status: 'empty', httpStatus: decoded.status };

      const out = new Float32Array(req.size * req.size);
      const stats = resampleElevation(decoded.data, decoded.w, decoded.h, req.size, req.region, out);
      const texelsPerPixel = (req.size - 1) / Math.max(1e-9, Math.min(
        (req.region?.w ?? 1) * decoded.w,
        (req.region?.h ?? 1) * decoded.h,
      ));
      return Comlink.transfer(
        { status: 'ok' as const, data: out, min: stats.min, max: stats.max, texelsPerPixel },
        [out.buffer],
      );
    } finally {
      requestControllers.delete(req.id);
    }
  },

  /**
   * Fetch and composite drape imagery into one slot with a full mip chain.
   * Parts that 404 are left transparent; resolves `{ status: 'empty' }` when
   * every part is missing.
   */
  async loadDrape(req: DrapeRequest): Promise<DrapeResponse> {
    const controller = new AbortController();
    requestControllers.set(req.id, controller);
    try {
      const blobs = await Promise.all(req.parts.map((part) => {
        const cached = drapeBlobCache.get(part.url);
        if (cached) return Promise.resolve(cached);
        return sharedLoad(drapeInflight, part.url, async (signal) => {
          const result = await fetchBlob(part.url, req.init, signal);
          drapeBlobCache.set(part.url, result);
          return result;
        }, controller.signal);
      }));
      if (blobs.every((b) => b instanceof EmptyTile)) return { status: 'empty' };

      const bitmaps = await Promise.all(blobs.map(async (b) => {
        if (b instanceof EmptyTile) return null;
        try {
          return await createImageBitmap(b);
        } catch (e) {
          throw new Error(`could not decode image (${b.type || 'unknown type'}, ${b.size} bytes): ${(e as Error).message}`);
        }
      }));
      if (controller.signal.aborted) {
        for (const bmp of bitmaps) bmp?.close();
        throw abortError();
      }

      const size = req.size;
      const ctx = getContext(size, size);
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (let i = 0; i < req.parts.length; i++) {
        const bmp = bitmaps[i];
        if (!bmp) continue;
        const part = req.parts[i];
        const crop = part.crop;
        // Fractional source rectangles are fine for drawImage, so deep
        // overzoom (crop < 1 source pixel) still produces a valid result.
        const sx = crop ? crop.x * bmp.width : 0;
        const sy = crop ? crop.y * bmp.height : 0;
        const sw = crop ? crop.w * bmp.width : bmp.width;
        const sh = crop ? crop.h * bmp.height : bmp.height;
        ctx.drawImage(bmp, sx, sy, sw, sh, part.dx, part.dy, part.dSize, part.dSize);
        bmp.close();
      }

      const image = ctx.getImageData(0, 0, size, size);
      const level0 = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
      const levels = buildMipChain(level0, size);
      return Comlink.transfer({ status: 'ok' as const, levels }, levels.map((l) => l.buffer as ArrayBuffer));
    } finally {
      requestControllers.delete(req.id);
    }
  },

  /** Cancel an in-flight request. Shared fetches abort once no requester remains. */
  cancel(id: number): void {
    requestControllers.get(id)?.abort();
  },
};

/** Type of the worker API (imported by WorkerPool for typing). */
export type TileWorkerAPI = typeof api;

Comlink.expose(api);
