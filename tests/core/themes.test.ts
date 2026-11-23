// ============================================================================
// Tests for the themes of a map: setThemes() checks and replaces the list,
// applyTheme() takes the applied theme down before it sets the next one up.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { Treelet } from '../../src/core/Treelet';
import type { MapTheme } from '../../src/core/types';

/** The theme methods on a bare map (no renderer). */
function themedMap() {
  const map = Object.create(Treelet.prototype) as Treelet & { emit: ReturnType<typeof vi.fn> };
  Object.assign(map, { themes: [], activeTheme: null, emit: vi.fn() });
  return map;
}

function theme(id: string, log: string[]): MapTheme {
  return {
    id,
    name: id.toUpperCase(),
    apply: vi.fn(() => { log.push(`apply ${id}`); }),
    clear: vi.fn(() => { log.push(`clear ${id}`); }),
  };
}

describe('themes', () => {
  it('lists the themes and tells about the change', () => {
    const map = themedMap();
    const log: string[] = [];
    map.setThemes([theme('a', log), theme('b', log)]);
    expect(map.getThemes().map((t) => t.id)).toEqual(['a', 'b']);
    expect(map.getActiveTheme()).toBeNull();
    expect(map.emit).toHaveBeenCalledWith('themechange', { id: null });
    expect(log).toEqual([]);
  });

  it('turns down a theme without an id, a name or apply, and ids used twice', () => {
    const map = themedMap();
    expect(() => map.setThemes([{ id: '', name: 'X', apply: () => {} }])).toThrow(/id, a name/);
    expect(() => map.setThemes([{ id: 'x', name: 'X' } as unknown as MapTheme])).toThrow(/apply/);
    expect(() => map.setThemes([{ id: 'x', name: 'X', apply: () => {} }, { id: 'x', name: 'Y', apply: () => {} }])).toThrow(/two themes/);
    expect(map.getThemes()).toEqual([]);
  });

  it('clears the applied theme before it applies the next one (also the same one again)', () => {
    const map = themedMap();
    const log: string[] = [];
    const [a, b] = [theme('a', log), theme('b', log)];
    map.setThemes([a, b]);
    map.applyTheme('a');
    expect(map.getActiveTheme()).toBe('a');
    expect(a.apply).toHaveBeenCalledWith(map);
    map.applyTheme('b');
    map.applyTheme('b');
    expect(log).toEqual(['apply a', 'clear a', 'apply b', 'clear b', 'apply b']);
    expect(map.emit).toHaveBeenLastCalledWith('themechange', { id: 'b' });
  });

  it('null only clears', () => {
    const map = themedMap();
    const log: string[] = [];
    map.setThemes([theme('a', log)]).applyTheme('a').applyTheme(null);
    expect(log).toEqual(['apply a', 'clear a']);
    expect(map.getActiveTheme()).toBeNull();
    expect(map.emit).toHaveBeenLastCalledWith('themechange', { id: null });
  });

  it('an unknown id throws and changes nothing', () => {
    const map = themedMap();
    const log: string[] = [];
    map.setThemes([theme('a', log)]).applyTheme('a');
    expect(() => map.applyTheme('nope')).toThrow(/no theme "nope"/);
    expect(map.getActiveTheme()).toBe('a');
    expect(log).toEqual(['apply a']);
  });

  it('a theme that fails to apply is not the applied one', () => {
    const map = themedMap();
    map.setThemes([{ id: 'bad', name: 'Bad', apply: () => { throw new Error('boom'); } }]);
    expect(() => map.applyTheme('bad')).toThrow('boom');
    expect(map.getActiveTheme()).toBeNull();
    expect(map.emit).toHaveBeenLastCalledWith('themechange', { id: null });
  });

  it('a new list keeps the applied theme only when it has its id (the map is left as it is)', () => {
    const map = themedMap();
    const log: string[] = [];
    map.setThemes([theme('a', log), theme('b', log)]).applyTheme('a');
    map.setThemes([theme('a', log)]);
    expect(map.getActiveTheme()).toBe('a');
    map.setThemes([theme('c', log)]);
    expect(map.getActiveTheme()).toBeNull();
    expect(log).toEqual(['apply a']);
  });
});
