// ============================================================================
// treelet.js - Worker Pool
//
// Comlink worker pool for tile fetch/decode. Workers are inlined into the
// bundle by default (blob: URL), so the library works from any bundler, CDN
// or <script> tag without serving a separate asset. Pass `workerUrl` to load
// `dist/treelet.worker.js` instead (e.g. for strict CSP without blob:).
//
// Requests carry an affinity string (the tile URL): identical URLs always go
// to the same worker so its decode cache and in-flight dedupe apply across
// overzoomed children of one parent tile.
// ============================================================================

import * as Comlink from 'comlink';
import type { TileWorkerAPI } from './tileWorker';
import type {
  DrapeRequest,
  DrapeResponse,
  ElevationRequest,
  ElevationResponse,
  RegionAnalysisRequest,
  RegionAnalysisResponse,
  RegionProgress,
} from './protocol';
import { hashString } from './raster';
import InlineTileWorker from './tileWorker.ts?worker&inline';

/** Error used to reject requests that can no longer complete. */
function disposedError(): Error {
  const err = new Error('treelet: worker pool disposed');
  err.name = 'AbortError';
  return err;
}

interface PendingCall {
  reject: (err: Error) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private proxies: Comlink.Remote<TileWorkerAPI>[] = [];
  /** Pending request count per worker (diagnostics + load-aware fallback). */
  private pendingCounts: number[] = [];
  /** Worker index serving each request id (for cancel routing). */
  private readonly requestWorker = new Map<number, number>();
  /** Outstanding calls, rejected on dispose so no promise hangs forever. */
  private readonly pending = new Set<PendingCall>();
  private disposed = false;
  private readonly workerUrl: string | URL | null;
  /** Worker for region analyses (created on first use), so long jobs never hold up tile loading. */
  private analysis: { worker: Worker; proxy: Comlink.Remote<TileWorkerAPI> } | null = null;

  /**
   * @param count - Number of workers to create
   * @param workerUrl - Optional URL of the standalone worker script
   */
  constructor(count: number, workerUrl: string | URL | null = null) {
    this.workerUrl = workerUrl;
    const n = Math.max(1, Math.floor(count));
    for (let i = 0; i < n; i++) {
      const worker = this.createWorker(`treelet-tiles-${i}`);
      this.workers.push(worker);
      this.proxies.push(Comlink.wrap<TileWorkerAPI>(worker));
      this.pendingCounts.push(0);
    }
  }

  private createWorker(name: string): Worker {
    const worker = this.workerUrl
      ? new Worker(this.workerUrl, { type: 'module', name })
      : new InlineTileWorker({ name });
    worker.addEventListener('error', (e) => {
      console.error('treelet: tile worker error', e.message ?? e);
    });
    return worker;
  }

  /** Number of active workers. */
  get size(): number {
    return this.workers.length;
  }

  /** Total requests currently outstanding. */
  get pendingCount(): number {
    return this.pending.size;
  }

  loadElevation(req: ElevationRequest): Promise<ElevationResponse> {
    return this.dispatch(req.id, req.url, (p) => p.loadElevation(req) as Promise<ElevationResponse>);
  }

  loadDrape(req: DrapeRequest): Promise<DrapeResponse> {
    return this.dispatch(req.id, req.parts[0]?.url ?? '', (p) => p.loadDrape(req) as Promise<DrapeResponse>);
  }

  /**
   * Load a region's elevation grid and run an analysis on it in the
   * analysis worker. Reject with an AbortError after cancelAnalysis(id).
   */
  analyzeRegion(req: RegionAnalysisRequest, onProgress?: RegionProgress): Promise<RegionAnalysisResponse> {
    if (this.disposed) return Promise.reject(disposedError());
    if (!this.analysis) {
      const worker = this.createWorker('treelet-analysis');
      this.analysis = { worker, proxy: Comlink.wrap<TileWorkerAPI>(worker) };
    }
    const proxy = this.analysis.proxy;
    return new Promise<RegionAnalysisResponse>((resolve, reject) => {
      const entry: PendingCall = { reject };
      this.pending.add(entry);
      const progress = onProgress ? Comlink.proxy(onProgress) : undefined;
      (proxy.analyzeRegion(req, progress) as Promise<RegionAnalysisResponse>).then(
        (value) => { this.pending.delete(entry); resolve(value); },
        (err) => { this.pending.delete(entry); reject(err); },
      );
    });
  }

  /** Cancel a region analysis by request id. */
  cancelAnalysis(id: number): void {
    if (this.disposed) return;
    this.analysis?.proxy.cancel(id).catch(() => {});
  }

  /** Cancel a request by id. Safe to call for settled or unknown ids. */
  cancel(id: number): void {
    const idx = this.requestWorker.get(id);
    if (idx === undefined || this.disposed) return;
    this.proxies[idx].cancel(id).catch(() => {});
  }

  /** Terminate all workers and reject everything still outstanding. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const call of this.pending) call.reject(disposedError());
    this.pending.clear();
    for (const proxy of this.proxies) proxy[Comlink.releaseProxy]();
    for (const worker of this.workers) worker.terminate();
    if (this.analysis) {
      this.analysis.proxy[Comlink.releaseProxy]();
      this.analysis.worker.terminate();
      this.analysis = null;
    }
    this.workers = [];
    this.proxies = [];
    this.pendingCounts = [];
    this.requestWorker.clear();
  }

  private dispatch<T>(
    id: number,
    affinity: string,
    call: (proxy: Comlink.Remote<TileWorkerAPI>) => Promise<T>,
  ): Promise<T> {
    if (this.disposed || this.proxies.length === 0) return Promise.reject(disposedError());

    const idx = affinity ? hashString(affinity) % this.proxies.length : this.leastLoaded();
    this.pendingCounts[idx]++;
    this.requestWorker.set(id, idx);

    return new Promise<T>((resolve, reject) => {
      const entry: PendingCall = { reject };
      this.pending.add(entry);
      const done = () => {
        this.pending.delete(entry);
        if (!this.disposed) {
          this.pendingCounts[idx]--;
          this.requestWorker.delete(id);
        }
      };
      let result: Promise<T>;
      try {
        result = call(this.proxies[idx]);
      } catch (err) {
        done();
        reject(err as Error);
        return;
      }
      result.then(
        (value) => { done(); resolve(value); },
        (err) => { done(); reject(err); },
      );
    });
  }

  private leastLoaded(): number {
    let best = 0;
    for (let i = 1; i < this.pendingCounts.length; i++) {
      if (this.pendingCounts[i] < this.pendingCounts[best]) best = i;
    }
    return best;
  }
}
