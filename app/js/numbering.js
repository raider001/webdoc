// numbering.js - hierarchical heading numbers + table of contents.
// A post-parse decoration on the sanitized DOM: the Markdown is never mutated,
// so it has no bearing on CommonMark compliance. Content numbers and TOC
// numbers come from a single pass, so they can never drift apart.
import { elem, append } from './dom.js';

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * One flattened table-of-contents entry, produced per heading by
 * numberHeadings() in document order; buildTOC() renders an array of these
 * into the nested-looking TOC list.
 * @typedef {Object} TocEntry
 * @property {number} level - heading level 1-6 (from the hN tag name)
 * @property {string} number - dotted content number, e.g. "1.2.1"
 * @property {string} text - heading textContent (numbering span excluded)
 * @property {string} id - stable, collision-free element id assigned to the heading
 */

/**
 * Walk headings in document order, inject "1.2.1"-style labels, assign stable
 * ids, and return a flat TOC array.
 * @param {ParentNode} root
 * @returns {TocEntry[]}
 */
export function numberHeadings(root) {
  const heads = root.querySelectorAll('h1,h2,h3,h4,h5,h6');
  const counters = [0, 0, 0, 0, 0, 0];
  const used = new Set();
  const toc = [];

  heads.forEach(h => {
    const L = +h.tagName[1];
    counters[L - 1] += 1;
    for (let d = L; d < 6; d++) counters[d] = 0;
    for (let k = 0; k < L; k++) if (counters[k] === 0) counters[k] = 1; // graceful skips (h1 -> h3)
    const number = counters.slice(0, L).join('.');

    const text = h.textContent;
    let base = slugify(text) || ('sec-' + number);
    let id = base, n = 2;
    while (used.has(id)) id = base + '-' + (n++);
    used.add(id);
    h.id = id;
    h.dataset.headingNumber = number;

    h.insertBefore(elem('span', 'secnum', number + ' '), h.firstChild);

    toc.push({ level: L, number, text, id });
  });

  return toc;
}

/**
 * Build a nested-looking TOC list from the flat array. Clicking an entry
 * scrolls the content pane to the heading without touching the router hash.
 * @param {TocEntry[]} toc
 * @param {HTMLElement} contentEl
 * @returns {HTMLElement}
 */
export function buildTOC(toc, contentEl) {
  const ol = elem('ol');
  for (const item of toc) {
    const a = elem('a', {
      href: '#' + item.id, 'data-target': item.id,
      onClick: ev => {
        ev.preventDefault();
        const target = contentEl.querySelector('#' + cssEscape(item.id));
        if (target) {
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
          target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        }
      }
    }, elem('span', 'n', item.number), item.text);   // item.text as a text node auto-escapes
    append(ol, elem('li', 'lvl-' + item.level, a));
  }
  return ol;
}

function cssEscape(id) {
  return (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/([^\w-])/g, '\\$1');
}
