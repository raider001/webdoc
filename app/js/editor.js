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
import { arrowUpIcon, arrowDownIcon, plusIcon, closeIcon } from './icons.js';
import { serializeDoc, htmlToMd, newBlock } from './editor/serialize.js';
import { editable, listItem, attachInlineToolbar, setLinkDocs, setLinkSearch, setImageResolver } from './editor/richtext.js';
import { tableEditor, requirementWidget, testCaseWidget, accessMarker } from './editor/widgets.js';
import { metadataPanel } from './editor/panels.js';
import { iconBtn, labeledInput, openBlockMenu } from './editor/ui.js';
import { resolveResourceUrl } from './doclinks.js';
// Public API re-exported so existing importers (main.js, runner.ts) stay unchanged.
export { parseDoc } from './editor/serialize.js';
export { richText } from './editor/richtext.js';
export { openNewDocModal, confirmDialog } from './editor/panels.js';
export { setLinkDocs, setLinkSearch };
export function openEditor(opts) {
    setLinkDocs(opts.allDocs || []); // static fallback; server-backed suggestions win (setLinkSearch)
    setImageResolver(src => resolveResourceUrl(opts.docId, src)); // inserted relative images show + round-trip
    const blocks = opts.blocks.map(b => ({ ...b }));
    const list = elem('div', 'editor-blocks');
    const canvas = elem('div', 'editor-canvas', list);
    // The trace-to picker's options, computed LIVE each time it opens: the saved
    // requirements from every other document PLUS the ones being edited right now
    // in this document (composed from the current component + group + number), so
    // intra-session traces autocomplete without needing a save first.
    const liveReqs = () => {
        const reqs = (opts.requirements || []).slice();
        const seen = new Set(reqs.map(q => q.id));
        const comp = opts.component || '';
        if (comp)
            blocks.forEach(b => {
                if (b.type === 'requirement' && b.group)
                    (b.rows || []).forEach(row => {
                        const no = (row.no || '').trim();
                        if (!no)
                            return;
                        const id = ('R_' + comp + '_' + b.group + '_' + no).toUpperCase(); // matches the composed requirement id
                        if (!seen.has(id)) {
                            seen.add(id);
                            reqs.push({ id, description: row.description || '', docId: opts.docId, group: b.group });
                        }
                    });
            });
        return reqs;
    };
    // "Restricted section" is a PAIR of markers with the protected content between
    // them; every other menu entry makes exactly one block.
    function blocksFor(type) {
        if (type === 'access')
            return [newBlock('access'), newBlock('paragraph'), newBlock('access-end')];
        return [newBlock(type)];
    }
    /** Redraw the block list from scratch. */
    function repaint() {
        list.textContent = '';
        blocks.forEach((b, i) => list.appendChild(renderBlockEditor(b, i)));
        const add = elem('button', { class: 'blk-add-end', onClick: () => openBlockMenu(add, t => { blocks.push(...blocksFor(t)); repaint(); }) }, '+ Add block');
        list.appendChild(add);
        resolveDisplayImages(list); // make relative <img>s show (they'd 404 against the app route)
    }
    // Relative image srcs (image.png, ../x.png) don't resolve in the editor any more
    // than in the reader - resolve them to the doc's server folder for DISPLAY, but
    // stash the ORIGINAL in data-mdsrc so serialize.ts writes the relative path back
    // (never rewrites it to an absolute /docs/... path on save).
    function resolveDisplayImages(root) {
        root.querySelectorAll('img').forEach(img => {
            const raw = img.getAttribute('data-mdsrc') || img.getAttribute('src');
            const url = resolveResourceUrl(opts.docId, raw);
            if (url) {
                img.setAttribute('data-mdsrc', raw);
                img.setAttribute('src', url);
            }
        });
    }
    // One block row: the reorder/insert/delete gutter plus the block's editable body.
    function renderBlockEditor(b, i) {
        const gutter = elem('div', 'blk-gutter', iconBtn(arrowUpIcon(), 'Move up', () => { if (i > 0) {
            [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]];
            repaint();
        } }), iconBtn(arrowDownIcon(), 'Move down', () => { if (i < blocks.length - 1) {
            [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]];
            repaint();
        } }), iconBtn(plusIcon(), 'Insert below', e => openBlockMenu(e.target, t => { blocks.splice(i + 1, 0, ...blocksFor(t)); repaint(); })), iconBtn(closeIcon(), 'Delete', () => { blocks.splice(i, 1); if (!blocks.length)
            blocks.push(newBlock('paragraph')); repaint(); }));
        return elem('div', 'blk blk-' + b.type, gutter, elem('div', 'blk-body', blockField(b)));
    }
    // Build the editable field(s) for a block, writing edits back into `b`.
    function blockField(b) {
        if (b.type === 'heading') {
            const select = elem('select', { onChange: () => { b.level = +select.value; } });
            for (let l = 1; l <= 6; l++)
                append(select, elem('option', { value: l, selected: b.level === l }, 'H' + l));
            return elem('div', 'blk-heading', select, editable(b.html || '', 'heading', h => b.html = h, 'h' + (b.level || 2)));
        }
        if (b.type === 'paragraph')
            return editable(b.html || '', 'para', h => b.html = h, 'Write text…');
        if (b.type === 'quote')
            return editable(b.html || '', 'quote', h => b.html = h, 'Quote…');
        if (b.type === 'list') {
            const ul = elem(b.ordered ? 'ol' : 'ul', { class: 'blk-list', contenteditable: 'true' }, (b.itemsHtml || ['']).map(html => listItem(html)));
            ul.addEventListener('input', () => { b.itemsHtml = [...ul.querySelectorAll('li')].map(li => li.innerHTML); });
            attachInlineToolbar(ul);
            b.itemsHtml = [...ul.querySelectorAll('li')].map(li => li.innerHTML); // seed in case it never receives input
            return ul;
        }
        if (b.type === 'code') {
            const lang = elem('input', { class: 'blk-lang', placeholder: 'language (e.g. python)', value: b.lang || '', onInput: () => b.lang = lang.value.trim() });
            const code = elem('textarea', { class: 'blk-code', value: b.code || '', rows: Math.max(3, (b.code || '').split('\n').length) });
            code.addEventListener('input', () => { b.code = code.value; code.rows = Math.max(3, code.value.split('\n').length); });
            return elem('div', 'blk-codebox', lang, code);
        }
        if (b.type === 'table')
            return tableEditor(b);
        if (b.type === 'image') {
            return elem('div', 'blk-imgbox', labeledInput('Image URL', b.src || '', v => b.src = v), labeledInput('Alt text', b.alt || '', v => b.alt = v));
        }
        if (b.type === 'hr')
            return elem('div', 'blk-hr', '— divider —');
        if (b.type === 'requirement')
            return requirementWidget(b, liveReqs);
        if (b.type === 'testcase')
            return testCaseWidget(b, liveReqs, opts.component);
        if (b.type === 'access-start' || b.type === 'access-end')
            return accessMarker(b, opts.knownGroups);
        return elem('div', null, '(unsupported block)');
    }
    repaint();
    // --- metadata panel (right) ---
    const meta = { ...opts.meta, assumes: (opts.meta.assumes || []).slice(), next: (opts.meta.next || []).slice() };
    const panel = metadataPanel(meta, opts.allDocs, opts.docId, opts.docAccess);
    // --- toolbar ---
    const status = elem('span', 'editor-status');
    /** Serialize every block back to Markdown and hand it to opts.onSave. */
    function onSave() {
        // pull inline HTML -> markdown for text blocks; other block types pass through.
        // The MdSourceBlock return annotation pins each branch's literal `type` to the
        // member it stands for; without it the object literals widen `type` to string
        // and serializeDoc can no longer tell the block kinds apart.
        const out = blocks.map((b) => {
            if (b.type === 'heading')
                return { type: 'heading', level: b.level || 2, text: htmlToMd(b.html) };
            if (b.type === 'paragraph')
                return { type: 'paragraph', text: htmlToMd(b.html) };
            if (b.type === 'quote')
                return { type: 'quote', text: htmlToMd(b.html) };
            if (b.type === 'list')
                return { type: 'list', ordered: b.ordered, items: (b.itemsHtml || []).map(htmlToMd).filter(x => x !== '') };
            return b;
        });
        meta.title = meta.title || opts.meta.title || 'Untitled';
        status.textContent = 'Saving…';
        opts.onSave(serializeDoc(meta, out), meta, status);
    }
    const bar = elem('div', 'editor-bar', elem('span', 'editor-bar-title', (opts.isNew ? 'New document · ' : 'Editing · ') + opts.docId), elem('span', { style: 'flex:1' }), status, elem('button', { class: 'btn', onClick: () => opts.onClose() }, 'Cancel'), elem('button', { class: 'btn btn-primary', onClick: onSave }, 'Save'));
    return elem('div', 'editor', bar, elem('div', 'editor-cols', canvas, panel));
}
