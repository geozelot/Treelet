// ============================================================================
// Tests for src/ui/dom.ts (escaping + attribution sanitizing)
// ============================================================================

import { describe, it, expect } from 'vitest';
import { escapeHtml, appendSanitizedHtml } from '../../src/ui/dom';

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">&\'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  });
});

describe('appendSanitizedHtml', () => {
  function render(html: string): HTMLElement {
    const el = document.createElement('span');
    appendSanitizedHtml(el, html);
    return el;
  }

  it('keeps safe links and opens them in a new tab', () => {
    const el = render('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(el.textContent).toBe('© OpenStreetMap contributors');
  });

  it('drops scripts, event handlers and javascript: URLs', () => {
    const el = render('<script>alert(1)</script><a href="javascript:alert(1)" onclick="x()">x</a><img src=x onerror=alert(1)>');
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    const a = el.querySelector('a')!;
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.hasAttribute('onclick')).toBe(false);
  });
});
