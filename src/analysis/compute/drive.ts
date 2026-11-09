// ============================================================================
// treelet.js - Driving long computations
//
// The raster analyses are generators that yield their progress (0–1) every
// so often. In the worker, `drive` runs them in time slices, giving the
// event loop a turn between slices so progress reaches the main thread and
// a cancel message can abort the job. Tests run them with `runSync`.
// ============================================================================

/** A computation that yields its progress (0–1) and returns its result. */
export type Steps<T> = Generator<number, T, void>;

/** A grid of elevations (or any values) in meters, NaN = nodata. */
export interface Grid {
  data: Float32Array;
  width: number;
  height: number;
  /** Ground distance between cell centers in meters. */
  cellSize: number;
}

export function abortError(): Error {
  const err = new Error('treelet: analysis cancelled');
  err.name = 'AbortError';
  return err;
}

/** Run a computation to completion synchronously. */
export function runSync<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * Run a computation in slices of about `sliceMs`, reporting progress and
 * yielding to the event loop between slices. Rejects with an AbortError
 * once `signal` aborts.
 */
export async function drive<T>(
  steps: Steps<T>,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
  sliceMs = 40,
): Promise<T> {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let sliceStart = now();
  for (;;) {
    if (signal?.aborted) throw abortError();
    const r = steps.next();
    if (r.done) return r.value;
    if (now() - sliceStart >= sliceMs) {
      onProgress?.(Math.max(0, Math.min(1, r.value as number)));
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = now();
    }
  }
}
