// ============================================================================
// treelet.js - Analysis Controller
//
// Region analyses: plans which elevation tiles a region needs (the finest
// zoom within a tile budget), has the analysis worker load and assemble
// them into one grid and run viewshed, sun hours, sky-view factor or TPI on
// it, and shows the result as a raster coat. Jobs report progress and can
// be cancelled; the legend shows them while they run.
// ============================================================================

import type { TileBounds, LngLat, TreeletEventMap } from './types';
import type { LayerHandle, AnalysisLayerDisplay } from '../layers/types';
import type { LayerRegistry } from '../layers/LayerRegistry';
import type { WorkerPool } from '../workers/WorkerPool';
import type { RegionAnalysisResponse, RegionTask } from '../workers/protocol';
import type { RasterInput, WorldRect } from '../terrain/RasterSet';
import type { LayerController } from './LayerController';
import { planRegion, tileX, tileY, lngOfTileX, latOfTileY, boundsAround, type RegionPlan } from '../analysis/region';
import { sunPathOfDay } from '../analysis/solar';
import { gridPercentiles } from '../analysis/grid';
import { getAnalysis } from '../analysis/registry';

/** Analyses that run on a region (the raster kinds the panel can compute). */
export const REGION_ANALYSES = ['viewshed', 'sunhours', 'skyview', 'tpi'] as const;
export type RegionAnalysisKind = typeof REGION_ANALYSES[number];

export interface RegionOptions {
  /** Area to analyse in degrees. Default: the area in view around the screen center. */
  bounds?: TileBounds;
  /** Finest zoom of the elevation tiles (default: the source's finest). */
  zoom?: number;
  /** Most elevation tiles to load (default 64; the zoom drops until the region fits). */
  maxTiles?: number;
  /** Aborts the job (the promise rejects with an AbortError). */
  signal?: AbortSignal;
}

export interface ResultLayerOptions {
  /** Show the result as a coat (default true). */
  addLayer?: boolean;
  layerName?: string;
  layerDisplay?: AnalysisLayerDisplay;
  /** A layer the result replaces (removed when the result is ready). */
  replaceLayer?: LayerHandle | string;
}

/** Where a region grid lies and how fine it is. */
export interface RegionInfo {
  /** Outer edges of the grid in degrees. */
  bounds: TileBounds;
  width: number;
  height: number;
  /** Zoom of the elevation tiles used. */
  zoom: number;
  /** Ground meters between cell centers (at the region's center). */
  cellSize: number;
  /** Elevation tiles the source doesn't have or that kept failing (no data there). */
  missingTiles: number;
}

export interface ElevationGrid extends RegionInfo {
  /** Elevations in meters, row by row from the north-west; NaN = no data. */
  data: Float32Array;
  min: number;
  max: number;
}

export interface ViewshedOptions extends RegionOptions, ResultLayerOptions {
  /** Observer's eye above the ground in meters (default 1.7). */
  eyeHeight?: number;
  /** Height above the ground of what is looked for, meters (default 0). */
  targetHeight?: number;
  /** Search radius in meters (default 10 000); also sets the default region. */
  radius?: number;
  /** Field of view in degrees (default 360) around `bearing` (degrees from north). */
  fov?: number;
  bearing?: number;
  /** Earth curvature correction (default true). */
  curvature?: boolean;
  /** Refraction coefficient (default 0.13). */
  refraction?: number;
  /** Also compute how much higher hidden ground would have to be to be seen. */
  clearance?: boolean;
}

export interface ViewshedResult extends RegionInfo {
  layer: LayerHandle | null;
  /** 1 visible, 0 hidden, NaN outside the radius / field of view. */
  visible: Float32Array;
  /** Meters hidden ground would have to rise to be seen (with `clearance`). */
  clearance: Float32Array | null;
  /** Visible ground in square meters. */
  visibleArea: number;
  /** Elevation of the observer's eye in meters. */
  observerElevation: number;
}

