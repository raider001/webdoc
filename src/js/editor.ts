// editor.ts - a hand-written, zero-dependency WYSIWYG block editor (entry point).
// ---------------------------------------------------------------------------
// The author never touches Markdown. A document is edited as a list of visual
// BLOCKS (heading, paragraph, list, code, quote, rule, table, requirement);
// on save each block serialises to Markdown and the whole doc is regenerated
// (normalize-on-save). This module is the shell/orchestrator - openEditor builds
// the block canvas + metadata panel + toolbar; the pieces live in ./editor/*:
//   serialize.ts   Markdown <-> block model, parseDoc, block factory
//   richtext.ts    contenteditable fields, inline toolbar, link popover
//   widgets.ts     table / requirement / test-case / reference-picker widgets
//   panels.ts      metadata side panel, new-document modal
//   ui.ts          shared DOM primitives + the block-type menu
// ---------------------------------------------------------------------------
import { elem, append } from './dom.js';
import { serializeDoc, newBlock, toMarkdownBlocks } from './editor/serialize.js';
import { editable, listItem, attachInlineToolbar, setLinkDocs, setLinkSearch, setImageResolver, dismissInlineTools } from './editor/richtext.js';
import { tableEditor, requirementWidget, testCaseWidget, accessMarker } from './editor/widgets.js';
import { metadataPanel } from './editor/panels.js';
import { labeledInput, openBlockMenu } from './editor/ui.js';
import { openActionMenu, closeBlockMenu } from './editor/ui.js';
import { confirmDialog } from './editor/panels.js';
import { EditorHistory, splitBlock, joinBlock, moveBlock, changeType, isText, TEXT_TYPES } from './editor/model.js';
import { resolveResourceUrl } from './doclinks.js';
import { widgetEditor } from './editor/widget-editor.js';

import type { SourceConfig } from './catalog.js';
import type { DocAccess } from './auth.js';
import type { DocMeta } from './editor/serialize.js';
import type { TableBlock, ReqBlock, TestCaseBlock, ReqRef } from './editor/widgets.js';

// Public API re-exported so existing importers (main.js, runner.ts) stay unchanged.
export { parseDoc } from './editor/serialize.js';
export { richText } from './editor/richtext.js';
export { openNewDocModal, confirmDialog } from './editor/panels.js';
export { setLinkDocs, setLinkSearch };

export interface HeadingBlock {
  type: 'heading';
  level: number;
  html: string;
}
export interface ParagraphBlock {
  type: 'paragraph';
  html: string;
}
export interface QuoteBlock {
  type: 'quote';
  html: string;
}
export interface ListBlock {
  type: 'list';
  ordered: boolean;
  itemsHtml: string[];
}
export interface CodeBlock {
  type: 'code';
  lang: string;
  code: string;
}
export interface ImageBlock {
  type: 'image';
  src: string;
  alt: string;
}
export interface HrBlock {
  type: 'hr';
}
/**
 * The opening half of a restricted section. It is a marker, not a container -
 * the protected blocks are the ones between it and its AccessEndBlock.
 */
export interface AccessStartBlock {
  type: 'access-start';
  /** group names allowed to read the section */
  read: string[];
  label: string;
}
export interface AccessEndBlock {
  type: 'access-end';
}

export interface WidgetEditorBlock {
  type: 'widget';
  options: Record<string, unknown>;
  blocks: Block[];
  /** Malformed wrappers are preserved verbatim until repaired in source. */
  raw?: string;
  error?: string;
}

/**
 * A single visual block in the editor canvas. Every widget / serialize.ts /
 * blockField branch switches on `type`.
 */
export type Block =
  | HeadingBlock
  | ParagraphBlock
  | QuoteBlock
  | ListBlock
  | CodeBlock
  | TableBlock
  | ImageBlock
  | HrBlock
  | ReqBlock
  | TestCaseBlock
  | WidgetEditorBlock
  | AccessStartBlock
  | AccessEndBlock;

