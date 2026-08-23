// numbering.ts - hierarchical heading numbers.
// A post-parse decoration on the sanitized DOM: the Markdown is never mutated,
// so it has no bearing on CommonMark compliance. Content numbers and TOC
// numbers come from a single pass, so they can never drift apart.
import { elem } from './dom.js';

function slugify(text: string): string {
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
 */
export interface TocEntry {
  /** heading level 1-6 (from the hN tag name) */
  level: number;
  /** dotted content number, e.g. "1.2.1" */
  number: string;
  /** heading textContent (numbering span excluded) */
  text: string;
  /** stable, collision-free element id assigned to the heading */
  id: string;
}

/**
 * Walk headings in document order, inject "1.2.1"-style labels, assign stable
 * ids, and return a flat TOC array.
 */
export function numberHeadings(root: ParentNode): TocEntry[] {
  const heads = root.querySelectorAll('h1,h2,h3,h4,h5,h6') as NodeListOf<HTMLHeadingElement>;
  const counters = [0, 0, 0, 0, 0, 0];
  const used = new Set<string>();
  const toc: TocEntry[] = [];

  heads.forEach(h => {
    const L = +h.tagName[1];
    counters[L - 1] += 1;
    for (let d = L; d < 6; d++) counters[d] = 0;
    for (let k = 0; k < L; k++) if (counters[k] === 0) counters[k] = 1; // graceful skips (h1 -> h3)
    const number = counters.slice(0, L).join('.');

    const text = h.textContent;
    const base = slugify(text) || ('sec-' + number);
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
