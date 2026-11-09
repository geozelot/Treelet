// ============================================================================
// Tests for src/core/AnalysisController.ts with a mocked worker pool: the
// requests it builds, job events and cancellation, and the result layers.
// ============================================================================

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { AnalysisController, type AnalysisControllerDeps } from '../../src/core/AnalysisController';
import { registerBuiltinAnalyses } from '../../src/analysis/builtins';
import { tileX, tileY, lngOfTileX, latOfTileY } from '../../src/analysis/region';
import type { RegionAnalysisRequest, RegionAnalysisResponse, RegionProgress } from '../../src/workers/protocol';

beforeAll(() => registerBuiltinAnalyses());

const innsbruck = { west: 11.3, east: 11.5, south: 47.2, north: 47.35 };

function response(req: RegionAnalysisRequest, outputs: Record<string, Float32Array> = {}, stats: Record<string, number> = {}): RegionAnalysisResponse {
  const T = 256;
  const z = req.region.zoom;
  const px0 = Math.floor(req.region.window.x0 * T);
  const py0 = Math.floor(req.region.window.y0 * T);
  return {
    width: 4, height: 2, tileSize: T, zoom: z, px0, py0, cellSize: 25, min: 500, max: 2500,
    missing: 1, failed: 0, outputs, stats,
    grid: req.returnGrid ? new Float32Array(8).fill(700) : undefined,
  };
}

function setup(
  analyze?: (req: RegionAnalysisRequest, onProgress?: RegionProgress) => Promise<RegionAnalysisResponse>,
  { freeSlots = 4, stack = [] as Array<{ id: string; descriptor: { raster: boolean } }> } = {},
) {
  const base = {
    id: 'base-0', minZoom: 0, maxZoom: 22, decoderType: 'terrarium', decoderSource: null,
    source: { minZoom: 0, maxZoom: 14, ensureReady: vi.fn(async () => {}), getRequestInit: () => undefined },
    getTileUrl: (c: { z: number; x: number; y: number }) => `https://dem/${c.z}/${c.x}/${c.y}.png`,
  };
  const events: Array<[string, Record<string, unknown>]> = [];
  const workerPool = {
    analyzeRegion: vi.fn(analyze ?? (async (req: RegionAnalysisRequest, onProgress?: RegionProgress) => {
      onProgress?.('loading', 0.5);
      onProgress?.('computing', 1);
      return response(req, { visible: new Float32Array([1, 1, 0, 0, 1, NaN, 0, 1]), hours: new Float32Array(8), firstSun: new Float32Array(8), lastSun: new Float32Array(8), skyview: new Float32Array(8).fill(0.8), tpi: new Float32Array(8) }, { visibleCells: 4, observerElevation: 1800, daylight: 9.25 });
    })),
    cancelAnalysis: vi.fn(),
  };
  const layers = [...stack];
  const layerController = {
    addRasterLayer: vi.fn((opts: { analysis: string }) => {
      const layer = { id: `layer-${opts.analysis}`, layerName: opts.analysis, descriptor: { raster: true } };
      layers.push(layer);
      return { id: layer.id, layerName: layer.layerName };
    }),
    removeAnalysisLayer: vi.fn((id: string) => {
      const i = layers.findIndex((l) => l.id === id);
      if (i >= 0) layers.splice(i, 1);
      return i >= 0;
    }),
    moveLayer: vi.fn((h: { id: string }, index: number) => {
      const i = layers.findIndex((l) => l.id === h.id);
      const [l] = layers.splice(i, 1);
      layers.splice(index, 0, l);
      return true;
    }),
  };
  const deps = {
    workerPool,
    layerRegistry: {
      getActiveBaseLayer: () => base,
      getAnalysisLayer: (h: string | { id: string }) => layers.find((l) => l.id === (typeof h === 'string' ? h : h.id)),
      getStack: () => [...layers],
    },
    layerController,
    freeRasterSlots: () => freeSlots,
    emit: vi.fn((event: string, data: Record<string, unknown>) => { events.push([event, data]); }),
    toWorld: (ll: { lng: number; lat: number }) => ({ x: ll.lng * 100, y: ll.lat * 100 }),
    defaultBounds: () => innsbruck,
    sunTime: () => null,
  } as unknown as AnalysisControllerDeps;
  return { ac: new AnalysisController(deps), workerPool, layerController, events, base, layers };
}

