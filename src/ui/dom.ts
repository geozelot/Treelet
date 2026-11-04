// ============================================================================
// treelet.js - DOM helpers for UI components
//
// SSR-safe base class and HTML sanitizing utilities. Importing the library in
// a non-DOM environment (server rendering, tests) must not throw, so UI
// classes extend `BaseElement` instead of referencing HTMLElement directly.
// ============================================================================

/** HTMLElement in browsers; an inert stand-in where the DOM is unavailable. */
export const BaseElement: typeof HTMLElement =
  typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement);

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for safe interpolation into HTML (content and quoted attributes). */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const ALLOWED_TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'SPAN', 'SMALL', 'SUP', 'SUB', 'BR']);

function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href, 'https://invalid.example/');
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Append attribution markup to `target` keeping only text and a small set of
 * inline tags. Links keep a safe `href` (http/https/mailto) and open in a new
 * tab; every other attribute, script, style or event handler is dropped.
 */
export function appendSanitizedHtml(target: Node, html: string, doc: Document = document): void {
  const template = doc.createElement('template');
  template.innerHTML = html; // inert: template content never executes
  const copy = (src: Node, dst: Node) => {
    for (const child of Array.from(src.childNodes)) {
      if (child.nodeType === 3) {
        dst.appendChild(doc.createTextNode(child.textContent ?? ''));
      } else if (child.nodeType === 1) {
        const el = child as Element;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          copy(el, dst); // keep the text, drop the element
          continue;
        }
        const out = doc.createElement(el.tagName.toLowerCase());
        if (el.tagName === 'A') {
          const href = el.getAttribute('href');
          if (href && isSafeHref(href)) {
            out.setAttribute('href', href);
            out.setAttribute('target', '_blank');
            out.setAttribute('rel', 'noopener noreferrer');
          }
        }
        copy(el, out);
        dst.appendChild(out);
      }
    }
  };
  copy(template.content, target);
}
