// ============================================================================
// Tests for src/core/EventEmitter.ts
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/core/EventEmitter';

class Emitter extends EventEmitter<{ ping: { n: number } }> {
  fire(n: number) { this.emit('ping', { n }); }
}

describe('EventEmitter', () => {
  it('isolates a throwing handler from the others and from the emitter', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = new Emitter();
    const ok = vi.fn();
    e.on('ping', () => { throw new Error('boom'); });
    e.on('ping', ok);
    expect(() => e.fire(1)).not.toThrow();
    expect(ok).toHaveBeenCalledWith({ n: 1 });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('lets off() remove a once() handler before it fires', () => {
    const e = new Emitter();
    const h = vi.fn();
    e.once('ping', h);
    e.off('ping', h);
    e.fire(1);
    expect(h).not.toHaveBeenCalled();
    expect(e.listenerCount('ping')).toBe(0);
  });

  it('fires once() handlers exactly once', () => {
    const e = new Emitter();
    const h = vi.fn();
    e.once('ping', h);
    e.fire(1);
    e.fire(2);
    expect(h).toHaveBeenCalledTimes(1);
  });
});
