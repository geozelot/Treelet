// ============================================================================
// Tests for src/terrain/DrapeAtlas.ts (residency bookkeeping)
// ============================================================================

import { describe, it, expect } from 'vitest';
import { DrapeAtlas } from '../../src/terrain/DrapeAtlas';

const chain = (size: number) => {
  const out: Uint8Array[] = [];
  for (let s = size; s >= 1; s >>= 1) out.push(new Uint8Array(s * s * 4));
  return out;
};

describe('DrapeAtlas', () => {
  it('is not sampled before its upload lands', () => {
    const d = new DrapeAtlas(4, 8, 1);
    d.write(1, 0, 7, 10, chain(4));
    expect(d.has(1, 7)).toBe(false);
    expect(d.loadedZoom(1, 7)).toBe(10); // but counts as loaded for scheduling
    expect(d.hasPendingUploads).toBe(true);
  });

  it('does not inherit readiness from a "no imagery" placeholder', () => {
    const d = new DrapeAtlas(4, 8, 1);
    d.writeEmpty(1, 7, 10);
    d.write(1, 0, 7, 11, chain(4));
    expect(d.has(1, 7)).toBe(false);
  });

  it('invalidates entries when the elevation slot generation changes', () => {
    const d = new DrapeAtlas(4, 8, 1);
    d.write(1, 0, 7, 10, chain(4));
    expect(d.loadedZoom(1, 8)).toBe(-1);
  });

  it('rejects mip chains of the wrong length', () => {
    const d = new DrapeAtlas(4, 8, 1);
    expect(() => d.write(1, 0, 7, 10, chain(4).slice(1))).toThrow(/mip chain/);
  });
});
