// editor.js - a hand-written, zero-dependency WYSIWYG block editor.
// ---------------------------------------------------------------------------
// The author never touches Markdown. A document is edited as a list of visual
// BLOCKS (heading, paragraph, list, code, quote, rule, table, requirement).
// Text blocks are contenteditable and hold inline HTML (<strong>/<em>/<code>/<a>);
// on save each block serialises to Markdown and the whole doc is regenerated
// (normalize-on-save). Document metadata is edited in a side panel; a new doc is
// created from a modal that works on the web path {source}/path/to/doc.
// ---------------------------------------------------------------------------
import { renderMarkdown } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';

/* ===========================================================================
   Inline HTML  ->  Markdown
   =========================================================================== */
function escInline(s) {
  return s.replace(/([\\`*_[\]<>])/g, '\\$1');
}
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

/* ===========================================================================
   Blocks  ->  Markdown
   =========================================================================== */
function blockToMd(b) {
  switch (b.type) {
    case 'heading': return '#'.repeat(b.level) + ' ' + b.text;
    case 'paragraph': return b.text;
    case 'quote': return b.text.split('\n').map(l => '> ' + l).join('\n');
    case 'list': return b.items.map(it => (b.ordered ? '1. ' : '- ') + it).join('\n');
    case 'code': return '```' + (b.lang || '') + '\n' + b.code.replace(/\n$/, '') + '\n```';
    case 'hr': return '---';
    case 'image': return '![' + (b.alt || '') + '](' + (b.src || '') + ')';
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

/* ===========================================================================
   Existing document  ->  { meta, blocks }
   =========================================================================== */
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
function stripNums(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.secnum').forEach(s => s.remove());
  return c.innerHTML.trim();
}
function langOf(code) {
  if (!code) return '';
  const m = /language-([\w+.#-]+)/.exec(code.className || '');
  return m ? m[1] : '';
}
function tableBlock(table) {
  const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
  const aligns = [...table.querySelectorAll('thead th')].map(th => th.getAttribute('align') || '');
  const rows = [...table.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
  return { type: 'table', headers, aligns, rows };
}

/* ===========================================================================
   The editor UI
   =========================================================================== */
const BLOCK_MENU = [
  { type: 'paragraph', label: 'Text' },
  { type: 'heading', label: 'Heading' },
  { type: 'list', label: 'Bulleted list' },
  { type: 'list-ordered', label: 'Numbered list' },
  { type: 'code', label: 'Code' },
  { type: 'quote', label: 'Quote' },
  { type: 'table', label: 'Table' },
  { type: 'image', label: 'Image' },
  { type: 'hr', label: 'Divider' },
  { type: 'requirement', label: 'Requirement group' },
  { type: 'testcase', label: 'Test case' }
];

// opts: { docId, meta, blocks, sources, allDocs, isNew, onSave(md, meta), onClose() }
export function openEditor(opts) {
  setLinkDocs(opts.allDocs);   // feed the link popover's URL autocomplete
  const root = document.createElement('div');
  root.className = 'editor';

  // --- block canvas (left/centre) ---
  const canvas = document.createElement('div');
  canvas.className = 'editor-canvas';
  const list = document.createElement('div');
  list.className = 'editor-blocks';
  canvas.appendChild(list);

  const blocks = opts.blocks.map(b => ({ ...b }));

  // The trace-to picker's options, computed LIVE each time it opens: the saved
  // requirements from every other document PLUS the ones being edited right now
  // in this document (composed from the current component + group + number), so
  // intra-session traces autocomplete without needing a save first.
  const liveReqs = () => {
    const list = (opts.requirements || []).slice();
    const seen = new Set(list.map(q => q.id));
    const comp = opts.component || '';
    if (comp) blocks.forEach(b => {
      if (b.type === 'requirement' && b.group) (b.rows || []).forEach(row => {
        const no = (row.no || '').trim();
        if (!no) return;
        const id = ('R_' + comp + '_' + b.group + '_' + no).toUpperCase();   // matches the composed requirement id
        if (!seen.has(id)) { seen.add(id); list.push({ id: id, description: row.description || '', docId: opts.docId, group: b.group }); }
      });
    });
    return list;
  };

  function repaint() {
    list.textContent = '';
    blocks.forEach((b, i) => list.appendChild(renderBlockEditor(b, i)));
    const add = document.createElement('button');
    add.className = 'blk-add-end';
    add.textContent = '+ Add block';
    add.addEventListener('click', () => openBlockMenu(add, t => { blocks.push(newBlock(t)); repaint(); }));
    list.appendChild(add);
  }

  function renderBlockEditor(b, i) {
    const wrap = document.createElement('div');
    wrap.className = 'blk blk-' + b.type;

    const gutter = document.createElement('div');
    gutter.className = 'blk-gutter';
    gutter.appendChild(iconBtn('↑', 'Move up', () => { if (i > 0) { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; repaint(); } }));
    gutter.appendChild(iconBtn('↓', 'Move down', () => { if (i < blocks.length - 1) { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; repaint(); } }));
    gutter.appendChild(iconBtn('＋', 'Insert below', (e) => openBlockMenu(e.target, t => { blocks.splice(i + 1, 0, newBlock(t)); repaint(); })));
    gutter.appendChild(iconBtn('✕', 'Delete', () => { blocks.splice(i, 1); if (!blocks.length) blocks.push(newBlock('paragraph')); repaint(); }));
    wrap.appendChild(gutter);

    const body = document.createElement('div');
    body.className = 'blk-body';
    body.appendChild(blockField(b));
    wrap.appendChild(body);
    return wrap;
  }

  // Build the editable field(s) for a block, writing edits back into `b`.
  function blockField(b) {
    if (b.type === 'heading') {
      const row = document.createElement('div'); row.className = 'blk-heading';
      const sel = document.createElement('select');
      for (let l = 1; l <= 6; l++) { const o = document.createElement('option'); o.value = l; o.textContent = 'H' + l; if (b.level === l) o.selected = true; sel.appendChild(o); }
      sel.addEventListener('change', () => { b.level = +sel.value; });
      const ed = editable(b.html || '', 'heading', h => b.html = h, 'h' + (b.level || 2));
      row.appendChild(sel); row.appendChild(ed);
      return row;
    }
    if (b.type === 'paragraph') return editable(b.html || '', 'para', h => b.html = h, 'Write text…');
    if (b.type === 'quote') return editable(b.html || '', 'quote', h => b.html = h, 'Quote…');
    if (b.type === 'list') {
      const ul = document.createElement(b.ordered ? 'ol' : 'ul'); ul.className = 'blk-list';
      (b.itemsHtml || ['']).forEach(html => ul.appendChild(listItem(html)));
      ul.setAttribute('contenteditable', 'true');
      ul.addEventListener('input', () => { b.itemsHtml = [...ul.querySelectorAll('li')].map(li => li.innerHTML); });
      attachInlineToolbar(ul);
      // seed items into b in case it never receives input
      b.itemsHtml = [...ul.querySelectorAll('li')].map(li => li.innerHTML);
      return ul;
    }
    if (b.type === 'code') {
      const box = document.createElement('div'); box.className = 'blk-codebox';
      const lang = document.createElement('input'); lang.className = 'blk-lang'; lang.placeholder = 'language (e.g. python)'; lang.value = b.lang || '';
      lang.addEventListener('input', () => b.lang = lang.value.trim());
      const ta = document.createElement('textarea'); ta.className = 'blk-code'; ta.value = b.code || ''; ta.rows = Math.max(3, (b.code || '').split('\n').length);
      ta.addEventListener('input', () => { b.code = ta.value; ta.rows = Math.max(3, ta.value.split('\n').length); });
      box.appendChild(lang); box.appendChild(ta);
      return box;
    }
    if (b.type === 'table') return tableEditor(b);
    if (b.type === 'image') {
      const box = document.createElement('div'); box.className = 'blk-imgbox';
      const src = labeledInput('Image URL', b.src || '', v => b.src = v);
      const alt = labeledInput('Alt text', b.alt || '', v => b.alt = v);
      box.appendChild(src); box.appendChild(alt);
      return box;
    }
    if (b.type === 'hr') { const d = document.createElement('div'); d.className = 'blk-hr'; d.textContent = '— divider —'; return d; }
    if (b.type === 'requirement') return requirementWidget(b, liveReqs);
    if (b.type === 'testcase') return testCaseWidget(b, liveReqs, opts.component);
    const d = document.createElement('div'); d.textContent = '(unsupported block)'; return d;
  }

  repaint();

  // --- metadata panel (right) ---
  const meta = { ...opts.meta, assumes: (opts.meta.assumes || []).slice(), next: (opts.meta.next || []).slice() };
  const panel = metadataPanel(meta, opts.allDocs, opts.docId);

  // --- toolbar ---
  const bar = document.createElement('div');
  bar.className = 'editor-bar';
  const title = document.createElement('span'); title.className = 'editor-bar-title';
  title.textContent = (opts.isNew ? 'New document · ' : 'Editing · ') + opts.docId;
  const spacer = document.createElement('span'); spacer.style.flex = '1';
  const status = document.createElement('span'); status.className = 'editor-status';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => opts.onClose());
  const save = document.createElement('button'); save.className = 'btn btn-primary'; save.textContent = 'Save';
  save.addEventListener('click', () => {
    // pull inline HTML -> markdown for text blocks
    const out = blocks.map(b => {
      if (b.type === 'heading') return { type: 'heading', level: b.level || 2, text: htmlToMd(b.html) };
      if (b.type === 'paragraph') return { type: 'paragraph', text: htmlToMd(b.html) };
      if (b.type === 'quote') return { type: 'quote', text: htmlToMd(b.html) };
      if (b.type === 'list') return { type: 'list', ordered: b.ordered, items: (b.itemsHtml || []).map(htmlToMd).filter(x => x !== '') };
      return b;
    });
    meta.title = meta.title || opts.meta.title || 'Untitled';
    const md = serializeDoc(meta, out);
    status.textContent = 'Saving…';
    opts.onSave(md, meta, status);
  });
  bar.append(title, spacer, status, cancel, save);

  const cols = document.createElement('div'); cols.className = 'editor-cols';
  cols.append(canvas, panel);
  root.append(bar, cols);
  return root;
}

function htmlToMd(html) {
  const d = document.createElement('div'); d.innerHTML = html || '';
  return inlineToMd(d).trim();
}
function newBlock(type) {
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

/* ---- editable inline field (contenteditable + inline toolbar) ---- */
function editable(html, cls, onChange, placeholder) {
  const ed = document.createElement('div');
  ed.className = 'blk-edit blk-edit-' + cls;
  ed.setAttribute('contenteditable', 'true');
  ed.setAttribute('data-ph', placeholder || '');
  ed.innerHTML = html;
  ed.addEventListener('input', () => onChange(ed.innerHTML));
  attachInlineToolbar(ed);
  return ed;
}
function listItem(html) { const li = document.createElement('li'); li.innerHTML = html || ''; return li; }

// A standalone rich-text field (contenteditable + the shared inline toolbar),
// for callers outside the block editor (e.g. the manual-test editor).
export function richText(html, onChange, placeholder) {
  const ed = document.createElement('div');
  ed.className = 'wysiwyg';
  ed.setAttribute('contenteditable', 'true');
  ed.setAttribute('data-ph', placeholder || '');
  ed.innerHTML = html || '';
  ed.addEventListener('input', () => onChange(ed.innerHTML));
  attachInlineToolbar(ed);
  return ed;
}

// A small floating toolbar (Bold / Italic / Code / Link) shown on selection.
let sharedBar = null;
function attachInlineToolbar(ed) {
  ed.addEventListener('mouseup', showBar);
  ed.addEventListener('keyup', showBar);
  // Click an existing link to edit its text / URL or unlink it (no prompt()).
  ed.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a');
    if (!a || !ed.contains(a)) return;
    e.preventDefault();
    if (sharedBar) sharedBar.style.display = 'none';
    const plain = !a.querySelector('*');   // link wraps only text -> its text is editable
    openLinkPopover({
      rect: a.getBoundingClientRect(),
      text: a.textContent, url: a.getAttribute('href') || '', canText: plain,
      onApply: (text, url) => { a.setAttribute('href', url); if (plain && text !== a.textContent) a.textContent = text; fireInput(ed); },
      onRemove: () => { unwrapAnchor(a); fireInput(ed); }
    });
  });
  ed.addEventListener('blur', () => setTimeout(() => { if (sharedBar && !sharedBar.matches(':hover')) sharedBar.style.display = 'none'; }, 150));
  ed.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); document.execCommand('bold'); }
      else if (e.key === 'i') { e.preventDefault(); document.execCommand('italic'); }
    }
  });
  function showBar() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !ed.contains(sel.anchorNode)) { if (sharedBar) sharedBar.style.display = 'none'; return; }
    const bar = ensureBar();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    bar.style.display = 'flex';
    bar.style.top = (window.scrollY + r.top - 40) + 'px';
    bar.style.left = (window.scrollX + r.left) + 'px';
  }
}
function ensureBar() {
  if (sharedBar) return sharedBar;
  sharedBar = document.createElement('div');
  sharedBar.className = 'inline-bar';
  const mk = (label, fn, title) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.addEventListener('mousedown', e => { e.preventDefault(); fn(); }); return b; };
  sharedBar.append(
    mk('B', () => document.execCommand('bold'), 'Bold'),
    mk('I', () => document.execCommand('italic'), 'Italic'),
    mk('<>', wrapCode, 'Inline code'),
    mk('🔗', addLink, 'Link')
  );
  document.body.appendChild(sharedBar);
  return sharedBar;
}
function wrapCode() {
  const sel = window.getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const code = document.createElement('code');
  code.textContent = range.toString();
  range.deleteContents(); range.insertNode(code);
  sel.removeAllRanges();
  // fire input on the editable
  const host = code.closest('[contenteditable]'); if (host) host.dispatchEvent(new Event('input', { bubbles: true }));
}
// Link button on the inline toolbar. Selection preserved (buttons preventDefault
// on mousedown). Opens the popover to create a link, or to edit one the caret is
// inside. Text is editable when inserting fresh or editing an existing link; when
// wrapping a selection the selected text is kept.
function addLink() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0).cloneRange();
  const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const host = startEl && startEl.closest('[contenteditable]');
  if (!host) return;
  if (sharedBar) sharedBar.style.display = 'none';
  const a = existingAnchor(range);
  const aPlain = a ? !a.querySelector('*') : false;   // formatted link -> keep its markup, text not editable
  openLinkPopover({
    rect: a ? a.getBoundingClientRect() : range.getBoundingClientRect(),
    text: a ? a.textContent : sel.toString(),
    url: a ? (a.getAttribute('href') || '') : '',
    canText: a ? aPlain : range.collapsed,  // edit text for a plain link or a fresh insert; keep selected text when wrapping
    onApply: (text, url) => applyLink(host, range, a, text, url),
    onRemove: a ? () => { unwrapAnchor(a); fireInput(host); } : null
  });
}

function applyLink(host, range, a, text, url) {
  if (a) {
    a.setAttribute('href', url);
    if (!a.querySelector('*') && text != null && text !== a.textContent) a.textContent = text; // don't flatten inner markup
  } else if (!range.collapsed) {
    const link = document.createElement('a'); link.href = url;
    try { range.surroundContents(link); }
    catch (e) { const frag = range.extractContents(); link.appendChild(frag); range.insertNode(link); }
    link.querySelectorAll('a').forEach(unwrapAnchor); // no nested anchors (would be invalid Markdown)
    if (text && text !== link.textContent) link.textContent = text;
  } else {
    const link = document.createElement('a'); link.href = url; link.textContent = text || url;
    range.insertNode(link);
  }
  fireInput(host);
}

// The <a> the range starts inside (within an editable), if any.
function existingAnchor(range) {
  let n = range.startContainer;
  n = n.nodeType === 1 ? n : n.parentElement;
  const a = n && n.closest ? n.closest('a') : null;
  return (a && a.closest('[contenteditable]')) ? a : null;
}
function unwrapAnchor(a) {
  const parent = a.parentNode; if (!parent) return;
  while (a.firstChild) parent.insertBefore(a.firstChild, a);
  parent.removeChild(a);
}
function fireInput(host) { if (host) host.dispatchEvent(new Event('input', { bubbles: true })); }

// Accept the same URL shapes the sanitizer keeps; bare domains get https://.
// Returns '' for an unsafe/empty URL (caller flags the field).
function normalizeUrl(v) {
  v = (v || '').trim();
  if (!v) return '';
  if (/^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';                 // some other scheme (javascript:, data:) -> reject
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(v)) return 'https://' + v; // bare domain
  return v;                                                      // relative-ish path
}

// A small popover (Text + URL, Apply / Unlink / Cancel) — replaces window.prompt.
// o: { rect, text, url, canText, onApply(text,url), onRemove|null }
let linkPop = null, linkOff = null;
let linkDocs = [];   // documents offered by the URL autocomplete: [{ id, title }]
export function setLinkDocs(docs) { linkDocs = Array.isArray(docs) ? docs : []; }
function closeLinkPop() {
  if (linkOff) { document.removeEventListener('mousedown', linkOff); linkOff = null; } // no leaked global listener
  if (linkPop) { linkPop.remove(); linkPop = null; }
  document.querySelectorAll('.link-ac').forEach(n => n.remove());
}
function openLinkPopover(o) {
  closeLinkPop();
  const pop = document.createElement('div'); pop.className = 'link-pop';
  function mkRow(labelTxt, val, ph, disabled) {
    const row = document.createElement('label'); row.className = 'link-pop-row';
    const s = document.createElement('span'); s.textContent = labelTxt;
    const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; i.placeholder = ph || ''; i.disabled = !!disabled;
    row.append(s, i); return i;
  }
  const tIn = mkRow('Text', o.text, 'Link text', !o.canText);
  const uIn = mkRow('URL', o.url, 'https://…', false); uIn.classList.add('link-pop-url');
  const bar = document.createElement('div'); bar.className = 'link-pop-bar';
  const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'link-pop-remove'; rm.textContent = 'Unlink';
  const sp = document.createElement('span'); sp.style.flex = '1';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'link-pop-apply'; apply.textContent = 'Apply';
  bar.append(rm, sp, cancel, apply);
  if (!o.onRemove) rm.style.display = 'none';
  pop.append(tIn.parentElement, uIn.parentElement, bar);
  document.body.appendChild(pop);
  linkPop = pop;

  const r = o.rect || { bottom: 80, left: 80 };
  const w = 300;
  pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
  pop.style.left = (window.scrollX + Math.max(8, Math.min(r.left, window.innerWidth - w - 12))) + 'px';

  function commit() {
    const url = normalizeUrl(uIn.value);
    if (!url) { pop.classList.add('link-pop-err'); uIn.focus(); return; }
    o.onApply(o.canText ? tIn.value : o.text, url);
    closeLinkPop();
  }
  apply.addEventListener('click', commit);
  cancel.addEventListener('mousedown', e => { e.preventDefault(); closeLinkPop(); });
  rm.addEventListener('click', () => { if (o.onRemove) o.onRemove(); closeLinkPop(); });

  // URL autocomplete: suggest internal documents by title / id. Selecting one
  // inserts its doc id (the reading view resolves it to a route). Typing a real
  // URL (scheme, /, #) suppresses the list, so external links still work freely.
  let acItems = [], acActive = -1, acDrop = null;
  function looksExternal(v) { return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(v); }
  function closeUrlAc() { if (acDrop) { acDrop.remove(); acDrop = null; } acItems = []; acActive = -1; }
  function pickDoc(d) { uIn.value = d.id; if (o.canText && !tIn.disabled && !tIn.value) tIn.value = d.title || d.id; pop.classList.remove('link-pop-err'); closeUrlAc(); uIn.focus(); }
  function openUrlAc() {
    const q = uIn.value.trim().toLowerCase();
    if (looksExternal(uIn.value.trim())) { closeUrlAc(); return; }
    acItems = linkDocs.filter(d => !q || (d.id && d.id.toLowerCase().includes(q)) || (d.title && d.title.toLowerCase().includes(q))).slice(0, 8);
    if (!acItems.length) { closeUrlAc(); return; }
    if (acActive >= acItems.length) acActive = acItems.length - 1;
    if (!acDrop) { acDrop = document.createElement('div'); acDrop.className = 'ac-drop link-ac'; document.body.appendChild(acDrop); }
    acDrop.textContent = '';
    acItems.forEach((d, idx) => {
      const opt = document.createElement('div'); opt.className = 'ac-opt' + (idx === acActive ? ' is-active' : '');
      const idEl = document.createElement('span'); idEl.className = 'ac-id'; idEl.textContent = d.title || d.id;
      const de = document.createElement('span'); de.className = 'ac-desc'; de.textContent = d.id;
      opt.append(idEl, de);
      opt.addEventListener('mousedown', e => { e.preventDefault(); pickDoc(d); });
      acDrop.appendChild(opt);
    });
    const rc = uIn.getBoundingClientRect();
    acDrop.style.left = (window.scrollX + rc.left) + 'px';
    acDrop.style.top = (window.scrollY + rc.bottom + 3) + 'px';
    acDrop.style.minWidth = Math.max(220, rc.width) + 'px';
  }
  uIn.addEventListener('input', () => { pop.classList.remove('link-pop-err'); acActive = -1; openUrlAc(); });
  uIn.addEventListener('focus', openUrlAc);
  uIn.addEventListener('keydown', e => {
    if (acDrop && acItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acItems.length - 1, acActive + 1); openUrlAc(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(0, acActive - 1); openUrlAc(); return; }
      if (e.key === 'Enter' && acActive >= 0) { e.preventDefault(); pickDoc(acItems[acActive]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeUrlAc(); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLinkPop(); }
  });
  tIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLinkPop(); }
  });

  linkOff = function (e) {
    if (linkPop && !linkPop.contains(e.target) && !(e.target.closest && e.target.closest('.link-ac'))) closeLinkPop();
  };
  setTimeout(() => document.addEventListener('mousedown', linkOff), 0);
  setTimeout(() => ((o.canText && !tIn.value) ? tIn : uIn).focus(), 20);
}

/* ---- table editor ---- */
function tableEditor(b) {
  const box = document.createElement('div'); box.className = 'blk-tablebox';
  function draw() {
    box.textContent = '';
    const t = document.createElement('table'); t.className = 'blk-table';
    const thead = document.createElement('tr');
    b.headers.forEach((h, ci) => thead.appendChild(cell(h, v => b.headers[ci] = v, true)));
    t.appendChild(thead);
    b.rows.forEach((row, ri) => {
      const tr = document.createElement('tr');
      row.forEach((c, ci) => tr.appendChild(cell(c, v => b.rows[ri][ci] = v, false)));
      t.appendChild(tr);
    });
    box.appendChild(t);
    const ctr = document.createElement('div'); ctr.className = 'blk-table-ctr';
    ctr.appendChild(smallBtn('+ Row', () => { b.rows.push(b.headers.map(() => '')); draw(); }));
    ctr.appendChild(smallBtn('+ Column', () => { b.headers.push('Column ' + (b.headers.length + 1)); b.aligns.push(''); b.rows.forEach(r => r.push('')); draw(); }));
    if (b.rows.length) ctr.appendChild(smallBtn('− Row', () => { b.rows.pop(); draw(); }));
    if (b.headers.length > 1) ctr.appendChild(smallBtn('− Column', () => { b.headers.pop(); b.aligns.pop(); b.rows.forEach(r => r.pop()); draw(); }));
    box.appendChild(ctr);
  }
  function cell(val, onChange, head) {
    const td = document.createElement(head ? 'th' : 'td');
    const inp = document.createElement('input'); inp.value = val; inp.addEventListener('input', () => onChange(inp.value));
    td.appendChild(inp); return td;
  }
  draw();
  return box;
}

/* ---- requirement widget ---- */
function requirementWidget(b, getReqs) {
  const box = document.createElement('div'); box.className = 'blk-reqbox';
  const gl = document.createElement('label'); gl.className = 'blk-reqgroup';
  gl.append('Requirement group ', (() => { const i = document.createElement('input'); i.value = b.group || ''; i.placeholder = 'e.g. sys'; i.addEventListener('input', () => b.group = i.value.trim()); return i; })());
  box.appendChild(gl);
  const table = document.createElement('div'); box.appendChild(table);
  function draw() {
    table.textContent = '';
    const head = document.createElement('div'); head.className = 'req-row req-head';
    head.append(span('No.'), span('Description'), span('Trace to'), span(''));
    table.appendChild(head);
    b.rows.forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'req-row';
      row.appendChild(field(r.no, v => r.no = v, 'no'));
      row.appendChild(field(r.description, v => r.description = v, 'wide'));
      row.appendChild(traceToField(r, getReqs));
      row.appendChild(smallBtn('✕', () => { b.rows.splice(i, 1); if (!b.rows.length) b.rows.push({ no: '1', description: '', traceTo: '' }); draw(); }));
      table.appendChild(row);
    });
    const add = smallBtn('+ Requirement', () => { b.rows.push({ no: String(b.rows.length + 1), description: '', traceTo: '' }); draw(); });
    add.className = 'blk-req-add'; table.appendChild(add);
  }
  function field(val, onChange, cls) { const i = document.createElement('input'); i.className = 'req-f req-f-' + cls; i.value = val || ''; i.addEventListener('input', () => onChange(i.value)); return i; }
  function span(t) { const s = document.createElement('span'); s.textContent = t; return s; }
  draw();
  return box;
}

/* ---- test-case widget: key + name + Verifies picker + action/expected steps ---- */
function testCaseWidget(b, getReqs, comp) {
  const box = document.createElement('div'); box.className = 'blk-reqbox blk-tcbox';
  function input(val, onChange, ph) { const i = document.createElement('input'); i.value = val || ''; i.placeholder = ph || ''; i.addEventListener('input', () => onChange(i.value)); return i; }
  function labeled(txt, node) { const l = document.createElement('label'); l.className = 'blk-reqgroup'; l.append(txt + ' ', node); box.appendChild(l); }
  function span(t) { const s = document.createElement('span'); s.textContent = t; return s; }
  // Multi-line markdown source field (auto-grows).
  function mdField(val, onChange, ph) {
    const t = document.createElement('textarea'); t.className = 'req-f req-f-md'; t.value = val || ''; t.rows = 1; t.placeholder = ph || '';
    const grow = () => { t.style.height = 'auto'; t.style.height = Math.max(30, t.scrollHeight) + 'px'; };
    t.addEventListener('input', () => { onChange(t.value); grow(); });
    setTimeout(grow, 0);
    return t;
  }

  labeled('Test key', input(b.key, v => { b.key = v.trim(); updatePreview(); }, 'e.g. login-valid'));
  labeled('Name', input(b.name, v => b.name = v, 'e.g. Valid login'));
  const preview = document.createElement('div'); preview.className = 'blk-tc-preview'; box.appendChild(preview);
  function updatePreview() { preview.textContent = 'id: T_' + (comp || '{component}') + '_' + (b.key || 'key'); }
  updatePreview();

  const vl = document.createElement('label'); vl.className = 'blk-reqgroup blk-tc-verifies'; vl.append('Verifies ');
  vl.appendChild(refsField(b.verifies || [], refs => b.verifies = refs, getReqs, 'requirement…'));
  box.appendChild(vl);

  const table = document.createElement('div'); box.appendChild(table);
  function draw() {
    table.textContent = '';
    const head = document.createElement('div'); head.className = 'req-row tc-erow req-head';
    head.append(span('Action'), span('Expected response'), span(''));
    table.appendChild(head);
    b.steps.forEach((s, i) => {
      const row = document.createElement('div'); row.className = 'req-row tc-erow';
      row.appendChild(mdField(s.action, v => s.action = v, 'action (markdown ok)…'));
      row.appendChild(mdField(s.expected, v => s.expected = v, 'expected response (markdown ok)…'));
      row.appendChild(smallBtn('✕', () => { b.steps.splice(i, 1); if (!b.steps.length) b.steps.push({ action: '', expected: '' }); draw(); }));
      table.appendChild(row);
    });
    const add = smallBtn('+ Step', () => { b.steps.push({ action: '', expected: '' }); draw(); }); add.className = 'blk-req-add'; table.appendChild(add);
  }
  draw();
  return box;
}

/* ---- reference picker: chips + a live autocomplete dropdown (id + description).
   Generic over the target list (requirements) so both a requirement's Trace-To and
   a test case's Verifies reuse it. ---- */
let acDrop = null, acItems = [], acActive = -1;
function closeAc() { if (acDrop) acDrop.hidden = true; acItems = []; acActive = -1; }
function traceToField(r, getReqs) {
  return refsField((r.traceTo || '').split(',').map(s => s.trim()).filter(Boolean),
    refs => { r.traceTo = refs.join(', '); }, getReqs, 'trace to…');
}
function refsField(initial, onChange, getReqs, placeholder) {
  const wrap = document.createElement('div'); wrap.className = 'req-trace';
  let refs = (initial || []).slice();
  const chips = document.createElement('div'); chips.className = 'req-trace-chips';
  const inp = document.createElement('input'); inp.className = 'req-trace-inp'; inp.placeholder = refs.length ? '' : (placeholder || '');

  function sync() { onChange(refs.slice()); }
  function drawChips() {
    chips.textContent = '';
    const known = new Set(getReqs().map(q => q.id));
    refs.forEach((ref, i) => {
      const c = document.createElement('span'); c.className = 'req-chip' + (known.has(ref) ? '' : ' req-chip-unknown');
      c.textContent = ref;
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remove';
      x.addEventListener('click', () => { refs.splice(i, 1); drawChips(); sync(); inp.placeholder = refs.length ? '' : (placeholder || ''); });
      c.appendChild(x); chips.appendChild(c);
    });
  }
  function addRef(v) { v = (v || '').trim().replace(/,+$/, ''); if (v && !refs.includes(v)) { refs.push(v); drawChips(); sync(); } inp.value = ''; inp.placeholder = ''; }

  function openAc() {
    const q = inp.value.trim().toLowerCase();
    acItems = getReqs().filter(x => !refs.includes(x.id) &&
      (!q || x.id.toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q))).slice(0, 10);
    if (!acDrop) { acDrop = document.createElement('div'); acDrop.className = 'ac-drop'; document.body.appendChild(acDrop); }
    if (!acItems.length) { acDrop.hidden = true; return; }
    if (acActive >= acItems.length) acActive = acItems.length - 1;
    acDrop.textContent = '';
    acItems.forEach((m, idx) => {
      const opt = document.createElement('div'); opt.className = 'ac-opt' + (idx === acActive ? ' is-active' : '');
      const id = document.createElement('span'); id.className = 'ac-id'; id.textContent = m.id;
      const de = document.createElement('span'); de.className = 'ac-desc'; de.textContent = m.description || '';
      opt.append(id, de);
      opt.addEventListener('mousedown', e => { e.preventDefault(); addRef(m.id); closeAc(); });
      acDrop.appendChild(opt);
    });
    const rc = inp.getBoundingClientRect();
    acDrop.style.left = (window.scrollX + rc.left) + 'px';
    acDrop.style.top = (window.scrollY + rc.bottom + 3) + 'px';
    acDrop.style.minWidth = Math.max(240, rc.width) + 'px';
    acDrop.hidden = false;
  }
  inp.addEventListener('focus', () => { acActive = -1; openAc(); });
  inp.addEventListener('input', () => { acActive = -1; openAc(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acItems.length - 1, acActive + 1); openAc(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(0, acActive - 1); openAc(); }
    else if (e.key === 'Enter') { e.preventDefault(); addRef(acActive >= 0 && acItems[acActive] ? acItems[acActive].id : inp.value); closeAc(); }
    else if (e.key === ',') { e.preventDefault(); addRef(inp.value); closeAc(); }
    else if (e.key === 'Escape') { closeAc(); }
  });
  inp.addEventListener('blur', () => setTimeout(closeAc, 150));
  wrap.append(chips, inp);
  drawChips();
  return wrap;
}

/* ---- metadata panel ---- */
function metadataPanel(meta, allDocs, selfId) {
  const panel = document.createElement('aside'); panel.className = 'editor-meta';
  panel.appendChild(hd('Document metadata'));
  panel.appendChild(labeledInput('Title', meta.title || '', v => meta.title = v));
  panel.appendChild(labeledTextarea('Description', meta.description || '', v => meta.description = v));
  panel.appendChild(docPicker('Assumed knowledge', meta.assumes, allDocs, selfId));
  panel.appendChild(docPicker('Recommended next', meta.next, allDocs, selfId));
  return panel;
  function hd(t) { const h = document.createElement('h2'); h.className = 'editor-meta-h'; h.textContent = t; return h; }
}
function docPicker(label, arr, allDocs, selfId) {
  const wrap = document.createElement('div'); wrap.className = 'meta-field';
  const lab = document.createElement('label'); lab.textContent = label; wrap.appendChild(lab);
  const chips = document.createElement('div'); chips.className = 'meta-chips'; wrap.appendChild(chips);
  const sel = document.createElement('select'); sel.className = 'meta-select';
  const ph = document.createElement('option'); ph.value = ''; ph.textContent = '+ add…'; sel.appendChild(ph);
  (allDocs || []).filter(d => d.id !== selfId).forEach(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = d.title + '  (' + d.id + ')'; sel.appendChild(o); });
  sel.addEventListener('change', () => { if (sel.value && !arr.includes(sel.value)) { arr.push(sel.value); redraw(); } sel.value = ''; });
  wrap.appendChild(sel);
  function redraw() {
    chips.textContent = '';
    arr.forEach((id, i) => {
      const c = document.createElement('span'); c.className = 'meta-chip';
      c.textContent = id;
      const x = document.createElement('button'); x.textContent = '✕'; x.addEventListener('click', () => { arr.splice(i, 1); redraw(); });
      c.appendChild(x); chips.appendChild(c);
    });
  }
  redraw();
  return wrap;
}

/* ===========================================================================
   New-document modal
   =========================================================================== */
// opts: { sources:[{name,component}], exists(id)->bool, onCreate(id) }
export function openNewDocModal(opts) {
  const scrim = document.createElement('div'); scrim.className = 'modal-scrim';
  const modal = document.createElement('div'); modal.className = 'modal';
  modal.innerHTML = '<h2>New document</h2>';
  const srcRow = document.createElement('div'); srcRow.className = 'modal-field';
  srcRow.appendChild(labelEl('Component / source'));
  const sel = document.createElement('select');
  opts.sources.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.name + '  (' + s.component + ')'; sel.appendChild(o); });
  srcRow.appendChild(sel); modal.appendChild(srcRow);

  const pathRow = document.createElement('div'); pathRow.className = 'modal-field';
  pathRow.appendChild(labelEl('Path (folders you choose)'));
  const path = document.createElement('input'); path.placeholder = 'guides/setup/installation'; pathRow.appendChild(path);
  modal.appendChild(pathRow);

  const preview = document.createElement('div'); preview.className = 'modal-preview'; modal.appendChild(preview);
  const err = document.createElement('div'); err.className = 'modal-err'; modal.appendChild(err);

  function id() { const p = path.value.trim().replace(/^\/+|\/+$/g, '').replace(/\.md$/i, ''); return p ? sel.value + '/' + p : ''; }
  function upd() { const i = id(); preview.textContent = i ? 'Will create:  ' + i : ''; err.textContent = ''; }
  sel.addEventListener('change', upd); path.addEventListener('input', upd); upd();

  const bar = document.createElement('div'); bar.className = 'modal-bar';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
  const create = document.createElement('button'); create.className = 'btn btn-primary'; create.textContent = 'Create';
  bar.append(cancel, create); modal.appendChild(bar);

  function close() { scrim.remove(); }
  cancel.addEventListener('click', close);
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  create.addEventListener('click', () => {
    const i = id();
    if (!i || !path.value.trim()) { err.textContent = 'Enter a path.'; return; }
    if (!/^[\w/-]+$/.test(path.value.trim().replace(/\.md$/i, ''))) { err.textContent = 'Path may contain letters, numbers, - _ / only.'; return; }
    if (opts.exists(i)) { err.textContent = 'A document with that path already exists.'; return; }
    close(); opts.onCreate(i);
  });

  scrim.appendChild(modal);
  document.body.appendChild(scrim);
  setTimeout(() => path.focus(), 30);
}

/* ---- small shared helpers ---- */
function iconBtn(label, title, fn) { const b = document.createElement('button'); b.className = 'blk-ico'; b.textContent = label; b.title = title; b.addEventListener('click', fn); return b; }
function smallBtn(label, fn) { const b = document.createElement('button'); b.className = 'blk-small'; b.textContent = label; b.addEventListener('click', fn); return b; }
function labelEl(t) { const l = document.createElement('label'); l.textContent = t; return l; }
function labeledInput(label, val, onChange) {
  const w = document.createElement('div'); w.className = 'meta-field';
  w.appendChild(labelEl(label));
  const i = document.createElement('input'); i.value = val; i.addEventListener('input', () => onChange(i.value)); w.appendChild(i);
  return w;
}
function labeledTextarea(label, val, onChange) {
  const w = document.createElement('div'); w.className = 'meta-field';
  w.appendChild(labelEl(label));
  const t = document.createElement('textarea'); t.rows = 3; t.value = val; t.addEventListener('input', () => onChange(t.value)); w.appendChild(t);
  return w;
}

let menuEl = null;
function openBlockMenu(anchor, pick) {
  if (menuEl) menuEl.remove();
  menuEl = document.createElement('div'); menuEl.className = 'blk-menu';
  BLOCK_MENU.forEach(m => { const b = document.createElement('button'); b.textContent = m.label; b.addEventListener('click', () => { pick(m.type); menuEl.remove(); menuEl = null; }); menuEl.appendChild(b); });
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.top = (window.scrollY + r.bottom + 4) + 'px';
  menuEl.style.left = (window.scrollX + r.left) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (menuEl && !menuEl.contains(e.target)) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', off); } }), 0);
}
