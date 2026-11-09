// ============================================================================
// Tests for region loading in src/workers/tileWorker.ts (analysis worker)
//
// The worker API is captured from Comlink.expose; fetch, createImageBitmap
// and OffscreenCanvas are stubbed, so tiles "decode" to a flat 100 m. Each
// test imports a fresh worker module (its caches are module state).
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RegionAnalysisRequest, RegionAnalysisResponse, RegionSpec } from '../../src/workers/protocol';
import type { TileWorkerAPI } from '../../src/workers/tileWorker';

const hoisted = vi.hoisted(() => ({
  expose: vi.fn(),
  /** Signals of the region loads started (one per loadRegionTiles call). */
  regionLoads: [] as AbortSignal[],
}));

vi.mock('comlink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('comlink')>()),
  expose: hoisted.expose,
}));

vi.mock('../../src/analysis/compute/region', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analysis/compute/region')>();
  return {
    ...actual,
    loadRegionTiles: ((refs, load, options) => {
      hoisted.regionLoads.push(options?.signal as AbortSignal);
      return actual.loadRegionTiles(refs, load, options);
    }) as typeof actual.loadRegionTiles,
  };
});

const TILE = 4;
const ELEVATION = 100;

// ---------------------------------------------------------------------------
// Stubbed tile server
// ---------------------------------------------------------------------------

/** HTTP status per URL (default 200). */
let statuses: Map<string, number>;
let fetchCalls: Array<{ url: string; signal: AbortSignal }>;
/** While set, fetches wait for it (or for their abort). */
let gate: Promise<void> | null;
let openGate: () => void;

function closeGate(): void {
  gate = new Promise<void>((resolve) => { openGate = resolve; });
}

function abortError(): DOMException {
  return new DOMException('aborted', 'AbortError');
}

function waitForGate(signal: AbortSignal): Promise<void> {
  if (!gate) return Promise.resolve();
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
    gate!.then(resolve);
  });
}

const fetchStub = vi.fn(async (url: string, init: { signal: AbortSignal }) => {
  fetchCalls.push({ url, signal: init.signal });
  await waitForGate(init.signal);
  const status = statuses.get(url) ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: '',
    blob: async () => new Blob(status === 200 ? [new Uint8Array(16)] : []),
  };
});

/** 2D context whose pixels decode (Terrarium) to ELEVATION everywhere. */
class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return {
      clearRect() {},
      drawImage() {},
      getImageData(_x: number, _y: number, w: number, h: number) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          data[i * 4] = 128;
          data[i * 4 + 1] = ELEVATION;
          data[i * 4 + 3] = 255;
        }
        return { data };
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let api: TileWorkerAPI;
let nextId = 1;

/** A row of tiles at zoom 10 covering exactly the window. */
function region(key: string, urls: string[]): RegionSpec {
  return {
    key,
    zoom: 10,
    tiles: urls.map((url, i) => ({ x: i, y: 0, url })),
    window: { x0: 0, y0: 0, x1: urls.length, y1: 1 },
    decoderType: 'terrarium',
  };
}

type ProgressLog = Array<[string, number]>;

/** Start a load-only job; its progress goes to `log`. */
function analyze(spec: RegionSpec, log: ProgressLog = []): { id: number; result: Promise<RegionAnalysisResponse> } {
  const req: RegionAnalysisRequest = { id: nextId++, region: spec, centerLat: 46, task: null, returnGrid: true };
  return { id: req.id, result: api.analyzeRegion(req, (stage, fraction) => { log.push([stage, fraction]); }) };
}

function fetchesOf(url: string): number {
  return fetchCalls.filter((c) => c.url === url).length;
}

function loadingEvents(log: ProgressLog): number {
  return log.filter(([stage]) => stage === 'loading').length;
}

/** NaN cells of the grid (nodata). */
function holes(r: RegionAnalysisResponse): number {
  return r.grid!.filter((v) => Number.isNaN(v)).length;
}

