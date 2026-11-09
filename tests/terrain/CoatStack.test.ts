// ============================================================================
// Tests for src/terrain/CoatStack.ts: packing coats for the shader and the
// ramp texture rows, including 'auto' domains that follow the visible range.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { CoatStack, type CoatInput } from '../../src/terrain/CoatStack';
import { MAX_COATS } from '../../src/analysis/registry';
import { RAMP_WIDTH, BUILTIN_RAMPS } from '../../src/analysis/ramps';

const coat = (over: Partial<CoatInput>): CoatInput => ({
  id: 'c', kind: 1, blendMode: 'normal', opacity: 1, ramp: null, domain: [0, 1],
  pack: (d) => ({ p0: [d[0], d[1], 0, 0], p1: [0, 0, 0, 0] }),
  ...over,
});

describe('CoatStack', () => {
  it('packs kinds, blend, opacity and ramp rows in stack order', () => {
    const stack = new CoatStack();
    const version = stack.texture.version;
    stack.set([
      coat({ id: 'img', kind: 0 }),
      coat({ id: 'slope', kind: 2, opacity: 0.5, blendMode: 'multiply', ramp: BUILTIN_RAMPS.grayscale, domain: [0, 60] }),
    ]);
    expect(stack.packed).toHaveLength(2);
    expect(stack.packed[0]).toMatchObject({ kind: 0, rampRow: -1 });
    expect(stack.packed[1]).toMatchObject({ kind: 2, opacity: 0.5, blendMode: 'multiply', rampRow: 1, p0: [0, 60, 0, 0] });
    // Row 1 holds the grayscale ramp; row 0 was left alone
    const data = stack.texture.image.data as Uint8Array;
    const row1 = RAMP_WIDTH * 4;
    expect(data[row1 + (RAMP_WIDTH - 1) * 4]).toBe(255);
    expect(stack.texture.version).toBeGreaterThan(version); // re-uploaded
    expect([stack.width, stack.height]).toEqual([RAMP_WIDTH, MAX_COATS]);
  });

  it('drops coats beyond MAX_COATS', () => {
    const stack = new CoatStack();
    stack.set(Array.from({ length: MAX_COATS + 2 }, (_, i) => coat({ id: `c${i}` })));
    expect(stack.packed).toHaveLength(MAX_COATS);
  });

  it("'auto' domains follow setAutoRange; fixed ones don't", () => {
    const stack = new CoatStack();
    stack.set([
      coat({ id: 'auto', ramp: BUILTIN_RAMPS.grayscale, domain: 'auto' }),
      coat({ id: 'fixed', ramp: BUILTIN_RAMPS.grayscale, domain: [0, 100] }),
    ]);
    expect(stack.needsAutoRange).toBe(true);
    expect(stack.packed[0].p0).toEqual([0, 4000, 0, 0]); // default until the first frame
    expect(stack.setAutoRange(200, 1800)).toBe(true);
    expect(stack.autoDomain).toEqual([200, 1800]);
    expect(stack.packed[0].p0).toEqual([200, 1800, 0, 0]);
    expect(stack.packed[1].p0).toEqual([0, 100, 0, 0]);
    expect(stack.setAutoRange(200, 1800)).toBe(false); // unchanged

    stack.set([coat({ id: 'fixed', domain: [0, 100] })]);
    expect(stack.needsAutoRange).toBe(false);
    expect(stack.setAutoRange(1, 2)).toBe(false);
    stack.dispose();
  });
});
