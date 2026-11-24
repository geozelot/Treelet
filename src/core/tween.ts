// ============================================================================
// treelet.js - Tween
//
// A small animation-frame driven interpolation used to animate analysis
// parameters (a rising water level). One tween per subject: starting a new
// one cancels the previous.
// ============================================================================

export type Easing = (t: number) => number;

export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const linear: Easing = (t) => t;

export interface TweenOptions {
  /** Duration in milliseconds (0 = jump to the end on the first frame). */
  duration: number;
  /** Called with the eased progress in [0, 1]; the last call is exactly 1. */
  onUpdate: (t: number) => void;
  easing?: Easing;
  /** Injectable clock and frame scheduler (tests). */
  now?: () => number;
  requestFrame?: (cb: (now: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface TweenHandle {
  /** Resolves true when the tween completed, false when it was cancelled. */
  readonly done: Promise<boolean>;
  cancel(): void;
}

/** Start a tween; the first update runs on the next frame. */
export function startTween(options: TweenOptions): TweenHandle {
  const now = options.now ?? (() => performance.now());
  const raf = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const caf = options.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  const ease = options.easing ?? easeInOutCubic;
  const duration = Math.max(0, options.duration);
  const start = now();
  let frame: number | null = null;
  let finished = false;
  let resolve!: (completed: boolean) => void;
  const done = new Promise<boolean>((r) => { resolve = r; });

  const step = () => {
    frame = null;
    if (finished) return;
    const t = duration > 0 ? Math.min(1, (now() - start) / duration) : 1;
    options.onUpdate(ease(t));
    if (t >= 1) {
      finished = true;
      resolve(true);
    } else {
      frame = raf(step);
    }
  };
  frame = raf(step);

  return {
    done,
    cancel() {
      if (finished) return;
      finished = true;
      if (frame !== null) caf(frame);
      frame = null;
      resolve(false);
    },
  };
}