/** Settle the job, turning a rejection into a value so it is never unhandled. */
function settle<T>(p: Promise<T>): Promise<T | Error> {
  return p.catch((e: Error) => e);
}

beforeEach(async () => {
  statuses = new Map();
  fetchCalls = [];
  gate = null;
  hoisted.regionLoads.length = 0;
  hoisted.expose.mockClear();
  fetchStub.mockClear();
  vi.stubGlobal('fetch', fetchStub);
  vi.stubGlobal('createImageBitmap', async () => ({ width: TILE, height: TILE, close() {} }));
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.resetModules();
  await import('../../src/workers/tileWorker');
  api = hoisted.expose.mock.calls[0][0] as TileWorkerAPI;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analysis worker: region grid cache', () => {
  it('returns the coverage counts of a cached grid', async () => {
    statuses.set('t/b', 404);
    const spec = region('r', ['t/a', 't/b']);

    const first = await analyze(spec).result;
    expect(first).toMatchObject({ missing: 1, failed: 0, width: 2 * TILE, height: TILE });
    expect(holes(first)).toBe(TILE * TILE);

    const log: ProgressLog = [];
    const second = await analyze(spec, log).result;
    expect(loadingEvents(log)).toBe(0); // served from the cache
    expect(second).toMatchObject({ missing: 1, failed: 0 });
    expect(holes(second)).toBe(TILE * TILE);
  });

  it('serves a grid whose only gaps are missing (404) tiles from the cache', async () => {
    statuses.set('t/b', 404);
    const spec = region('r', ['t/a', 't/b']);
    await analyze(spec).result;
    expect(hoisted.regionLoads).toHaveLength(1);

    const log: ProgressLog = [];
    await analyze(spec, log).result;
    expect(hoisted.regionLoads).toHaveLength(1);
    expect(loadingEvents(log)).toBe(0);
    expect(fetchCalls).toHaveLength(2);
  });

  it('does not keep a grid with failed tiles: the next job retries them', async () => {
    vi.useFakeTimers();
    statuses.set('t/b', 500);
    const spec = region('r', ['t/a', 't/b']);

    const job = analyze(spec).result;
    await vi.advanceTimersByTimeAsync(5000); // retry backoff
    const first = await job;
    expect(first).toMatchObject({ missing: 0, failed: 1 });
    expect(holes(first)).toBe(TILE * TILE);
    expect(fetchesOf('t/b')).toBe(3); // first attempt + 2 retries

    // The source recovers: the next job loads the region again
    statuses.set('t/b', 200);
    const log: ProgressLog = [];
    const second = await analyze(spec, log).result;
    expect(hoisted.regionLoads).toHaveLength(2);
    expect(fetchesOf('t/b')).toBe(4);
    expect(fetchesOf('t/a')).toBe(1); // the decoded tile was reused
    expect(loadingEvents(log)).toBeGreaterThan(0);
    expect(second).toMatchObject({ missing: 0, failed: 0 });
    expect(holes(second)).toBe(0);
    expect(second.min).toBe(ELEVATION);

    // Complete now, so it is cached
    const third = await analyze(spec).result;
    expect(hoisted.regionLoads).toHaveLength(2);
    expect(third).toMatchObject({ missing: 0, failed: 0 });
  });

  it('keeps the two most recently used grids', async () => {
    const a = region('a', ['a/0']);
    const b = region('b', ['b/0']);
    const c = region('c', ['c/0']);
    await analyze(a).result;
    await analyze(b).result;
    await analyze(a).result; // hit: a becomes the most recent
    await analyze(c).result; // evicts b
    expect(hoisted.regionLoads).toHaveLength(3);
    await analyze(a).result;
    await analyze(c).result;
    expect(hoisted.regionLoads).toHaveLength(3);
    await analyze(b).result;
    expect(hoisted.regionLoads).toHaveLength(4);
  });
});

