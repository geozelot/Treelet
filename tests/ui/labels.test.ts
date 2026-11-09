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
});
