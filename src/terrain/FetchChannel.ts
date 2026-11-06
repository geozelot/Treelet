// ============================================================================
// treelet.js - Fetch Channel
//
// Concurrency, cancellation and failure backoff for one tile pipeline
// (elevation or drape). Guarantees that a failing tile is never retried in
// a tight loop:
//
//   ok        → failure record cleared
//   empty     → tile marked as nonexistent until clear() (404/410/204)
//   error     → exponential backoff with jitter (1 s → 60 s)
//   cancelled / stale → no penalty, may be relaunched immediately
//
// Completions never re-enter the scheduler synchronously; the owner is
// notified through `onSettled` and decides when to pump again.
// ============================================================================

export type FetchOutcome = 'ok' | 'empty' | 'error' | 'cancelled' | 'stale';

interface FailureEntry {
  failures: number;
  retryAt: number;
  empty: boolean;
}

/** Per-key failure bookkeeping with exponential backoff. */
export class FailureTracker {
  private readonly entries = new Map<number, FailureEntry>();

  constructor(
    private readonly baseDelayMs = 1000,
    private readonly maxDelayMs = 60_000,
    private readonly random: () => number = Math.random,
  ) {}

  /** Whether `key` must not be fetched at time `now`. */
  isBlocked(key: number, now: number): boolean {
    const e = this.entries.get(key);
    return e !== undefined && (e.empty || now < e.retryAt);
  }

  /** Whether `key` is known not to exist. */
  isEmpty(key: number): boolean {
    return this.entries.get(key)?.empty === true;
  }

  /** Record a failed attempt; returns the time of the next allowed attempt. */
  recordError(key: number, now: number): number {
    const e = this.entries.get(key) ?? { failures: 0, retryAt: 0, empty: false };
    e.failures++;
    const backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (e.failures - 1));
    e.retryAt = now + backoff * (0.75 + 0.5 * this.random());
    this.entries.set(key, e);
    return e.retryAt;
  }

  recordEmpty(key: number): void {
    this.entries.set(key, { failures: 0, retryAt: Infinity, empty: true });
  }

  recordSuccess(key: number): void {
    this.entries.delete(key);
  }

  /** Earliest future retry time among backed-off keys, or null. */
  nextRetryAt(now: number): number | null {
    let next = Infinity;
    for (const e of this.entries.values()) {
      if (!e.empty && e.retryAt > now && e.retryAt < next) next = e.retryAt;
    }
    return next === Infinity ? null : next;
  }

  /** Number of keys currently failed (backing off) or known empty. */
  get size(): number {
    return this.entries.size;
  }

  /** Number of keys in error backoff (excludes known-empty tiles). */
  get erroredCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (!e.empty) n++;
    return n;
  }

  clear(): void {
    this.entries.clear();
  }
}

interface InFlight {
  id: number;
  /** Request weight against the concurrency limit (e.g. composite drape parts). */
  weight: number;
  /** Last time the owner reported this key as still needed. */
  lastNeeded: number;
  cancel: () => void;
}

export interface FetchChannelOptions {
  /** Called after any launched request settles (never synchronously from launch). */
  onSettled: () => void;
  /** Called when a request fails with an error (for logging / events). */
  onError?: (key: number, error: unknown) => void;
  now?: () => number;
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

/** One tile pipeline's in-flight set, concurrency accounting and backoff. */
export class FetchChannel {
  readonly failures = new FailureTracker();
  private readonly inFlight = new Map<number, InFlight>();
  private inFlightWeight = 0;
  private nextId = 1;
  private readonly now: () => number;

  constructor(private readonly options: FetchChannelOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  /** Total weight of in-flight requests. */
  get load(): number {
    return this.inFlightWeight;
  }

  /** Number of in-flight requests. */
  get size(): number {
    return this.inFlight.size;
  }

  has(key: number): boolean {
    return this.inFlight.has(key);
  }

  /** Whether `key` may be launched now (not in flight, not backing off / empty). */
  canLaunch(key: number): boolean {
    return !this.inFlight.has(key) && !this.failures.isBlocked(key, this.now());
  }

  /** Mark an in-flight key as still wanted (protects it from cancelStale). */
  touch(key: number): void {
    const f = this.inFlight.get(key);
    if (f) f.lastNeeded = this.now();
  }

  /**
   * Launch a request. `run` receives a unique request id and resolves to the
   * outcome; a rejection counts as 'error' (or 'cancelled' for AbortError).
   */
  launch(
    key: number,
    run: (id: number) => Promise<FetchOutcome>,
    cancel: (id: number) => void,
    weight = 1,
  ): void {
    if (this.inFlight.has(key)) return;
    const id = this.nextId++;
    const entry: InFlight = { id, weight, lastNeeded: this.now(), cancel: () => cancel(id) };
    this.inFlight.set(key, entry);
    this.inFlightWeight += weight;

    let promise: Promise<FetchOutcome>;
    try {
      promise = run(id);
    } catch (err) {
      promise = Promise.reject(err);
    }
    promise.then(
      (outcome) => this.settle(key, id, outcome, null),
      (err) => this.settle(key, id, isAbortError(err) ? 'cancelled' : 'error', err),
    );
  }

  /** Cancel one in-flight request (its eventual result is ignored). */
  cancel(key: number): void {
    const f = this.inFlight.get(key);
    if (!f) return;
    this.inFlight.delete(key);
    this.inFlightWeight -= f.weight;
    f.cancel();
  }

  /** Cancel requests not touched within `graceMs`. Returns the number cancelled. */
  cancelStale(graceMs: number): number {
    const cutoff = this.now() - graceMs;
    let n = 0;
    for (const [key, f] of this.inFlight) {
      if (f.lastNeeded < cutoff) {
        this.cancel(key);
        n++;
      }
    }
    return n;
  }

  /** Cancel everything; optionally forget failure history (e.g. on layer change). */
  clear(resetFailures = true): void {
    for (const key of [...this.inFlight.keys()]) this.cancel(key);
    if (resetFailures) this.failures.clear();
  }

  private settle(key: number, id: number, outcome: FetchOutcome, error: unknown): void {
    const f = this.inFlight.get(key);
    // Superseded or cancelled: the request no longer owns this key.
    if (!f || f.id !== id) return;
    this.inFlight.delete(key);
    this.inFlightWeight -= f.weight;

    switch (outcome) {
      case 'ok':
        this.failures.recordSuccess(key);
        break;
      case 'empty':
        this.failures.recordEmpty(key);
        break;
      case 'error':
        this.failures.recordError(key, this.now());
        this.options.onError?.(key, error);
        break;
      default:
        break;
    }
    this.options.onSettled();
  }
}
