// ============================================================================
// Tests for src/terrain/FetchChannel.ts
//
// The channel is what keeps a failing tile source from turning into a request
// storm or a main-thread freeze, so these tests pin down retry behaviour.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { FailureTracker, FetchChannel, type FetchOutcome } from '../../src/terrain/FetchChannel';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('FailureTracker', () => {
  it('backs off exponentially up to the cap', () => {
    const t = new FailureTracker(1000, 8000, () => 0.5); // jitter factor 1.0
    expect(t.recordError(1, 0)).toBe(1000);
    expect(t.recordError(1, 0)).toBe(2000);
    expect(t.recordError(1, 0)).toBe(4000);
    expect(t.recordError(1, 0)).toBe(8000);
    expect(t.recordError(1, 0)).toBe(8000);
    expect(t.isBlocked(1, 7999)).toBe(true);
    expect(t.isBlocked(1, 8000)).toBe(false);
  });

  it('treats empty tiles as permanently blocked and excludes them from retry timing', () => {
    const t = new FailureTracker();
    t.recordEmpty(7);
    expect(t.isBlocked(7, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(t.isEmpty(7)).toBe(true);
    expect(t.nextRetryAt(0)).toBeNull();
    expect(t.erroredCount).toBe(0);
  });

  it('forgets a key on success', () => {
    const t = new FailureTracker();
    t.recordError(3, 0);
    t.recordSuccess(3);
    expect(t.isBlocked(3, 0)).toBe(false);
    expect(t.size).toBe(0);
  });
});

describe('FetchChannel', () => {
  function makeChannel(now: { t: number }) {
    const onSettled = vi.fn();
    const onError = vi.fn();
    const ch = new FetchChannel({ onSettled, onError, now: () => now.t });
    return { ch, onSettled, onError };
  }

  it('never relaunches a failed tile before its backoff expires', async () => {
    const now = { t: 0 };
    const { ch, onError } = makeChannel(now);
    let attempts = 0;
    const run = async (): Promise<FetchOutcome> => { attempts++; throw new Error('HTTP 500'); };

    // Simulate an aggressive scheduler that tries to relaunch on every settle.
    for (let i = 0; i < 1000; i++) {
      if (ch.canLaunch(42)) ch.launch(42, run, () => {});
      await flush();
    }
    expect(attempts).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);

    now.t = 5_000; // past the first backoff window
    if (ch.canLaunch(42)) ch.launch(42, run, () => {});
    await flush();
    expect(attempts).toBe(2);
  });

  it('does not retry empty tiles at all', async () => {
    const now = { t: 0 };
    const { ch } = makeChannel(now);
    ch.launch(1, async () => 'empty', () => {});
    await flush();
    now.t = 1e9;
    expect(ch.canLaunch(1)).toBe(false);
    expect(ch.failures.isEmpty(1)).toBe(true);
  });

  it('settles asynchronously, even when run() throws synchronously', () => {
    const now = { t: 0 };
    const { ch, onSettled } = makeChannel(now);
    ch.launch(1, () => { throw new Error('sync failure'); }, () => {});
    // No synchronous re-entry: the owner is only notified on a later tick.
    expect(onSettled).not.toHaveBeenCalled();
    expect(ch.has(1)).toBe(true);
  });

  it('treats AbortError as a cancellation without penalty', async () => {
    const now = { t: 0 };
    const { ch, onError } = makeChannel(now);
    ch.launch(1, async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }, () => {});
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(ch.canLaunch(1)).toBe(true);
  });

  it('ignores results of cancelled requests and calls the cancel hook', async () => {
    const now = { t: 0 };
    const { ch, onSettled } = makeChannel(now);
    const cancel = vi.fn();
    let resolve!: (o: FetchOutcome) => void;
    ch.launch(9, () => new Promise((r) => { resolve = r; }), cancel);
    ch.cancel(9);
    expect(cancel).toHaveBeenCalledWith(1);
    expect(ch.size).toBe(0);
    resolve('ok');
    await flush();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('tracks weighted load and cancels requests that are no longer needed', async () => {
    const now = { t: 0 };
    const { ch } = makeChannel(now);
    const pending = () => new Promise<FetchOutcome>(() => {});
    ch.launch(1, pending, () => {}, 4);
    ch.launch(2, pending, () => {}, 4);
    expect(ch.load).toBe(8);
    now.t = 1000;
    ch.touch(2);
    expect(ch.cancelStale(400)).toBe(1);
    expect(ch.has(1)).toBe(false);
    expect(ch.has(2)).toBe(true);
    expect(ch.load).toBe(4);
  });
});
