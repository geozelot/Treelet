// ============================================================================
// Tests for src/terrain/CoatStack.ts: packing coats for the shader and the
// ramp texture rows, including 'auto' domains that follow the visible range.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { CoatStack, rampRowDomain, type CoatInput } from '../../src/terrain/CoatStack';
import { MAX_COATS } from '../../src/analysis/registry';
import { RAMP_WIDTH, BUILTIN_RAMPS, classIndexOf } from '../../src/analysis/ramps';
import type { ClassRamp } from '../../src/analysis/types';

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

  it('draws only coats in their zoom range and above opacity 0', () => {
    const stack = new CoatStack();
    stack.set([
      coat({ id: 'a', kind: 1 }),
      coat({ id: 'b', kind: 2, opacity: 0 }),
      coat({ id: 'c', kind: 3, minZoom: 10, maxZoom: 14 }),
    ]);
    expect(stack.packed.map((c) => c.kind)).toEqual([1, 3]); // zoom unknown yet: all zooms
    expect(stack.setZoom(8)).toBe(true);
    expect(stack.packed.map((c) => c.kind)).toEqual([1]);
    expect(stack.setZoom(9)).toBe(false); // same coats drawn
    expect(stack.setZoom(12)).toBe(true);
    expect(stack.packed.map((c) => c.kind)).toEqual([1, 3]);
  });

  it('needs a shadow map only while a drawn coat reads one', () => {
    const stack = new CoatStack();
    stack.set([coat({ id: 's', shadowMap: true, opacity: 0 })]);
    expect(stack.needsShadows).toBe(false);
    stack.set([coat({ id: 's', shadowMap: true, minZoom: 12 })]);
    stack.setZoom(10);
    expect(stack.needsShadows).toBe(false);
    stack.setZoom(13);
    expect(stack.needsShadows).toBe(true);
  });

  it('domains derived from the visible range follow it, not only a returned "auto" array', () => {
    const stack = new CoatStack();
    stack.set([coat({ id: 'd', ramp: BUILTIN_RAMPS.grayscale, domain: (v) => [v[0], v[0] + 500] })]);
    expect(stack.needsAutoRange).toBe(true);
    expect(stack.setAutoRange(1200, 3000)).toBe(true);
    expect(stack.packed[0].p0).toEqual([1200, 1700, 0, 0]);
  });

  it("a custom domain() that fails for a range keeps the coat as it was (reported once)", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stack = new CoatStack();
    const domain = (v: [number, number]): [number, number] => {
      if (v[0] < 0) throw new Error('no bathymetry');
      return v;
    };
    stack.set([coat({ id: 'custom', domain })]);
    stack.setAutoRange(100, 900);
    const before = stack.packed[0];
    expect(() => stack.setAutoRange(-50, 900)).not.toThrow();
    expect(() => stack.setAutoRange(-60, 900)).not.toThrow();
    expect(stack.packed[0]).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(stack.setAutoRange(200, 900)).toBe(true); // a range it takes again
    warn.mockRestore();
  });

  it('rewrites a ramp row only when its ramp or domain changed', () => {
    const stack = new CoatStack();
    const c = coat({ id: 'r', ramp: BUILTIN_RAMPS.viridis, domain: [0, 100] });
    stack.set([c]);
    const v = stack.texture.version;
    stack.set([{ ...c, opacity: 0.5 }]);
    expect(stack.texture.version).toBe(v);
    stack.set([{ ...c, domain: [0, 200] }]);
    expect(stack.texture.version).toBeGreaterThan(v);
  });

  it('class ramps keep values outside the domain in their own class', () => {
    const ramp = BUILTIN_RAMPS.avalanche as ClassRamp; // breaks 30, 35, 40, 45; class 0 transparent
    // A slope coat narrowed to 30–60°: ground below 30° must stay class 0
    const d = rampRowDomain(ramp, [30, 60]);
    expect(d[0]).toBeLessThan(30);
    expect(d[1]).toBe(60);
    const stack = new CoatStack();
    stack.set([coat({ id: 'av', ramp, domain: [30, 60] })]);
    const data = stack.texture.image.data as Uint8Array;
    // Texel 0 (where every value below the domain clamps) is class 0: alpha 0
    expect(data[3]).toBe(0);
    expect(classIndexOf(ramp, d[0])).toBe(0);
    // The packed domain is the widened one, so the shader's t matches the row
    expect(stack.packed[0].p0.slice(0, 2)).toEqual(d);
    // Domains that already contain every break are unchanged
    expect(rampRowDomain(ramp, [0, 90])).toEqual([0, 90]);
  });
});