describe('AnalysisController', () => {
  it('builds a viewshed request around the observer at the finest zoom within budget', async () => {
    const { ac, workerPool, layerController, events } = setup();
    const observer = { lng: 11.39, lat: 47.27 };
    const result = await ac.computeViewshed(observer, { radius: 5000, eyeHeight: 2 });
    const req = workerPool.analyzeRegion.mock.calls[0][0] as RegionAnalysisRequest;
    const z = req.region.zoom;
    expect(z).toBeLessThanOrEqual(14);
    expect(req.region.tiles.length).toBeLessThanOrEqual(64);
    expect(req.region.tiles[0].url).toBe(`https://dem/${z}/${req.region.tiles[0].x}/${req.region.tiles[0].y}.png`);
    expect(req.region.decoderType).toBe('terrarium');
    expect(req.centerLat).toBe(47.27);
    expect(req.task).toMatchObject({ kind: 'viewshed', options: { radius: 5000, eyeHeight: 2 } });
    const opts = (req.task as { options: { tileX: number; tileY: number } }).options;
    expect(opts.tileX).toBeCloseTo(tileX(11.39, z), 9);
    expect(opts.tileY).toBeCloseTo(tileY(47.27, z), 9);

    // Result: grid bounds from the response, a viewshed coat over them
    expect(result.bounds.west).toBeCloseTo(lngOfTileX(Math.floor(req.region.window.x0 * 256) / 256, z), 9);
    expect(result.bounds.north).toBeCloseTo(latOfTileY(Math.floor(req.region.window.y0 * 256) / 256, z), 9);
    expect(result.visibleArea).toBe(4 * 25 * 25);
    expect(result.observerElevation).toBe(1800);
    expect(result.missingTiles).toBe(1);
    expect(result.layer).toEqual({ id: 'layer-viewshed', layerName: 'viewshed' });
    const [layerOpts, raster] = layerController.addRasterLayer.mock.calls[0] as unknown as [Record<string, unknown>, { width: number; bounds: { west: number } }];
    expect(layerOpts).toMatchObject({ analysis: 'viewshed', layerName: 'Viewshed' });
    expect(raster.width).toBe(4);
    expect(raster.bounds.west).toBeCloseTo(result.bounds.west * 100, 6);

    expect(events.map(([e]) => e)).toEqual(['analysisstart', 'analysisprogress', 'analysisprogress', 'analysisend']);
    expect(events[1][1]).toMatchObject({ stage: 'loading', progress: 0.5 });
    expect(events[3][1]).toMatchObject({ kind: 'viewshed', status: 'done' });
    expect(ac.getJobs()).toEqual([]);
  });

  it('sun hours sample the day at the region center and range the ramp over the daylight', async () => {
    const { ac, workerPool, layerController } = setup();
    const result = await ac.computeSunHours({ date: new Date('2024-12-21T12:00:00Z'), stepMinutes: 30, utcOffset: 1 });
    const req = workerPool.analyzeRegion.mock.calls[0][0] as RegionAnalysisRequest;
    const task = req.task as { kind: string; options: { samples: unknown[]; stepMinutes: number } };
    expect(task.kind).toBe('sunhours');
    expect(task.options.stepMinutes).toBe(30);
    expect(task.options.samples).toHaveLength(48);
    expect(result.daylight).toBe(9.25);
    expect(layerController.addRasterLayer.mock.calls[0][0]).toMatchObject({ analysis: 'sunhours', params: { range: [0, 10] } });
  });

  it('sky view and TPI pass their radii; addLayer false returns the data only', async () => {
    const { ac, workerPool, layerController } = setup();
    const svf = await ac.computeSkyView({ radius: 800, directions: 8, addLayer: false });
    expect(workerPool.analyzeRegion.mock.calls[0][0].task).toEqual({ kind: 'skyview', options: { radius: 800, directions: 8 } });
    expect(svf.layer).toBeNull();
    expect(svf.data).toHaveLength(8);
    await ac.computeTpi({ radius: 300, innerRadius: 100 });
    expect(workerPool.analyzeRegion.mock.calls[1][0].task).toEqual({ kind: 'tpi', options: { radius: 300, innerRadius: 100 } });
    expect(layerController.addRasterLayer).toHaveBeenCalledTimes(1);
  });

  it('replaceLayer removes the earlier result once the new one is shown, in its place', async () => {
    const stack = [{ id: 'hillshade', descriptor: { raster: false } }, { id: 'analysis-3', descriptor: { raster: true } }, { id: 'contours', descriptor: { raster: false } }];
    const { ac, layerController, layers } = setup(undefined, { freeSlots: 2, stack });
    await ac.computeSkyView({ replaceLayer: 'analysis-3' });
    expect(layerController.removeAnalysisLayer).toHaveBeenCalledWith('analysis-3');
    // The old result goes only after the new one bound (it stays if that fails)
    expect(layerController.addRasterLayer.mock.invocationCallOrder[0])
      .toBeLessThan(layerController.removeAnalysisLayer.mock.invocationCallOrder[0]);
    expect(layers.map((l) => l.id)).toEqual(['hillshade', 'layer-skyview', 'contours']);
  });

  it('with every raster slot taken, the replaced result frees its slot first', async () => {
    const stack = [{ id: 'analysis-3', descriptor: { raster: true } }];
    const { ac, layerController } = setup(undefined, { freeSlots: 0, stack });
    await ac.computeTpi({ replaceLayer: 'analysis-3' });
    expect(layerController.removeAnalysisLayer.mock.invocationCallOrder[0])
      .toBeLessThan(layerController.addRasterLayer.mock.invocationCallOrder[0]);
  });

  it('with every raster slot taken and nothing to replace, it fails before loading anything', async () => {
    const { ac, workerPool, events } = setup(undefined, { freeSlots: 0 });
    await expect(ac.computeSkyView()).rejects.toThrow(/raster slot/);
    expect(workerPool.analyzeRegion).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    // Without a layer it runs
    await expect(ac.computeSkyView({ addLayer: false })).resolves.toMatchObject({ layer: null });
  });

  it("'done' means the result is shown; failing to show it ends the job with 'error'", async () => {
    const { ac, layerController, events } = setup();
    layerController.addRasterLayer.mockImplementationOnce(() => { throw new Error('treelet: raster 9000×9000 exceeds the GPU\'s texture size limit'); });
    await expect(ac.computeSkyView()).rejects.toThrow(/texture size/);
    const end = events.filter(([e]) => e === 'analysisend');
    expect(end).toHaveLength(1);
    expect(end[0][1]).toMatchObject({ status: 'error', error: expect.stringMatching(/texture size/) });
  });

  it('cancel aborts the worker request, ends the job as cancelled and rejects with an AbortError', async () => {
    let rejectCall!: (err: Error) => void;
    const { ac, workerPool, events } = setup(() => new Promise((_resolve, reject) => { rejectCall = reject; }));
    const promise = ac.computeTpi();
    await Promise.resolve();
    await Promise.resolve();
    const [job] = ac.getJobs();
    expect(job).toMatchObject({ kind: 'tpi', label: 'Topographic position', stage: 'loading' });
    expect(ac.cancel(job.id)).toBe(true);
    expect(workerPool.cancelAnalysis).toHaveBeenCalledWith(workerPool.analyzeRegion.mock.calls[0][0].id);
    rejectCall(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.at(-1)).toEqual(['analysisend', { id: job.id, kind: 'tpi', label: 'Topographic position', status: 'cancelled', error: undefined }]);
    expect(ac.getJobs()).toEqual([]);
  });

  it('a job is listed as soon as it is asked for, and cancelling it then never reaches the worker', async () => {
    const { ac, workerPool, events } = setup();
    const promise = ac.computeSkyView();
    const jobs = ac.getJobs();
    expect(jobs).toHaveLength(1);
    expect(events[0][0]).toBe('analysisstart');
    ac.cancel(jobs[0].id);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(workerPool.analyzeRegion).not.toHaveBeenCalled();
    expect(events.at(-1)?.[1]).toMatchObject({ status: 'cancelled' });
    expect(ac.getJobs()).toEqual([]);
  });

  it('an AbortSignal cancels too; errors end the job with their message', async () => {
    const { ac, events } = setup(async () => { throw new Error('treelet: no elevation tile of the region could be loaded'); });
    await expect(ac.computeSkyView()).rejects.toThrow(/no elevation tile/);
    expect(events.at(-1)?.[1]).toMatchObject({ status: 'error', error: 'treelet: no elevation tile of the region could be loaded' });

    const controller = new AbortController();
    controller.abort();
    await expect(setup().ac.computeSkyView({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('getElevationGrid returns the grid; no base layer is an error', async () => {
    const { ac, workerPool } = setup();
    const grid = await ac.getElevationGrid({ bounds: innsbruck, zoom: 10 });
    expect(workerPool.analyzeRegion.mock.calls[0][0]).toMatchObject({ task: null, returnGrid: true });
    expect(workerPool.analyzeRegion.mock.calls[0][0].region.zoom).toBe(10);
    expect(grid.data[0]).toBe(700);
    expect([grid.width, grid.height, grid.min, grid.max]).toEqual([4, 2, 500, 2500]);

    const none = new AnalysisController({ ...({} as AnalysisControllerDeps), layerRegistry: { getActiveBaseLayer: () => null } } as unknown as AnalysisControllerDeps);
    await expect(none.computeTpi()).rejects.toThrow(/active base layer/);
  });
});
