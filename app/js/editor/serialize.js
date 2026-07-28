// editor/serialize.js - conversion between the editor's visual block model and
// Markdown, in both directions.
//   * inline HTML (<strong>/<em>/<code>/<a>) -> Markdown
//   * blocks -> Markdown (serializeDoc, normalize-on-save)
//   * an existing document's Markdown -> { meta, blocks } (parseDoc)
// Zero UI here - pure data transforms (plus the shared renderer/sanitizer).
import { renderMarkdown } from '../commonmark.js';
import { sanitizeToFragment } from '../sanitize.js';

/** @typedef {import('../editor.js').Block} Block */
/** @typedef {import('../editor.js').ImageBlock} ImageBlock */
/** @typedef {import('../editor.js').HrBlock} HrBlock */
/** @typedef {import('../editor.js').CodeBlock} CodeBlock */
/** @typedef {import('./widgets.js').TableBlock} TableBlock */
/** @typedef {import('./widgets.js').ReqBlock} ReqBlock */
/** @typedef {import('./widgets.js').TestCaseBlock} TestCaseBlock */

/**
 * The normalized document front-matter bundle read from / written to the
 * <!--meta ...--> header. serializeDoc/parseDoc (this file) are the canonical
 * write/read; editor.js's working `meta` object and editor/panels.js's
 * metadataPanel share and mutate the same shape.
 * @typedef {Object} DocMeta
 * @property {string} title
 * @property {string} description
 * @property {string[]} assumes
 * @property {string[]} next
 */

/**
 * @typedef {Object} HeadingMdBlock
 * @property {'heading'} type
 * @property {number} level
 * @property {string} text - Markdown source (already converted from HTML via htmlToMd)
 */
/**
 * @typedef {Object} ParagraphMdBlock
 * @property {'paragraph'} type
 * @property {string} text - Markdown source
 */
/**
 * @typedef {Object} QuoteMdBlock
 * @property {'quote'} type
 * @property {string} text - Markdown source
 */
/**
 * @typedef {Object} ListMdBlock
 * @property {'list'} type
 * @property {boolean} ordered
 * @property {string[]} items - Markdown source, one entry per list item
 */
/**
 * What blockToMd()/serializeDoc() actually consume: editor.js's onSave already
 * converts the four inline-HTML block types (heading/paragraph/quote/list) from
 * their visual, HTML-holding Block form to Markdown source (text/items) before
 * calling serializeDoc; every other block type is passed through unchanged and
 * keeps its original Block shape. Deliberately distinct from both editor.js's
 * HTML-based `Block` and md/blocks.js's parser-tree node `MdBlockNode`.
 * @typedef {HeadingMdBlock|ParagraphMdBlock|QuoteMdBlock|ListMdBlock|CodeBlock|TableBlock|ImageBlock|HrBlock|ReqBlock|TestCaseBlock} MdSourceBlock
 */