export interface EditorOpts {
  docId: string;
  /** document front-matter (title, assumes, next, description, ...) */
  meta: DocMeta;
  blocks: Block[];
  sources?: SourceConfig[];
  allDocs: { id: string, title: string }[];
  isNew: boolean;
  onSave: (markdown: string, meta: DocMeta, status: HTMLElement) => void | boolean | Promise<void | boolean>;
  onClose: () => void;
  /** every saved requirement, for Trace-To/Verifies autocomplete */
  requirements?: ReqRef[];
  component?: string;
  /** groups declared in config.json, offered by the access-marker pickers */
  knownGroups?: string[];
  /** this document's access state, for the metadata panel */
  docAccess?: DocAccess | null;
}

export interface EditorElement extends HTMLDivElement { isDirty: () => boolean; isSaving: () => boolean; }
export function openEditor(opts: EditorOpts): EditorElement {
  setLinkDocs(opts.allDocs || []);   // static fallback; server-backed suggestions win (setLinkSearch)
  setImageResolver(src => resolveResourceUrl(opts.docId, src));   // inserted relative images show + round-trip

  const blocks: Block[] = structuredClone(opts.blocks);
  const meta = structuredClone(opts.meta);
  const snapshot = () => ({ blocks: structuredClone(blocks), meta: structuredClone(meta) });
  let history: EditorHistory<ReturnType<typeof snapshot>> | undefined;
  let saving = false, destroyed = false;
  const list = elem('div', 'editor-blocks');
  const canvas = elem('div', 'editor-canvas', list);
  const editor = elem('div', { class: 'editor', id: 'document-editor', tabIndex: -1, 'aria-label': 'Document editor' }) as EditorElement;
  editor.isDirty = () => history?.dirty(snapshot()) ?? opts.isNew;
  editor.isSaving = () => saving;
  const rows = new Map<Block, HTMLElement>();
  const rowInfo = new WeakMap<HTMLElement, { block: Block; collection: Block[]; redraw: () => void }>();
  const cleanupFields = (root: Element) => { if (root.matches('textarea')) root.dispatchEvent(new Event('editor:destroy')); root.querySelectorAll('textarea').forEach(el => el.dispatchEvent(new Event('editor:destroy'))); };
  const widgetEditors = new Set<ReturnType<typeof widgetEditor>>();
  const teardownWidgets = (root?: Element) => {
    for (const handle of widgetEditors) if (!root || root.contains(handle.element)) { handle.destroy(); widgetEditors.delete(handle); }
  };
  let wasConnected = false;
  const observer = new MutationObserver(records => {
    if (editor.isConnected) {
      wasConnected = true;
      records.forEach(record => record.removedNodes.forEach(node => { if (node instanceof Element && !node.isConnected) cleanupFields(node); }));
      for (const handle of widgetEditors) if (!editor.contains(handle.element)) { handle.destroy(); widgetEditors.delete(handle); }
    } else if (wasConnected || records.some(record => [...record.removedNodes].some(node => node.contains(editor)))) {
      destroyed = true; cleanupFields(editor); teardownWidgets(); closeBlockMenu(); dismissInlineTools(); observer.disconnect(); statusObserver.disconnect();
      document.removeEventListener('keydown', shortcut); window.removeEventListener('beforeunload', beforeUnload);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // The trace-to picker's options, computed LIVE each time it opens: the saved
  // requirements from every other document PLUS the ones being edited right now
  // in this document (composed from the current component + group + number), so
  // intra-session traces autocomplete without needing a save first.
  const liveReqs = (): ReqRef[] => {
    const reqs = (opts.requirements || []).slice();
    const seen = new Set(reqs.map(q => q.id));
    const comp = opts.component || '';
    if (comp) blocks.forEach(b => {
      if (b.type === 'requirement' && b.group) (b.rows || []).forEach(row => {
        const no = (row.no || '').trim();
        if (!no) return;
        const id = ('R_' + comp + '_' + b.group + '_' + no).toUpperCase();   // matches the composed requirement id
        if (!seen.has(id)) { seen.add(id); reqs.push({ id, description: row.description || '', docId: opts.docId, group: b.group }); }
      });
    });
    return reqs;
  };

  // "Restricted section" is a PAIR of markers with the protected content between
  // them; every other menu entry makes exactly one block.
  function blocksFor(type: string): Block[] {
    if (type === 'access') return [newBlock('access'), newBlock('paragraph'), newBlock('access-end')];
    return [newBlock(type)];
  }

  /** Redraw the block list from scratch. */
  function repaint() {
    const active = (document.activeElement as Element | null)?.closest<HTMLElement>('.blk');
    const prior = active && rowInfo.get(active)?.block;
    const scroll = canvas.scrollTop;
    cleanupFields(list);
    teardownWidgets(list);
    rows.clear();
    list.textContent = '';
    blocks.forEach((b, i) => list.appendChild(renderBlockEditor(b, i)));
    const add = elem('button', { type: 'button', class: 'blk-add-end', onClick: () => openBlockMenu(add, t => insert(blocks, blocks.length, t, repaint)) }, '+ Add block');
    list.appendChild(add);
    resolveDisplayImages(list);   // make relative <img>s show (they'd 404 against the app route)
    canvas.scrollTop = scroll;
    if (prior && rows.has(prior)) focusBlock(prior);
  }

  function record() { history?.record(snapshot()); updateStatus(); }
  function focusBlock(block: Block, end = false) {
    const row = rows.get(block); if (!row) return;
    const field = row.querySelector<HTMLElement>('.blk-body [contenteditable="true"],.blk-body textarea,.blk-body input') || row.querySelector<HTMLElement>('.blk-handle');
    field?.focus({ preventScroll: true });
    if (field?.isContentEditable || field?.getAttribute('contenteditable') === 'true') {
      const caretRoot = block.type === 'list' ? field.querySelector(end ? 'li:last-child' : 'li') || field : field;
      const range = document.createRange(); range.selectNodeContents(caretRoot); range.collapse(!end);
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
    }
    row.scrollIntoView?.({ block: 'nearest' });
  }
  function insert(collection: Block[], at: number, type: string, redraw: () => void) {
    const added = blocksFor(type); collection.splice(at, 0, ...added); redraw(); record(); focusBlock(added[0]);
  }
  function restore(value: ReturnType<typeof snapshot> | null) {
    if (!value) return;
    const active = document.activeElement as Element | null;
    const topRows = [...list.children].filter(el => el.classList.contains('blk'));
    const index = topRows.findIndex(row => !!active && row.contains(active));
    const metadataField = active && panel.contains(active) ? [...panel.querySelectorAll('input,textarea,select')].indexOf(active) : -1;
    blocks.splice(0, blocks.length, ...value.blocks); Object.keys(meta).forEach(k => delete (meta as unknown as Record<string, unknown>)[k]); Object.assign(meta, value.meta);
    repaint(); rebuildPanel(); updateStatus();
    if (metadataField >= 0) panel.querySelectorAll<HTMLElement>('input,textarea,select')[metadataField]?.focus();
    else focusBlock(blocks[Math.max(0, Math.min(index, blocks.length - 1))]);
  }
  function undo() { restore(history?.undo(snapshot()) || null); toast.hidden = true; }
  function updateStatus() {
    if (!history) return;
    editor.dataset.dirty = String(editor.isDirty());
    if (!saving && status.dataset.state !== 'error') { status.textContent = editor.isDirty() ? 'Unsaved changes' : 'Saved'; status.dataset.state = editor.isDirty() ? 'dirty' : 'saved'; }
    const h1 = blocks.find(b => b.type === 'heading' && b.level === 1);
    const text = h1 && isText(h1) ? (() => { const el = document.createElement('div'); el.innerHTML = h1.html; return el.textContent || ''; })() : '';
    warning.hidden = !!h1 && text === meta.title; warning.textContent = text ? 'Title and H1 differ. Update either field to match before saving.' : 'This document needs an H1 matching its Title.';
  }
  function beforeUnload(event: BeforeUnloadEvent) { if (editor.isDirty() || saving) { event.preventDefault(); event.returnValue = ''; } }
  function shortcut(event: KeyboardEvent) {
    if (destroyed || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void onSave(); }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase()) && (editor.contains(event.target as Node) || (event.target as Element).closest?.('.blk-menu'))) { event.preventDefault(); if (event.shiftKey || event.key.toLowerCase() === 'y') restore(history?.redo() || null); else undo(); }
  }

  // Relative image srcs (image.png, ../x.png) don't resolve in the editor any more
  // than in the reader - resolve them to the doc's server folder for DISPLAY, but
  // stash the ORIGINAL in data-mdsrc so serialize.ts writes the relative path back
  // (never rewrites it to an absolute /docs/... path on save).
  function resolveDisplayImages(root: Element) {
    root.querySelectorAll('img').forEach(img => {
      const raw = img.getAttribute('data-mdsrc') || img.getAttribute('src');
      if (!raw) return;   // no src to resolve at all - resolveResourceUrl would have returned null anyway
      const url = resolveResourceUrl(opts.docId, raw);
      if (url) { img.setAttribute('data-mdsrc', raw); img.setAttribute('src', url); }
    });
  }

  // One block row: the reorder/insert/delete gutter plus the block's editable body.
  function renderBlockEditor(b: Block, i: number, collection = blocks, redraw = repaint): HTMLElement {
    const move = (to: number) => { if (moveBlock(collection, i, to)) { redraw(); record(); focusBlock(b); } };
    const handle = elem('button', { type: 'button', class: 'blk-handle', 'aria-label': 'Actions for ' + b.type + ' block ' + (i + 1), 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Block actions; drag to reorder' }, '⋮⋮');
    let suppressClick = false;
    handle.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      openActionMenu(handle, [
        { label: 'Move up', run: () => move(i - 1) }, { label: 'Move down', run: () => move(i + 1) },
        { label: 'Insert below', run: () => openBlockMenu(handle, type => insert(collection, i + 1, type, redraw)) },
        ...(isText(b) || b.type === 'list' || b.type === 'code' ? [{ label: 'Change block type', run: () => openActionMenu(handle, TEXT_TYPES.map(type => ({ label: type, run: () => { collection[i] = changeType(b, type); redraw(); record(); focusBlock(collection[i]); } }))) }] : []),
        { label: 'Delete block', run: () => { collection.splice(i, 1); if (!collection.length) collection.push(newBlock('paragraph')); redraw(); record(); toast.hidden = false; focusBlock(collection[Math.min(i, collection.length - 1)]); } }
      ]);
    });
    const row = elem('div', { class: 'blk blk-' + b.type, 'data-level': b.type === 'heading' ? b.level : '' }, elem('div', 'blk-gutter', handle), elem('div', 'blk-body', blockField(b)));
    rows.set(b, row); rowInfo.set(row, { block: b, collection, redraw });
    let start: { x: number; y: number; id: number } | null = null, dragging = false, target: HTMLElement | null = null, after = false;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || start) return;
      // Keep the browser's native text/image drag and focus scrolling out of
      // this pointer gesture. Click/keyboard activation still opens the menu.
      event.preventDefault(); handle.focus({ preventScroll: true });
      suppressClick = false; start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      handle.setPointerCapture(event.pointerId);
    });
    const updateDrag = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      if (!dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      dragging = true; row.classList.add('is-dragging'); target?.classList.remove('drop-before', 'drop-after');
      // Drop zones are whole rows, including their pointer-transparent gutter
      // and the gap between rows. Hit-testing a child at the pointer misses
      // those zones, especially at the bottom edge of a centred heading.
      const viewport = canvas.getBoundingClientRect();
      target = null;
      if (event.clientX >= viewport.left && event.clientX <= viewport.right && event.clientY >= viewport.top && event.clientY <= viewport.bottom) {
        for (const block of collection) {
          const candidate = rows.get(block); if (!candidate || candidate === row) continue;
          const rect = candidate.getBoundingClientRect();
          if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top - 2 && event.clientY <= rect.bottom + 2) {
            target = candidate; after = event.clientY > rect.top + rect.height / 2; break;
          }
        }
      }
      target?.classList.add(after ? 'drop-after' : 'drop-before');
    };
    handle.addEventListener('pointermove', event => {
      updateDrag(event);
      if (!start || event.pointerId !== start.id || !dragging) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect(); if (event.clientY > rect.bottom - 40) canvas.scrollTop += 18; else if (event.clientY < rect.top + 40) canvas.scrollTop -= 18;
    });
    const endDrag = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      // Recompute at release: touch moves may be coalesced, and edge scrolling
      // may have moved the rows since the last pointermove.
      if (event.type === 'pointerup') updateDrag(event);
      const pointerId = start.id;
      start = null; row.classList.remove('is-dragging'); target?.classList.remove('drop-before', 'drop-after');
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (dragging) { suppressClick = true; if (target && event.type !== 'pointercancel') { const to = collection.indexOf(rowInfo.get(target)!.block) + (after ? 1 : 0); move(to > i ? to - 1 : to); } }
      dragging = false; target = null;
    };
    handle.addEventListener('pointerup', endDrag); handle.addEventListener('pointercancel', endDrag); handle.addEventListener('lostpointercapture', endDrag);
    row.addEventListener('keydown', event => {
      if ((event.target as Element).closest('.blk') !== row || event.isComposing) return;
      const field = (event.target as Element).closest<HTMLElement>('[contenteditable="true"]');
      if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(i + (event.key === 'ArrowUp' ? -1 : 1)); return; }
      if (event.key === 'Escape') { event.preventDefault(); handle.focus(); return; }
      if (event.target === handle && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); rows.get(collection[i + (event.key === 'ArrowUp' ? -1 : 1)])?.querySelector<HTMLElement>('.blk-handle')?.focus(); return; }
      if (!field) return;
      if (b.type === 'list' && event.key === 'Enter' && !event.shiftKey) {
        const sel = window.getSelection(); if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0); const node = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
        const li = node?.closest('li'); if (!li || !field.contains(li)) return;
        event.preventDefault();
        const at = [...field.children].indexOf(li);
        if (!li.textContent && !li.querySelector('img')) {
          const paragraph: Block = { type: 'paragraph', html: '' };
          const replacement: Block[] = [];
          if (at) replacement.push({ ...b, itemsHtml: b.itemsHtml.slice(0, at) });
          replacement.push(paragraph);
          if (at < b.itemsHtml.length - 1) replacement.push({ ...b, itemsHtml: b.itemsHtml.slice(at + 1) });
          collection.splice(i, 1, ...replacement); redraw(); record(); focusBlock(paragraph);
        } else {
          const left = range.cloneRange(); left.selectNodeContents(li); left.setEnd(range.startContainer, range.startOffset);
          const right = range.cloneRange(); right.selectNodeContents(li); right.setStart(range.endContainer, range.endOffset);
          const next = document.createElement('li'); next.append(right.cloneContents()); li.replaceChildren(left.cloneContents()); li.after(next);
          if (!next.childNodes.length) next.append(document.createElement('br'));
          field.dispatchEvent(new Event('input', { bubbles: true }));
          const caret = document.createRange(); caret.selectNodeContents(next); caret.collapse(true); sel.removeAllRanges(); sel.addRange(caret);
        }
        return;
      }
      if (!isText(b)) return;
      const sel = window.getSelection(); if (!sel?.rangeCount) return;
      const range = sel.getRangeAt(0); if (!field.contains(range.commonAncestorContainer)) return;
      const left = range.cloneRange(); left.selectNodeContents(field); left.setEnd(range.startContainer, range.startOffset);
      const right = range.cloneRange(); right.selectNodeContents(field); right.setStart(range.endContainer, range.endOffset);
      const html = (r: Range) => { const div = document.createElement('div'); div.append(r.cloneContents()); return div.innerHTML; };
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); splitBlock(collection, i, html(left), html(right)); redraw(); record(); focusBlock(collection[i + 1]); }
      else if (range.collapsed && event.key === 'Backspace' && !left.toString() && !left.cloneContents().querySelector('img')) {
        const previous = collection[i - 1]; if (previous && isText(previous)) { event.preventDefault(); const offset = previous.html; joinBlock(collection, i); redraw(); record(); focusBlock(previous); const node = rows.get(previous)?.querySelector<HTMLElement>('[contenteditable]'); if (node) placeCaret(node, offset); }
      } else if (range.collapsed && event.key === 'Delete' && !right.toString() && !right.cloneContents().querySelector('img')) {
        if (collection[i + 1] && isText(collection[i + 1])) { event.preventDefault(); const offset = b.html; joinBlock(collection, i + 1); redraw(); record(); focusBlock(b); const node = rows.get(b)?.querySelector<HTMLElement>('[contenteditable]'); if (node) placeCaret(node, offset); }
      } else if (range.collapsed && ((event.key === 'ArrowUp' && !left.toString()) || (event.key === 'ArrowDown' && !right.toString()))) { const next = collection[i + (event.key === 'ArrowUp' ? -1 : 1)]; if (next) { event.preventDefault(); focusBlock(next, event.key === 'ArrowUp'); } }
    });
    return row;
  }

  function placeCaret(field: HTMLElement, html: string) {
    const prefix = document.createElement('div'); prefix.innerHTML = html; let offset = prefix.textContent?.length || 0;
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT); let node: Node | null;
    while ((node = walker.nextNode())) { if (offset <= (node.textContent?.length || 0)) { const range = document.createRange(); range.setStart(node, offset); range.collapse(true); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); return; } offset -= node.textContent?.length || 0; }
  }

  // Build the editable field(s) for a block, writing edits back into `b`.
  function blockField(b: Block): HTMLElement {
    if (b.type === 'widget') {
      const widget = b;
      if (b.error) return elem('div', 'blk-widget-error', b.error + ' — original Markdown is preserved. Repair the markers in the source file.');
      const children = elem('div', 'blk-widget-children');
      function drawChildren() {
        for (const [block, row] of rows) if (children.contains(row)) rows.delete(block);
        cleanupFields(children);
        teardownWidgets(children);
        children.replaceChildren();
        widget.blocks.forEach((child, i) => children.append(renderBlockEditor(child, i, widget.blocks, drawChildren)));
        const add = elem('button', { type: 'button', class: 'blk-add-end' }, '+ Add block inside section');
        add.addEventListener('click', () => openBlockMenu(add, type => insert(widget.blocks, widget.blocks.length, type, drawChildren)));
        children.append(add);
        resolveDisplayImages(children);
      }
      drawChildren();
      const handle = widgetEditor(widget, opts.docId, children, drawChildren);
      widgetEditors.add(handle);
      return handle.element;
    }
    if (b.type === 'heading') {
      const select = elem('select', { 'aria-label': 'Heading level', onChange: () => { b.level = +select.value; select.closest<HTMLElement>('.blk')!.dataset.level = String(b.level); } });
      for (let l = 1; l <= 6; l++) append(select, elem('option', { value: l, selected: b.level === l }, 'H' + l));
      return elem('div', 'blk-heading', select, editable(b.html || '', 'heading', h => b.html = h, 'h' + (b.level || 2)));
    }
    if (b.type === 'paragraph') return editable(b.html || '', 'para', h => b.html = h, 'Write text…');
    if (b.type === 'quote') return editable(b.html || '', 'quote', h => b.html = h, 'Quote…');
    if (b.type === 'list') {
      const ul = elem(b.ordered ? 'ol' : 'ul', { class: 'blk-list', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': b.ordered ? 'Numbered list' : 'Bulleted list' },
        (b.itemsHtml || ['']).map(html => listItem(html)));
      ul.addEventListener('input', () => { b.itemsHtml = [...ul.querySelectorAll('li')].map(li => li.innerHTML); });
      attachInlineToolbar(ul);
      b.itemsHtml = [...ul.querySelectorAll('li')].map(li => li.innerHTML);   // seed in case it never receives input
      return ul;
    }
    if (b.type === 'code') {
      const lang = elem('input', { class: 'blk-lang', 'aria-label': 'Code language', placeholder: 'language (e.g. python)', value: b.lang || '', onInput: () => b.lang = lang.value.trim() });
      const code = elem('textarea', { class: 'blk-code', 'aria-label': 'Code', value: b.code || '', rows: Math.max(3, (b.code || '').split('\n').length) });
      code.addEventListener('input', () => { b.code = code.value; code.rows = Math.max(3, code.value.split('\n').length); });
      return elem('div', 'blk-codebox', lang, code);
    }
    if (b.type === 'table') return tableEditor(b);
    if (b.type === 'image') {
      const preview = elem('img', { class: 'blk-img-preview', alt: b.alt || '', src: resolveResourceUrl(opts.docId, b.src) || b.src || '', hidden: !b.src });
      const note = elem('span', { class: 'editor-image-error', role: 'status', hidden: true }, 'Image could not be loaded. Check the URL.');
      preview.addEventListener('error', () => { note.hidden = !b.src; }); preview.addEventListener('load', () => { note.hidden = true; });
      return elem('div', 'blk-imgbox', preview, note,
        labeledInput('Image URL', b.src || '', v => { b.src = v; preview.src = resolveResourceUrl(opts.docId, v) || v; preview.hidden = !v; }),
        labeledInput('Alt text', b.alt || '', v => { b.alt = v; preview.alt = v; }));
    }
    if (b.type === 'hr') return elem('div', 'blk-hr', '— divider —');
    if (b.type === 'requirement') return requirementWidget(b, liveReqs);
    if (b.type === 'testcase') return testCaseWidget(b, liveReqs, opts.component);
    if (b.type === 'access-start' || b.type === 'access-end') return accessMarker(b, opts.knownGroups);
    return elem('div', undefined, '(unsupported block)');
  }

  repaint();

  // --- metadata panel (right) ---
  const warning = elem('p', { class: 'editor-title-warning', role: 'status', hidden: true });
  const panel = elem('details', { class: 'editor-metadata', open: false }, elem('summary', undefined, 'Document metadata'));
  const panelBody = elem('div'); panel.append(panelBody);
  function rebuildPanel() { panelBody.replaceChildren(metadataPanel(meta, opts.allDocs, opts.docId, opts.docAccess)); }
  rebuildPanel();
  const cols = elem('div', 'editor-cols', canvas, panel);
  panel.addEventListener('toggle', () => { cols.classList.toggle('metadata-open', panel.open); metadataButton.setAttribute('aria-expanded', String(panel.open)); });

  // --- toolbar ---
  const status = elem('span', { class: 'editor-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const statusObserver = new MutationObserver(() => { status.title = status.textContent || ''; });
  statusObserver.observe(status, { childList: true, subtree: true, characterData: true });
  const toast = elem('div', { class: 'editor-undo-toast', role: 'status', hidden: true }, 'Block deleted. ', elem('button', { type: 'button', class: 'blk-small', onClick: undo }, 'Undo'));
  /** Serialize every block back to Markdown and hand it to opts.onSave. */
  async function onSave() {
    if (saving) return;
    let widgetsValid = true;
    for (const handle of widgetEditors) if (editor.contains(handle.element) && !handle.validate()) widgetsValid = false;
    if (!widgetsValid) { status.textContent = 'Check the highlighted widget settings.'; status.dataset.state = 'error'; return; }
    const invalid = canvas.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:invalid, textarea:invalid, select:invalid');
    if (invalid) { invalid.reportValidity(); status.textContent = 'Check the highlighted fields.'; status.dataset.state = 'error'; return; }
    // pull inline HTML -> markdown for text blocks; other block types pass through.
    // The MdSourceBlock return annotation pins each branch's literal `type` to the
    // member it stands for; without it the object literals widen `type` to string
    // and serializeDoc can no longer tell the block kinds apart.
    const out = toMarkdownBlocks(blocks);
    meta.title = meta.title || opts.meta.title || 'Untitled';
    const submitted = snapshot();
    saving = true; saveButton.disabled = true; status.dataset.state = 'saving';
    status.textContent = 'Saving…';
    try {
      const ok = await opts.onSave(serializeDoc(meta, out), structuredClone(meta), status);
      if (ok === false) { status.dataset.state = 'error'; return; }
      history?.record(snapshot()); history?.markSaved(submitted); status.dataset.state = 'saved';
    } catch (error) { status.textContent = 'Save failed: ' + (error instanceof Error ? error.message : String(error)); status.dataset.state = 'error'; }
    finally { saving = false; saveButton.disabled = false; updateStatus(); }
  }
  const metadataButton = elem('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', onClick: () => { panel.open = !panel.open; if (panel.open) panel.querySelector<HTMLElement>('textarea')?.focus(); } }, 'Metadata');
  const saveButton = elem('button', { type: 'button', class: 'btn btn-primary', onClick: () => void onSave(), title: 'Save (Ctrl/Cmd+S)' }, 'Save');
  const bar = elem('div', 'editor-bar',
    elem('span', 'editor-bar-title', (opts.isNew ? 'New document · ' : 'Editing · ') + opts.docId),
    elem('button', { type: 'button', class: 'btn', onClick: (e: Event) => openBlockMenu(e.currentTarget as Element, t => insert(blocks, blocks.length, t, repaint)) }, '+ Add block'),
    metadataButton,
    elem('button', { type: 'button', class: 'btn', onClick: undo, title: 'Undo (Ctrl/Cmd+Z)' }, 'Undo'),
    status,
    elem('button', { type: 'button', class: 'btn', onClick: async () => {
      if (saving) return;
      if (editor.isDirty() && !await confirmDialog({ title: 'Discard unsaved changes?', message: 'Your edits have not been saved.', confirmLabel: 'Discard', danger: true })) return;
      opts.onClose();
    } }, 'Cancel'), saveButton);
  editor.append(bar, warning, cols, toast);
  history = new EditorHistory(snapshot(), opts.isNew); updateStatus();
  editor.addEventListener('input', () => { if (status.dataset.state === 'error') status.dataset.state = ''; record(); });
  editor.addEventListener('change', record);
  editor.addEventListener('beforeinput', event => {
    if (event.isComposing || !['insertParagraph', 'insertLineBreak'].includes(event.inputType)) return;
    const field = (event.target as Element).closest<HTMLElement>('[contenteditable="true"]'); if (!field) return;
    const key = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: event.inputType === 'insertLineBreak', bubbles: true, cancelable: true });
    field.dispatchEvent(key); if (key.defaultPrevented) event.preventDefault();
  });
  document.addEventListener('keydown', shortcut); window.addEventListener('beforeunload', beforeUnload);
  return editor;
}
