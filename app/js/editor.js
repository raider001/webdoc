// editor.js - a hand-written, zero-dependency WYSIWYG block editor (entry point).
// ---------------------------------------------------------------------------
// The author never touches Markdown. A document is edited as a list of visual
// BLOCKS (heading, paragraph, list, code, quote, rule, table, requirement);
// on save each block serialises to Markdown and the whole doc is regenerated
// (normalize-on-save). This module is the shell/orchestrator - openEditor builds
// the block canvas + metadata panel + toolbar; the pieces live in ./editor/*:
//   serialize.js   Markdown <-> block model, parseDoc, block factory
//   richtext.js    contenteditable fields, inline toolbar, link popover
//   widgets.js     table / requirement / test-case / reference-picker widgets
//   panels.js      metadata side panel, new-document modal
//   ui.js          shared DOM primitives + the block-type menu
// ---------------------------------------------------------------------------
import { serializeDoc, htmlToMd, newBlock } from './editor/serialize.js';
import { editable, listItem, attachInlineToolbar, setLinkDocs, setLinkSearch, setImageResolver } from './editor/richtext.js';
import { tableEditor, requirementWidget, testCaseWidget } from './editor/widgets.js';
import { metadataPanel } from './editor/panels.js';
import { iconBtn, labeledInput, openBlockMenu } from './editor/ui.js';
import { resolveResourceUrl } from './doclinks.js';

// Public API re-exported so existing importers (main.js, runner.js) stay unchanged.
export { parseDoc } from './editor/serialize.js';
export { richText } from './editor/richtext.js';
export { openNewDocModal, confirmDialog } from './editor/panels.js';
export { setLinkDocs, setLinkSearch };

// opts: { docId, meta, blocks, sources, allDocs, isNew, onSave(md, meta), onClose() }
export function openEditor(opts) {
  setLinkDocs(opts.allDocs || []);   // static fallback; server-backed suggestions win (setLinkSearch)
  setImageResolver(src => resolveResourceUrl(opts.docId, src));   // inserted relative images show + round-trip
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
    resolveDisplayImages(list);   // make relative <img>s show (they'd 404 against the app route)
  }

  // Relative image srcs (image.png, ../x.png) don't resolve in the editor any more
  // than in the reader - resolve them to the doc's server folder for DISPLAY, but
  // stash the ORIGINAL in data-mdsrc so serialize.js writes the relative path back
  // (never rewrites it to an absolute /docs/... path on save).
  function resolveDisplayImages(root) {
    root.querySelectorAll('img').forEach(img => {
      const raw = img.getAttribute('data-mdsrc') || img.getAttribute('src');
      const url = resolveResourceUrl(opts.docId, raw);
      if (url) { img.setAttribute('data-mdsrc', raw); img.setAttribute('src', url); }
    });
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