/* ---- Inline HTML -> Markdown ---- */
function escInline(s) {
  return s.replace(/([\\`*_[\]<>])/g, '\\$1');
}
/**
 * @param {Node} node
 * @returns {string}
 */
function inlineToMd(node) {
  let out = '';
  node.childNodes.forEach(n => {
    if (n.nodeType === 3) { out += escInline(n.nodeValue); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();
    const inner = inlineToMd(n);
    if (tag === 'strong' || tag === 'b') out += '**' + inner + '**';
    else if (tag === 'em' || tag === 'i') out += '*' + inner + '*';
    else if (tag === 'code') out += '`' + n.textContent + '`';
    else if (tag === 'del' || tag === 's') out += '~~' + inner + '~~';
    else if (tag === 'a') out += '[' + inner + '](' + mdDest(n.getAttribute('href') || '') + ')';
    // Image: prefer data-mdsrc (the ORIGINAL relative path the editor stashes when it
    // resolves a src to /docs/... for display) so a relative image round-trips as
    // written, not rewritten to an absolute server path. Without this case, <img>
    // fell through to `inner` (empty) and inline images were silently lost on save.
    else if (tag === 'img') out += '![' + (n.getAttribute('alt') || '') + '](' + mdDest(n.getAttribute('data-mdsrc') || n.getAttribute('src') || '') + ')';
    else if (tag === 'br') out += '  \n';
    else out += inner;
  });
  return out.replace(/\s+$/g, s => s.replace(/[^\n]/g, ' ')); // keep trailing spaces sane
}
// A Markdown link destination. Bare form breaks on spaces or parentheses, so use
// the angle-bracket form <...> for those, escaping backslash / < / > within.
function mdDest(url) {
  const u = String(url).replace(/[\r\n]+/g, '');
  if (/[\s()<>]/.test(u)) return '<' + u.replace(/([\\<>])/g, '\\$1') + '>';
  return u;
}
/**
 * @param {string} html
 * @returns {string}
 */
export function htmlToMd(html) {
  const d = document.createElement('div'); d.innerHTML = html || '';
  return inlineToMd(d).trim();
}

/* ---- Blocks -> Markdown ---- */
/**
 * @param {MdSourceBlock} b
 * @returns {string}
 */
function blockToMd(b) {
  switch (b.type) {
    case 'heading': return '#'.repeat(b.level) + ' ' + b.text;
    case 'paragraph': return b.text;
    case 'quote': return b.text.split('\n').map(l => '> ' + l).join('\n');
    case 'list': return b.items.map(it => (b.ordered ? '1. ' : '- ') + it).join('\n');
    case 'code': return '```' + (b.lang || '') + '\n' + b.code.replace(/\n$/, '') + '\n```';
    case 'hr': return '---';
    case 'image': return '![' + (b.alt || '') + '](' + (b.src || '') + ')';
    case 'table': {
      // GFM pipe table. Cells are inline HTML (rich-text contenteditable) -> convert
      // each to inline Markdown, then escape literal pipes and collapse newlines
      // (a cell must stay on one line; use <br> markup, which htmlToMd emits, for a
      // soft break within a cell).
      const headers = b.headers || [];
      const aligns = b.aligns || [];
      const rows = b.rows || [];
      const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ');
      const cellMd = (html) => esc(htmlToMd(String(html == null ? '' : html)));
      const sepFor = (a) => a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
      const rowLine = (cells) => '| ' + headers.map((_, i) => cellMd(cells[i])).join(' | ') + ' |';
      const lines = [rowLine(headers), '| ' + headers.map((_, i) => sepFor(aligns[i] || '')).join(' | ') + ' |'];
      rows.forEach(r => lines.push(rowLine(r)));
      return lines.join('\n');
    }
    case 'requirement': {
      const head = '<!--meta start {"requirement-group":' + JSON.stringify(b.group) + '}-->';
      const foot = '<!--meta end {"requirement-group":' + JSON.stringify(b.group) + '}-->';
      const rows = b.rows.map(r => '| ' + r.no + ' | ' + r.description + ' | ' + r.traceTo + ' |');
      return head + '\n| requirement-no | description | trace-to |\n| --- | --- | --- |\n' +
        rows.join('\n') + '\n' + foot;
    }
    case 'testcase': {
      // Steps are structured data in the meta header (a custom block, not a
      // markdown table), so any markdown - pipes, backslashes, lines - is safe.
      const meta = {
        test: b.key || 'test', name: b.name || '', verifies: b.verifies || [],
        steps: (b.steps || []).map(s => ({ action: s.action || '', expected: s.expected || '' }))
      };
      return '<!--meta start ' + JSON.stringify(meta) + '-->\n<!--meta end {"test":' + JSON.stringify(b.key || 'test') + '}-->';
    }
    default: return '';
  }
}
/**
 * @param {Partial<DocMeta>} meta
 * @param {MdSourceBlock[]} blocks
 * @returns {string}
 */
export function serializeDoc(meta, blocks) {
  const m = {
    title: meta.title || 'Untitled',
    description: meta.description || '',
    assumes: meta.assumes || [],
    next: meta.next || []
  };
  const header = '<!--meta\n' + JSON.stringify(m, null, 2) + '\n-->';
  const body = blocks.map(blockToMd).filter(s => s !== '').join('\n\n');
  return header + '\n\n' + body + '\n';
}

/* ---- Existing document -> { meta, blocks } ---- */
/**
 * @param {string} rawBody
 * @param {Partial<DocMeta>} [docMeta] - existing front-matter to preserve (a brand-new document passes {})
 * @returns {{meta: DocMeta, blocks: Block[]}}
 */
export function parseDoc(rawBody, docMeta) {
  // Pull requirement groups out first (they are meta-wrapped tables) and leave
  // placeholders, so their positions survive; everything else renders to HTML.
  const groups = [];
  const RE = /<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->([\s\S]*?)<!--\s*meta\s+end[\s\S]*?-->/gi;
  const cellsOf = (line) => {
    const cells = line.split('|').map(c => c.trim());
    return cells.filter((x, i) => !(i === 0 && x === '') && !(i === cells.length - 1 && x === ''));
  };
  let body = rawBody.replace(RE, (m, json, inner) => {
    let meta = {};
    try { meta = JSON.parse(json); } catch (e) {}
    if (meta.test || meta['test-case']) {   // test-case block
      let steps;
      if (Array.isArray(meta.steps)) {      // structured steps (current format)
        steps = meta.steps.map(s => ({ action: (s && s.action) || '', expected: (s && (s.expected || s['expected-response'] || s.response)) || '' }));
      } else {                              // legacy: action / expected rows in a table
        steps = [];
        inner.split('\n').forEach(line => {
          if (line.indexOf('|') === -1) return;
          const c = cellsOf(line);
          if (c.length >= 1 && !/^-+$/.test(c[0]) && c[0].toLowerCase() !== 'action')
            steps.push({ action: c[0], expected: c[1] || '' });
        });
      }
      groups.push({
        type: 'testcase', key: meta.test || meta['test-case'] || '', name: meta.name || '',
        verifies: Array.isArray(meta.verifies) ? meta.verifies.map(String) : [],
        steps: steps.length ? steps : [{ action: '', expected: '' }]
      });
      return '\n\n@@REQGROUP' + (groups.length - 1) + '@@\n\n';
    }
    const group = (meta && (meta['requirement-group'] || meta.group)) || '';
    const rows = [];
    inner.split('\n').forEach(line => {
      if (line.indexOf('|') === -1) return;
      const c = cellsOf(line);
      if (c.length >= 3 && !/^-+$/.test(c[0]) && c[0].toLowerCase() !== 'requirement-no')
        rows.push({ no: c[0], description: c[1], traceTo: c[2] });
    });
    groups.push({ type: 'requirement', group, rows });
    return '\n\n@@REQGROUP' + (groups.length - 1) + '@@\n\n';
  });

  const html = renderMarkdown(body);
  const frag = sanitizeToFragment(html);
  const holder = document.createElement('div');
  holder.appendChild(frag);

  const blocks = [];
  holder.childNodes.forEach(el => {
    if (el.nodeType === 3) {
      const txt = el.nodeValue.trim();
      const mm = /^@@REQGROUP(\d+)@@$/.exec(txt);
      if (mm) blocks.push(groups[+mm[1]]);
      return;
    }
    if (el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    const mm = /^@@REQGROUP(\d+)@@$/.exec(el.textContent.trim());
    if (mm) { blocks.push(groups[+mm[1]]); return; }
    if (/^h[1-6]$/.test(tag)) blocks.push({ type: 'heading', level: +tag[1], html: stripNums(el) });
    else if (tag === 'p') blocks.push({ type: 'paragraph', html: el.innerHTML });
    else if (tag === 'blockquote') blocks.push({ type: 'quote', html: el.innerHTML.replace(/<\/?p>/g, '').trim() });
    else if (tag === 'ul' || tag === 'ol') blocks.push({ type: 'list', ordered: tag === 'ol', itemsHtml: [...el.children].map(li => li.innerHTML) });
    else if (tag === 'pre') { const code = el.querySelector('code'); blocks.push({ type: 'code', lang: langOf(code), code: (code || el).textContent.replace(/\n$/, '') }); }
    else if (tag === 'hr') blocks.push({ type: 'hr' });
    else if (tag === 'table') blocks.push(tableBlock(el));
    else if (tag === 'figure' || tag === 'img') { const img = tag === 'img' ? el : el.querySelector('img'); if (img) blocks.push({ type: 'image', src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' }); }
    else if (el.textContent.trim()) blocks.push({ type: 'paragraph', html: el.innerHTML });
  });
  if (!blocks.length) blocks.push({ type: 'paragraph', html: '' });

  const meta = {
    title: (docMeta && docMeta.title) || '',
    description: (docMeta && docMeta.description) || '',
    assumes: (docMeta && docMeta.assumes) ? docMeta.assumes.slice() : [],
    next: (docMeta && docMeta.next) ? docMeta.next.slice() : []
  };
  return { meta, blocks };
}
/**
 * @param {Element} el
 * @returns {string}
 */
function stripNums(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.secnum').forEach(s => s.remove());
  return c.innerHTML.trim();
}
/**
 * @param {Element|null} code
 * @returns {string}
 */
function langOf(code) {
  if (!code) return '';
  const m = /language-([\w+.#-]+)/.exec(code.className || '');
  return m ? m[1] : '';
}
/**
 * @param {HTMLTableElement} table
 * @returns {TableBlock}
 */
function tableBlock(table) {
  // innerHTML (not textContent): cells carry inline markup - <strong>, <a>, <code>,
  // <img> - which round-trips back to inline Markdown on save.
  const headers = [...table.querySelectorAll('thead th')].map(th => th.innerHTML.trim());
  const aligns = [...table.querySelectorAll('thead th')].map(th => th.getAttribute('align') || '');
  const rows = [...table.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.innerHTML.trim()));
  return { type: 'table', headers, aligns, rows };
}

/* ---- Block-model factory (new blocks from the "+ Add block" menu) ---- */
/**
 * @param {string} type - a BLOCK_MENU entry's `type` (editor/ui.js), or 'list-ordered'
 * @returns {Block}
 */
export function newBlock(type) {
  if (type === 'list-ordered') return { type: 'list', ordered: true, itemsHtml: [''] };
  if (type === 'list') return { type: 'list', ordered: false, itemsHtml: [''] };
  if (type === 'heading') return { type: 'heading', level: 2, html: '' };
  if (type === 'code') return { type: 'code', lang: '', code: '' };
  if (type === 'quote') return { type: 'quote', html: '' };
  if (type === 'table') return { type: 'table', headers: ['Column 1', 'Column 2'], aligns: ['', ''], rows: [['', '']] };
  if (type === 'image') return { type: 'image', src: '', alt: '' };
  if (type === 'hr') return { type: 'hr' };
  if (type === 'requirement') return { type: 'requirement', group: 'grp', rows: [{ no: '1', description: '', traceTo: '' }] };
  if (type === 'testcase') return { type: 'testcase', key: 'test', name: '', verifies: [], steps: [{ action: '', expected: '' }] };
  return { type: 'paragraph', html: '' };
}