export interface SunHoursOptions extends RegionOptions, ResultLayerOptions {
  /** The day (default: the map's sun time, or today). */
  date?: Date;
  /** Minutes between sun positions (default 15). */
  stepMinutes?: number;
  /** Hours from UTC of the day's time zone (default: this browser's on that date). */
  utcOffset?: number;
}

export interface SunHoursResult extends RegionInfo {
  layer: LayerHandle | null;
  /** Hours of direct sun. */
  hours: Float32Array;
  /** Time of day (hours, in `utcOffset`'s zone) of the first and last direct sun; NaN = none. */
  firstSun: Float32Array;
  lastSun: Float32Array;
  /** Hours the sun is above the horizon at the region's center. */
  daylight: number;
}

export interface SkyViewOptions extends RegionOptions, ResultLayerOptions {
  /**
   * Search radius in meters (at most 128 cells). Default: the whole
   * region, which is also much faster.
   */
  radius?: number;
  /** Search directions (default 16). */
  directions?: number;
}

export interface TpiOptions extends RegionOptions, ResultLayerOptions {
  /** Half-size of the neighbourhood window in meters (default 500). */
  radius?: number;
  /** Half-size of an inner window left out (a ring), meters (default 0). */
  innerRadius?: number;
}

export interface GridResult extends RegionInfo {
  layer: LayerHandle | null;
  data: Float32Array;
}

/** A running region analysis. */
export interface AnalysisJob {
  id: string;
  kind: string;
  label: string;
  stage: 'loading' | 'computing';
  /** Progress of the current stage, 0–1. */
  progress: number;
}

type EmitFn = <K extends keyof TreeletEventMap>(event: K, data: TreeletEventMap[K]) => void;

export interface AnalysisControllerDeps {
  workerPool: WorkerPool;
  layerRegistry: LayerRegistry;
  layerController: LayerController;
  emit: EmitFn;
  /** lng/lat → world plane. */
  toWorld: (lngLat: LngLat) => { x: number; y: number };
  /** Region analysed when none is given. */
  defaultBounds: () => TileBounds | null;
  /** The map's sun time, if set. */
  sunTime: () => Date | null;
}

interface JobState extends AnalysisJob {
  requestId: number;
  cancelled: boolean;
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

export class AnalysisController {
  private readonly jobs = new Map<string, JobState>();
  private nextRequest = 1;

  constructor(private readonly deps: AnalysisControllerDeps) {}

  /** Running jobs, oldest first. */
  getJobs(): AnalysisJob[] {
    return [...this.jobs.values()].map(({ id, kind, label, stage, progress }) => ({ id, kind, label, stage, progress }));
  }

