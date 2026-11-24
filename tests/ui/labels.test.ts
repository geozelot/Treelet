// ============================================================================
// Tests for src/ui/TreeletLabels.ts: a label keeps its element across frames.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { defineTreeletElements } from '../../src/ui/elements';
import type { TreeletLabels } from '../../src/ui/TreeletLabels';

beforeAll(() => defineTreeletElements());

const label = (text: string, x = 0) => ({ text, x, y: 10, size: 12, color: '#fff', halo: '#000' });

describe('TreeletLabels', () => {
  it('keeps each label in its own element when another one drops out', () => {
    const el = document.createElement('treelet-labels') as TreeletLabels;
    document.body.appendChild(el);
    el.show([label('Alpha'), label('Beta', 50), label('Gamma', 100)]);
    const spans = () => [...el.shadowRoot!.querySelectorAll('span')];
    const gamma = spans().find((s) => s.textContent === 'Gamma')!;
    el.show([label('Beta', 52), label('Gamma', 102)]);
    // Gamma stayed in its element (only moved); Alpha's is hidden
    expect(spans().find((s) => s.textContent === 'Gamma')).toBe(gamma);
    expect(gamma.style.transform).toContain('102px');
    expect(spans().find((s) => s.textContent === 'Alpha')!.hidden).toBe(true);
    expect(el.count).toBe(2);
  });

  it('new labels take the hidden elements before new ones are made', () => {
    const el = document.createElement('treelet-labels') as TreeletLabels;
    document.body.appendChild(el);
    const spans = () => [...el.shadowRoot!.querySelectorAll('span')];
    el.show([label('A'), label('B'), label('C')]);
    el.show([label('C', 5), label('A', 6)]); // reordered, B gone
    expect(spans().filter((s) => !s.hidden).map((s) => s.textContent).sort()).toEqual(['A', 'C']);
    el.show([label('C'), label('A'), label('D'), label('E')]); // D takes B's element, E a new one
    expect(spans()).toHaveLength(4);
    expect(spans().map((s) => s.textContent)).toEqual(['A', 'D', 'C', 'E']);
    expect(el.count).toBe(4);
  });
});
