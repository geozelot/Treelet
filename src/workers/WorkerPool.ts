// ============================================================================
// treelet.js - Worker Pool
//
// Load-aware Comlink worker pool for parallel tile processing.
// Workers are created as ES modules using Vite's URL convention.
// ============================================================================

import * as Comlink from 'comlink';
import type { TileWorkerAPI } from './tileWorker';

/**
 * Pool of Web Workers for parallel tile decoding and mesh generation.
 *
 * Uses Comlink for transparent RPC and dispatches to the least-loaded
 * worker based on pending task count.
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private proxies: Comlink.Remote<TileWorkerAPI>[] = [];

  /** Pending task count per worker for load-aware dispatch. */
  private pendingCounts: number[] = [];

  /**
   * @param count - Number of workers to create (default: navigator.hardwareConcurrency || 4)
   */
  constructor(count: number = navigator.hardwareConcurrency || 4) {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(
        new URL('./tileWorker.ts', import.meta.url),
        { type: 'module' },
      );
      this.workers.push(worker);
      this.proxies.push(Comlink.wrap<TileWorkerAPI>(worker));
      this.pendingCounts.push(0);
    }
  }

  /**
   * Get the next worker proxy (least-loaded dispatch).
   *
   * Returns a wrapper that automatically tracks pending task count
   * when the returned proxy's methods are called.
   */
  getProxy(): Comlink.Remote<TileWorkerAPI> {
    // Find the worker with the fewest pending tasks
    let minIdx = 0;
    let minCount = this.pendingCounts[0];
    for (let i = 1; i < this.pendingCounts.length; i++) {
      if (this.pendingCounts[i] < minCount) {
        minCount = this.pendingCounts[i];
        minIdx = i;
      }
    }

    this.pendingCounts[minIdx]++;
    const idx = minIdx;
    const proxy = this.proxies[idx];
    const pool = this;

    // Return a proxy wrapper that decrements pending count when operations complete
    return new Proxy(proxy, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            let result: unknown;
            try {
              result = (value as Function).apply(target, args);
            } catch (err) {
              // Synchronous throw - decrement to prevent pending count leak
              pool.pendingCounts[idx]--;
              throw err;
            }
            // If the result is a Promise, decrement when it settles
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
              (result as Promise<unknown>).then(
                () => { pool.pendingCounts[idx]--; },
                () => { pool.pendingCounts[idx]--; },
              );
            } else {
              pool.pendingCounts[idx]--;
            }
            return result;
          };
        }
        return value;
      },
    }) as Comlink.Remote<TileWorkerAPI>;
  }

  /**
   * Number of active workers.
   */
  get size(): number {
    return this.workers.length;
  }

  /**
   * Terminate all workers and release resources.
   */
  dispose(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.proxies = [];
    this.pendingCounts = [];
  }
}
