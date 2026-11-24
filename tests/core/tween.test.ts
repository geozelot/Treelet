// ============================================================================
// Tests for src/core/tween.ts with an injected clock and frame scheduler.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { startTween, linear } from '../../src/core/tween';

/** A manual animation-frame loop: `tick(ms)` advances the clock and runs the queued frame. */
function scheduler() {
  let now = 0;
  let queued: ((now: number) => void) | null = null;
  let cancelled = 0;
  return {
    now: () => now,
    requestFrame: (cb: (now: number) => void) => { queued = cb; return 1; },
    cancelFrame: () => { cancelled++; queued = null; },
    tick(ms: number) { now += ms; const cb = queued; queued = null; cb?.(now); },
    get cancelled() { return cancelled; },
    get pending() { return queued !== null; },
  };
}

describe('startTween', () => {
  it('eases from 0 to exactly 1 over the duration and resolves true', async () => {
    const s = scheduler();
    const seen: number[] = [];
    const tween = startTween({ duration: 100, onUpdate: (t) => seen.push(t), easing: linear, ...s });
    expect(seen).toEqual([]); // nothing before the first frame
    s.tick(25); s.tick(25); s.tick(25); s.tick(50);
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
    expect(s.pending).toBe(false);
    await expect(tween.done).resolves.toBe(true);
  });

  it('a zero duration jumps to the end on the first frame', async () => {
    const s = scheduler();
    const onUpdate = vi.fn();
    const tween = startTween({ duration: 0, onUpdate, ...s });
    s.tick(0);
    expect(onUpdate).toHaveBeenCalledWith(1);
    await expect(tween.done).resolves.toBe(true);
  });

  it('cancel stops further updates, cancels the frame and resolves false', async () => {
    const s = scheduler();
    const onUpdate = vi.fn();
    const tween = startTween({ duration: 100, onUpdate, easing: linear, ...s });
    s.tick(50);
    tween.cancel();
    tween.cancel(); // idempotent
    s.tick(50);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(s.cancelled).toBe(1);
    await expect(tween.done).resolves.toBe(false);
  });
});
