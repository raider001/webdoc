// numbering.js - hierarchical heading numbers + table of contents.
// A post-parse decoration on the sanitized DOM: the Markdown is never mutated,
// so it has no bearing on CommonMark compliance. Content numbers and TOC
// numbers come from a single pass, so they can never drift apart.

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Walk headings in document order, inject "1.2.1"-style labels, assign stable
// ids, and return a flat TOC array: [{ level, number, text, id }].
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

    const span = document.createElement('span');
    span.className = 'secnum';
    span.textContent = number + ' ';
    h.insertBefore(span, h.firstChild);

    toc.push({ level: L, number, text, id });
  });

  return toc;
}

// Build a nested-looking TOC list from the flat array. Clicking an entry
// scrolls the content pane to the heading without touching the router hash.
export function buildTOC(toc, contentEl) {
  const ol = document.createElement('ol');
  for (const item of toc) {
    const li = document.createElement('li');
    li.className = 'lvl-' + item.level;
    const a = document.createElement('a');
    a.href = '#' + item.id;
    a.dataset.target = item.id;
    a.innerHTML = '<span class="n">' + item.number + '</span>' + escapeText(item.text);
    a.addEventListener('click', ev => {
      ev.preventDefault();
      const target = contentEl.querySelector('#' + cssEscape(item.id));
      if (target) {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
    li.appendChild(a);
    ol.appendChild(li);
  }
  return ol;
}

function escapeText(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function cssEscape(id) {
  return (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/([^\w-])/g, '\\$1');
}