  /** Cancel a running job; its promise rejects with an AbortError. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.cancelled) return false;
    job.cancelled = true;
    this.deps.workerPool.cancelAnalysis(job.requestId);
    return true;
  }

  cancelAll(): void {
    for (const id of [...this.jobs.keys()]) this.cancel(id);
  }

  // =========================================================================
  // Analyses
  // =========================================================================

  async getElevationGrid(options: RegionOptions = {}): Promise<ElevationGrid> {
    const { response, info } = await this.run('elevation', 'Elevation grid', options, null, () => null, true);
    return { ...info, data: response.grid!, min: response.min, max: response.max };
  }

  async computeViewshed(observer: LngLat, options: ViewshedOptions = {}): Promise<ViewshedResult> {
    const radius = options.radius ?? 10000;
    const bounds = options.bounds ?? boundsAround(observer.lng, observer.lat, radius);
    const { response, info } = await this.run('viewshed', 'Viewshed', { ...options, bounds }, observer, (p) => ({
      kind: 'viewshed',
      options: {
        tileX: tileX(observer.lng, p.zoom),
        tileY: tileY(observer.lat, p.zoom),
        eyeHeight: options.eyeHeight,
        targetHeight: options.targetHeight,
        radius,
        fov: options.fov,
        bearing: options.bearing,
        curvature: options.curvature,
        refraction: options.refraction,
        clearance: options.clearance,
      },
    }));
    const visible = response.outputs.visible;
    const layer = this.showResult('viewshed', options, info, visible, {});
    return {
      ...info,
      layer,
      visible,
      clearance: response.outputs.clearance ?? null,
      visibleArea: (response.stats.visibleCells ?? 0) * info.cellSize * info.cellSize,
      observerElevation: response.stats.observerElevation,
    };
  }

  async computeSunHours(options: SunHoursOptions = {}): Promise<SunHoursResult> {
    const date = options.date ?? this.deps.sunTime() ?? new Date();
    const step = Math.max(1, options.stepMinutes ?? 15);
    const utcOffset = options.utcOffset ?? -date.getTimezoneOffset() / 60;
    const { response, info } = await this.run('sunhours', 'Sun hours', options, null, (_p, center) => ({
      kind: 'sunhours',
      options: {
        samples: sunPathOfDay(date, center.lng, center.lat, step, utcOffset),
        stepMinutes: step,
      },
    }));
    const hours = response.outputs.hours;
    const daylight = response.stats.daylight ?? 0;
    const layer = this.showResult('sunhours', options, info, hours, {
      range: [0, Math.max(1, Math.ceil(daylight))],
    });
    return { ...info, layer, hours, firstSun: response.outputs.firstSun, lastSun: response.outputs.lastSun, daylight };
  }

  async computeSkyView(options: SkyViewOptions = {}): Promise<GridResult> {
    const { response, info } = await this.run('skyview', 'Sky view', options, null, () => ({
      kind: 'skyview',
      options: { radius: options.radius, directions: options.directions },
    }));
    const data = response.outputs.skyview;
    const p = gridPercentiles(data, 0.02, 1);
    const lo = p ? Math.max(0, Math.floor(p[0] * 20) / 20) : 0.6;
    const layer = this.showResult('skyview', options, info, data, { range: [Math.min(lo, 0.95), 1] });
    return { ...info, layer, data };
  }

  async computeTpi(options: TpiOptions = {}): Promise<GridResult> {
    const { response, info } = await this.run('tpi', 'Topographic position', options, null, () => ({
      kind: 'tpi',
      options: { radius: options.radius ?? 500, innerRadius: options.innerRadius },
    }));
    const data = response.outputs.tpi;
    const p = gridPercentiles(data, 0.02, 0.98);
    const m = p ? Math.max(5, Math.ceil(Math.max(Math.abs(p[0]), Math.abs(p[1])) / 5) * 5) : 50;
    const layer = this.showResult('tpi', options, info, data, { range: [-m, m] });
    return { ...info, layer, data };
  }

  // =========================================================================
  // Internals
  // =========================================================================

  /**
   * Plan the region, run the task in the analysis worker and report
   * progress. `task` builds the worker task once the zoom is known.
   */
  private async run(
    kind: string,
    label: string,
    options: RegionOptions,
    focus: LngLat | null,
    task: (plan: RegionPlan, center: LngLat) => RegionTask | null,
    returnGrid = false,
  ): Promise<{ response: RegionAnalysisResponse; info: RegionInfo }> {
    const base = this.deps.layerRegistry.getActiveBaseLayer();
    if (!base) throw new Error('treelet: region analyses need an active base layer');
    if (options.signal?.aborted) throw this.abortError();
    const bounds = options.bounds ?? this.deps.defaultBounds();
    if (!bounds) throw new Error('treelet: no area to analyse (the view shows no terrain); pass `bounds`');

    // The job is listed (and can be cancelled) from the moment it is asked for
    const requestId = this.nextRequest++;
    const job: JobState = { id: `job-${requestId}`, kind, label, stage: 'loading', progress: 0, requestId, cancelled: false };
    this.jobs.set(job.id, job);
    this.deps.emit('analysisstart', { id: job.id, kind, label });
    const onAbort = () => this.cancel(job.id);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await base.source.ensureReady();
      if (job.cancelled) throw this.abortError();
      const src = base.source;
      const plan = planRegion(bounds, {
        zoom: options.zoom,
        minZoom: Math.max(0, src.minZoom, base.minZoom),
        maxZoom: Math.min(src.maxZoom, base.maxZoom),
        maxTiles: options.maxTiles,
      });
      const center = focus ?? {
        lng: lngOfTileX((plan.window.x0 + plan.window.x1) / 2, plan.zoom),
        lat: latOfTileY((plan.window.y0 + plan.window.y1) / 2, plan.zoom),
      };
      const tiles = plan.tiles.map((t) => ({ ...t, url: base.getTileUrl({ z: plan.zoom, x: t.x, y: t.y }) }));
      const w = plan.window;
      const key = `${base.id}|${plan.zoom}|${w.x0.toFixed(6)},${w.y0.toFixed(6)},${w.x1.toFixed(6)},${w.y1.toFixed(6)}`;

      const response = await this.deps.workerPool.analyzeRegion({
        id: requestId,
        region: {
          key,
          zoom: plan.zoom,
          tiles,
          window: w,
          decoderType: base.decoderType,
          decoderSource: base.decoderSource ?? undefined,
          init: src.getRequestInit?.(),
        },
        centerLat: center.lat,
        task: task(plan, center),
        returnGrid,
      }, (stage, fraction) => {
        if (job.cancelled || !this.jobs.has(job.id)) return;
        job.stage = stage;
        job.progress = fraction;
        this.deps.emit('analysisprogress', { id: job.id, kind, label, stage, progress: fraction });
      });
      if (job.cancelled) throw this.abortError();
      const T = response.tileSize;
      const z = response.zoom;
      const info: RegionInfo = {
        bounds: {
          west: lngOfTileX(response.px0 / T, z),
          east: lngOfTileX((response.px0 + response.width) / T, z),
          north: latOfTileY(response.py0 / T, z),
          south: latOfTileY((response.py0 + response.height) / T, z),
        },
        width: response.width,
        height: response.height,
        zoom: z,
        cellSize: response.cellSize,
        missingTiles: response.missing + response.failed,
      };
      this.jobs.delete(job.id);
      this.deps.emit('analysisend', { id: job.id, kind, label, status: 'done' });
      return { response, info };
    } catch (err) {
      this.jobs.delete(job.id);
      const cancelled = job.cancelled || isAbort(err);
      this.deps.emit('analysisend', {
        id: job.id, kind, label,
        status: cancelled ? 'cancelled' : 'error',
        error: cancelled ? undefined : (err as Error)?.message ?? String(err),
      });
      throw cancelled ? this.abortError() : err;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Show a result grid as a coat of `kind` (unless `addLayer` is false). */
  private showResult(
    kind: string,
    options: ResultLayerOptions,
    info: RegionInfo,
    data: Float32Array,
    params: Record<string, unknown>,
  ): LayerHandle | null {
    if (options.addLayer === false) return null;
    if (options.replaceLayer) this.deps.layerController.removeAnalysisLayer(options.replaceLayer);
    const nw = this.deps.toWorld({ lng: info.bounds.west, lat: info.bounds.north });
    const se = this.deps.toWorld({ lng: info.bounds.east, lat: info.bounds.south });
    const bounds: WorldRect = { west: nw.x, north: nw.y, east: se.x, south: se.y };
    const raster: RasterInput = { width: info.width, height: info.height, data, bounds };
    return this.deps.layerController.addRasterLayer({
      analysis: kind,
      layerName: options.layerName ?? getAnalysis(kind)?.label,
      params,
      layerDisplay: options.layerDisplay,
    }, raster);
  }

  private abortError(): Error {
    const err = new Error('treelet: analysis cancelled');
    err.name = 'AbortError';
    return err;
  }
}