describe('analysis worker: shared region loads', () => {
  it('loads a region once for concurrent jobs and reports progress to each', async () => {
    closeGate();
    const spec = region('r', ['t/a', 't/b']);
    const logA: ProgressLog = [];
    const logB: ProgressLog = [];
    const jobA = analyze(spec, logA);
    const jobB = analyze(spec, logB);
    openGate();
    const [a, b] = await Promise.all([jobA.result, jobB.result]);

    expect(hoisted.regionLoads).toHaveLength(1);
    expect(fetchCalls).toHaveLength(2);
    for (const r of [a, b]) {
      expect(r).toMatchObject({ missing: 0, failed: 0, min: ELEVATION, max: ELEVATION });
      expect(holes(r)).toBe(0);
    }
    for (const log of [logA, logB]) {
      expect(log.filter(([stage]) => stage === 'loading').map(([, f]) => f)).toEqual([0.5, 1]);
    }
  });

  it('keeps a shared load alive while another job still waits for it', async () => {
    closeGate();
    const spec = region('r', ['t/a', 't/b']);
    const logA: ProgressLog = [];
    const logB: ProgressLog = [];
    const jobA = analyze(spec, logA);
    const jobB = analyze(spec, logB);
    const settledA = settle(jobA.result);

    api.cancel(jobA.id);
    expect(await settledA).toMatchObject({ name: 'AbortError' });
    expect(hoisted.regionLoads).toHaveLength(1);
    expect(hoisted.regionLoads[0].aborted).toBe(false);
    expect(fetchCalls.every((c) => !c.signal.aborted)).toBe(true);

    openGate();
    const b = await jobB.result;
    expect(b).toMatchObject({ missing: 0, failed: 0 });
    expect(holes(b)).toBe(0);
    expect(loadingEvents(logB)).toBe(2);
    expect(logA).toEqual([]); // the cancelled job hears nothing more
    expect(hoisted.regionLoads).toHaveLength(1);
  });

  it('aborts a load when every job cancels and leaves nothing behind', async () => {
    closeGate();
    const spec = region('r', ['t/a', 't/b']);
    const logA: ProgressLog = [];
    const logB: ProgressLog = [];
    const jobA = analyze(spec, logA);
    const jobB = analyze(spec, logB);
    const settledA = settle(jobA.result);
    const settledB = settle(jobB.result);

    api.cancel(jobA.id);
    api.cancel(jobB.id);
    expect(hoisted.regionLoads[0].aborted).toBe(true);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls.every((c) => c.signal.aborted)).toBe(true);

    // A job arriving right away starts a fresh load rather than joining the aborted one
    const logC: ProgressLog = [];
    const jobC = analyze(spec, logC);
    expect(hoisted.regionLoads).toHaveLength(2);
    expect(hoisted.regionLoads[1].aborted).toBe(false);

    expect(await settledA).toMatchObject({ name: 'AbortError' });
    expect(await settledB).toMatchObject({ name: 'AbortError' });
    openGate();
    const c = await jobC.result;
    expect(c).toMatchObject({ missing: 0, failed: 0 });
    expect(holes(c)).toBe(0);
    expect(fetchCalls).toHaveLength(4);
    expect(loadingEvents(logC)).toBe(2);
    expect(logA).toEqual([]);
    expect(logB).toEqual([]);

    // And it was cached as usual
    await analyze(spec).result;
    expect(hoisted.regionLoads).toHaveLength(2);
  });

  it('gives a job after a cancelled one a fresh load and its own progress', async () => {
    closeGate();
    const spec = region('r', ['t/a']);
    const job = analyze(spec);
    const settled = settle(job.result);
    api.cancel(job.id);
    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(fetchCalls[0].signal.aborted).toBe(true);

    openGate();
    const log: ProgressLog = [];
    const r = await analyze(spec, log).result;
    expect(r).toMatchObject({ missing: 0, failed: 0 });
    expect(hoisted.regionLoads).toHaveLength(2);
    expect(log).toEqual([['loading', 1]]);
  });
});
