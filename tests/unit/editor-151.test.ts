import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeType, EditorHistory, joinBlock, moveBlock, splitBlock, tableColumn, tableRow } from '/js/editor/model.js';
import { htmlToMd, parseDoc, serializeDoc, toMarkdownBlocks } from '/js/editor/serialize.js';
import { openEditor, confirmDialog, openNewDocModal } from '/js/editor.js';
import { openActionMenu } from '/js/editor/ui.js';
import type { Block } from '/js/editor.js';
import type { TableBlock } from '/js/editor/widgets.js';

const meta = { title: 'Example', description: '', assumes: [], next: [] };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => { document.body.replaceChildren(); await Promise.resolve(); vi.restoreAllMocks(); });
function caret(field: HTMLElement, offset: number) {
  field.focus(); const r = document.createRange(); r.setStart(field.firstChild || field, offset); r.collapse(true); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(r);
}
function key(field: HTMLElement, key: string, extra = {}) { const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }); field.dispatchEvent(event); return event; }
function make(blocks: Block[], save = vi.fn(), isNew = false) {
  const editor = openEditor({ docId: 'Docs/example', meta, blocks, allDocs: [{ id: 'Docs/other', title: 'Other' }], isNew, onSave: save, onClose: vi.fn() }); document.body.append(editor); return editor;
}
function click(root: ParentNode, text: string) { [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!.click(); }

describe('editor block model', () => {
  it('splits formatted text, creates a paragraph, joins and preserves the original heading', () => {
    const blocks: Block[] = [{ type: 'heading', level: 2, html: '<b>AlphaBeta</b>' }];
    expect(splitBlock(blocks, 0, '<b>Alpha</b>', '<b>Beta</b>')).toBe(true);
    expect(blocks[1]).toEqual({ type: 'paragraph', html: '<b>Beta</b>' });
    expect(joinBlock(blocks, 1)).toBe(true);
    expect(blocks).toEqual([{ type: 'heading', level: 2, html: '<b>Alpha</b><b>Beta</b>' }]);
    expect(splitBlock([{ type: 'hr' }], 0, '', '')).toBe(false);
    expect(joinBlock([{ type: 'hr' }, { type: 'paragraph', html: '' }], 1)).toBe(false);
  });
  it('reorders by identity, guards bounds and keeps all content', () => {
    const blocks: Block[] = [{ type: 'paragraph', html: 'A' }, { type: 'paragraph', html: 'B' }]; const first = blocks[0];
    expect(moveBlock(blocks, 0, 1)).toBe(true); expect(blocks[1]).toBe(first); expect(moveBlock(blocks, 0, -1)).toBe(false);
  });
  it.each(['paragraph', 'heading', 'quote', 'list', 'list-ordered', 'code'])('changes text to %s without losing its words', type => {
    const changed = changeType({ type: 'paragraph', html: '<strong>Alpha</strong><br>Beta' }, type);
    expect(serializeDoc(meta, toMarkdownBlocks([changed]))).toMatch(/Alpha/); expect(serializeDoc(meta, toMarkdownBlocks([changed]))).toMatch(/Beta/);
  });
  it('does not convert widgets or permission boundaries into text', () => {
    const boundary: Block = { type: 'access-end' }; expect(changeType(boundary, 'paragraph')).toBe(boundary);
  });
  it('inserts/deletes arbitrary rows and columns while preserving alignment and the last column', () => {
    const table: TableBlock = { type: 'table', headers: ['A', 'B'], aligns: ['left', 'right'], rows: [['a', 'b'], ['c', 'd']] };
    tableRow(table, 1); expect(table.rows).toEqual([['a', 'b'], ['', ''], ['c', 'd']]); tableRow(table, 0, true);
    tableColumn(table, 1); expect(table.rows[1]).toEqual(['c', '', 'd']); expect(table.aligns).toEqual(['left', '', 'right']);
    tableColumn(table, 0, true); expect(table.headers).toEqual(['Column', 'B']); expect(table.rows[1]).toEqual(['', 'd']);
    tableColumn(table, 0, true); tableColumn(table, 0, true); expect(table.headers).toEqual(['B']); expect(table.aligns).toEqual(['right']);
  });
});

describe('serializer and history', () => {
  it('reopens standalone images with image controls while preserving mixed and linked inline images', () => {
    const source = '![Preview](/assets/example.png)\n\nBefore ![Inline](relative.png) after\n\n[![Linked](link.png)](Docs/other)';
    const parsed = parseDoc(source);
    expect(parsed.blocks[0]).toEqual({ type: 'image', src: '/assets/example.png', alt: 'Preview' });
    expect(parsed.blocks.slice(1).map(b => b.type)).toEqual(['paragraph', 'paragraph']);
    const reopened = parseDoc(serializeDoc(meta, toMarkdownBlocks(parsed.blocks)));
    expect(reopened.blocks).toEqual(parsed.blocks);
    const editor = make(reopened.blocks);
    expect(editor.querySelector<HTMLImageElement>('.blk-img-preview')?.getAttribute('src')).toBe('/assets/example.png');
    expect(editor.querySelector('.blk-img-preview')?.getAttribute('alt')).toBe('Preview');
    const url = [...editor.querySelectorAll('label')].find(l => l.textContent === 'Image URL')!.querySelector('input')!;
    url.value = '/assets/changed.png'; url.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.querySelector('.blk-img-preview')?.getAttribute('src')).toBe('/assets/changed.png');
    const save = serializeDoc(meta, toMarkdownBlocks(parseDoc('![New](new.png)').blocks));
    expect(parseDoc(save).blocks[0]).toEqual({ type: 'image', src: 'new.png', alt: 'New' });
    const spaced = parseDoc('![Spaced](<images/one (1).png>)');
    expect(parseDoc(serializeDoc(meta, toMarkdownBlocks(spaced.blocks))).blocks).toEqual(spaced.blocks);
  });
  it('never glues pasted div/p boundaries or hard line breaks', () => {
    expect(htmlToMd('First<div>Second</div><p>Third</p>Last')).toBe('First  \nSecond  \nThird  \nLast');
    const source = '## Heading\n\nFirst  \nSecond\n\n> Quote\n\n- Item  \n  continuation\n\n| A | B |\n|---|---|\n| x<br>y | **z** |\n\n```ts\nconst x = 1;\n```';
    const first = parseDoc(source); const saved = serializeDoc(meta, toMarkdownBlocks(first.blocks)); const second = parseDoc(saved);
    expect(second.blocks).toEqual(first.blocks); expect(saved).toContain('x<br>y');
  });
  it('tracks new documents, reverting edits, undo/redo, branch changes and saved snapshots', () => {
    const history = new EditorHistory({ text: 'A' }); expect(history.dirty({ text: 'A' })).toBe(false);
    history.record({ text: 'B' }); expect(history.dirty({ text: 'B' })).toBe(true);
    expect(history.undo({ text: 'B' })).toEqual({ text: 'A' }); expect(history.dirty({ text: 'A' })).toBe(false);
    expect(history.redo()).toEqual({ text: 'B' }); history.markSaved({ text: 'B' }); expect(history.dirty({ text: 'B' })).toBe(false);
    history.record({ text: 'C' }); history.undo({ text: 'C' }); history.record({ text: 'D' }); expect(history.redo()).toBeNull();
    expect(new EditorHistory({ text: '' }, true).dirty({ text: '' })).toBe(true);
  });
});

describe('mounted editor', () => {
  it.each(['mouse', 'touch'])('drops on the full row gutter with %s and cancels without reordering', pointerType => {
    const save = vi.fn(); const editor = make([
      { type: 'heading', level: 1, html: 'Example' }, { type: 'paragraph', html: 'AlphaBeta' },
      { type: 'heading', level: 2, html: 'Short heading' }, { type: 'paragraph', html: 'Second paragraph' }
    ], save);
    const rect = (top: number, height: number) => ({ left: 0, right: 300, top, bottom: top + height, width: 300, height, x: 0, y: top, toJSON() {} });
    vi.spyOn(editor.querySelector('.editor-canvas')!, 'getBoundingClientRect').mockReturnValue(rect(0, 600));
    [...editor.querySelectorAll<HTMLElement>('.editor-blocks > .blk')].forEach((row, i) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(50 + i * 50, 47));
    });
    // Transparent gutter/background: no child is hit, but its row is a drop zone.
    const handle = editor.querySelector<HTMLElement>('.blk-paragraph .blk-handle')!;
    handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => true; handle.releasePointerCapture = vi.fn();
    const pointer = (type: string, y: number, id = 1) => {
      const event = new MouseEvent(type, { clientX: 20, clientY: y, button: 0, bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } });
      handle.dispatchEvent(event);
    };
    pointer('pointerdown', 112); pointer('pointermove', 196, 2);
    expect(editor.querySelector('.drop-after')).toBeNull();
    pointer('pointermove', 196); expect(editor.querySelector('.drop-after')?.textContent).toContain('Short heading');
    pointer('pointercancel', 196);
    expect([...editor.querySelectorAll('.editor-blocks > .blk')][1].textContent).toContain('AlphaBeta');
    expect(editor.querySelector('.is-dragging,.drop-after')).toBeNull();
    pointer('pointerdown', 112); pointer('pointermove', 196); pointer('pointerup', 196);
    const ordered = [...editor.querySelectorAll('.editor-blocks > .blk')];
    expect(ordered[1].textContent).toContain('Short heading'); expect(ordered[2].textContent).toContain('AlphaBeta');
    expect(editor.isDirty()).toBe(true); click(editor, 'Save');
    expect(save.mock.calls[0][0].indexOf('Short heading')).toBeLessThan(save.mock.calls[0][0].indexOf('AlphaBeta'));
  });
  it('splits at the caret, focuses the new block and joins at its start', () => {
    const save = vi.fn(); const editor = make([{ type: 'paragraph', html: 'AlphaBeta' }], save);
    const field = editor.querySelector<HTMLElement>('[contenteditable]')!; caret(field, 5); key(field, 'Enter');
    expect(editor.querySelectorAll('.blk-paragraph')).toHaveLength(2); expect(document.activeElement?.textContent).toBe('Beta');
    key(document.activeElement as HTMLElement, 'Backspace'); expect(editor.querySelectorAll('.blk-paragraph')).toHaveLength(1);
    click(editor, 'Save'); expect(save.mock.calls[0][0]).toContain('AlphaBeta');
  });
  it('Shift+Enter inserts one break and plain Enter never splits table cells', () => {
    const editor = make([{ type: 'paragraph', html: 'AB' }, { type: 'table', headers: ['A'], aligns: [''], rows: [['x']] }]);
    const field = editor.querySelector<HTMLElement>('.blk-paragraph [contenteditable]')!; caret(field, 1); key(field, 'Enter', { shiftKey: true });
    expect(field.innerHTML).toBe('A<br>B');
    const cell = editor.querySelector<HTMLElement>('.blk-edit-tablecell')!; caret(cell, 1); expect(key(cell, 'Enter').defaultPrevented).toBe(true); expect(editor.querySelectorAll('.blk')).toHaveLength(2);
  });
  it.each(['Beta', '<strong>Beta</strong>'])('keeps an end-of-text Shift+Enter caret and hard break when typing after %s', html => {
    const save = vi.fn(); const editor = make([{ type: 'paragraph', html }], save);
    const field = editor.querySelector<HTMLElement>('[contenteditable]')!;
    const text = field.querySelector('strong') || field;
    caret(text as HTMLElement, 4); key(field, 'Enter', { shiftKey: true });
    // A split empty text node is not a caret sentinel. Require the extra br
    // before simulating insertion: jsdom does not implement native typing.
    expect(field.querySelectorAll('br')).toHaveLength(2);
    const range = window.getSelection()!.getRangeAt(0);
    const tail = range.cloneRange(); tail.selectNodeContents(field); tail.setStart(range.startContainer, range.startOffset);
    expect(tail.cloneContents().querySelectorAll('br')).toHaveLength(1);
    range.insertNode(document.createTextNode('Line'));
    field.dispatchEvent(new Event('input', { bubbles: true })); click(editor, 'Save');
    const stored = save.mock.calls[0][0];
    expect(stored).toContain(html === 'Beta' ? 'Beta  \nLine' : '**Beta  \nLine**');
    const reopened = parseDoc(stored).blocks[0];
    expect(reopened.type).toBe('paragraph');
    const rendered = document.createElement('div'); rendered.innerHTML = (reopened as { html: string }).html;
    expect(rendered.textContent?.replace(/\n/g, '')).toBe('BetaLine');
    expect(rendered.querySelectorAll('br')).toHaveLength(1);
    expect(htmlToMd(rendered.innerHTML)).toContain('  \n');
  });
  it('keeps an end-of-text Shift+Enter inside its list item even before another item', () => {
    const save = vi.fn(); const editor = make([{ type: 'list', ordered: false, itemsHtml: ['Beta', 'Next'] }], save);
    const list = editor.querySelector<HTMLElement>('[contenteditable].blk-list')!;
    const item = list.querySelector<HTMLElement>('li')!; caret(item, 4); key(list, 'Enter', { shiftKey: true });
    expect(item.querySelectorAll('br')).toHaveLength(2);
    expect([...list.children].map(el => el.tagName)).toEqual(['LI', 'LI']);
    window.getSelection()!.getRangeAt(0).insertNode(document.createTextNode('Line'));
    list.dispatchEvent(new Event('input', { bubbles: true })); click(editor, 'Save');
    const stored = save.mock.calls[0][0]; expect(stored).toContain('- Beta  \n  Line\n- Next');
    const reopened = parseDoc(stored).blocks[0]; expect(reopened.type).toBe('list');
    const rendered = document.createElement('div'); rendered.innerHTML = (reopened as { itemsHtml: string[] }).itemsHtml[0];
    expect(rendered.querySelectorAll('br')).toHaveLength(1);
    expect(rendered.textContent?.replace(/\n/g, '')).toBe('BetaLine');
  });
  it('deletes only its own block and restores it with Undo', () => {
    const editor = make([{ type: 'heading', level: 2, html: 'First' }, { type: 'paragraph', html: 'Second' }]);
    editor.querySelector<HTMLButtonElement>('.blk-handle')!.click(); click(document.querySelector('.blk-menu')!, 'Delete block');
    expect(editor.querySelector('.blk-heading')).toBeNull(); expect(editor.textContent).toContain('Second');
    click(editor.querySelector('.editor-undo-toast')!, 'Undo'); expect(editor.querySelector('.blk-heading')?.textContent).toContain('First');
  });
  it('guards unload, supports Ctrl+S and leaves Saved visible after success', async () => {
    const save = vi.fn().mockResolvedValue(true); const editor = make([{ type: 'paragraph', html: 'A' }], save);
    const field = editor.querySelector<HTMLElement>('[contenteditable]')!; field.innerHTML = 'B'; field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.isDirty()).toBe(true); const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    key(field, 's', { ctrlKey: true }); await Promise.resolve(); await Promise.resolve();
    expect(save).toHaveBeenCalledOnce(); expect(editor.isDirty()).toBe(false); expect(editor.querySelector('.editor-status')?.textContent).toBe('Saved'); expect(editor.isConnected).toBe(true);
  });
  it('keeps edits made during a save dirty, and failed saves retain the buffer', async () => {
    let done!: (ok: boolean) => void; const save = vi.fn(() => new Promise<boolean>(resolve => { done = resolve; })); const editor = make([{ type: 'paragraph', html: 'A' }], save);
    const field = editor.querySelector<HTMLElement>('[contenteditable]')!; field.innerHTML = 'B'; field.dispatchEvent(new Event('input', { bubbles: true })); click(editor, 'Save');
    field.innerHTML = 'C'; field.dispatchEvent(new Event('input', { bubbles: true })); done(true); await Promise.resolve(); await Promise.resolve(); expect(editor.isDirty()).toBe(true);
    click(editor, 'Save'); done(false); await Promise.resolve(); await Promise.resolve(); expect(editor.isDirty()).toBe(true); expect(editor.querySelector('.editor-status')?.getAttribute('data-state')).toBe('error');
  });
  it('splits a list item, exits an empty item and accepts mobile beforeinput', () => {
    const editor = make([{ type: 'list', ordered: false, itemsHtml: ['AlphaBeta'] }]);
    const list = editor.querySelector<HTMLElement>('[contenteditable].blk-list')!; const li = list.querySelector('li')!;
    const range = document.createRange(); range.setStart(li.firstChild!, 5); range.collapse(true); list.focus(); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    key(list, 'Enter'); expect([...list.querySelectorAll('li')].map(el => el.textContent)).toEqual(['Alpha', 'Beta']);
    const second = list.querySelectorAll('li')[1]; second.replaceChildren(); list.dispatchEvent(new Event('input', { bubbles: true }));
    range.selectNodeContents(second); range.collapse(true); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); key(list, 'Enter');
    const paragraph = editor.querySelector<HTMLElement>('.blk-paragraph [contenteditable]')!; expect(document.activeElement).toBe(paragraph);
    paragraph.textContent = 'AB'; caret(paragraph, 1);
    paragraph.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true }));
    expect([...editor.querySelectorAll('.blk-paragraph [contenteditable]')].map(el => el.textContent)).toEqual(['A', 'B']);
  });
  it('offers searchable metadata instead of a full-document select and warns about title/H1 drift', () => {
    const editor = make([{ type: 'heading', level: 1, html: 'Example' }]); const title = editor.querySelector<HTMLTextAreaElement>('.editor-meta textarea')!;
    title.value = 'Different'; title.dispatchEvent(new Event('input', { bubbles: true })); expect(editor.querySelector<HTMLElement>('.editor-title-warning')!.hidden).toBe(false);
    const search = editor.querySelector<HTMLInputElement>('[aria-label="Search Assumed knowledge"]')!; search.value = 'Other'; search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.querySelectorAll('.meta-results button')).toHaveLength(1); editor.querySelector<HTMLButtonElement>('.meta-results button')!.click(); expect(editor.querySelector('.meta-chip')?.textContent).toContain('Docs/other');
  });
});

describe('dialog and menu contracts', () => {
  it('focuses Cancel in a danger dialog and Cancel resolves false, restoring focus', async () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const result = confirmDialog({ danger: true, confirmLabel: 'Delete' }); expect(document.activeElement?.textContent).toBe('Cancel');
    // Native Enter activates this button; there is no document Enter-to-confirm handler.
    expect(key(document.activeElement as HTMLElement, 'Enter').defaultPrevented).toBe(false); (document.activeElement as HTMLElement).click();
    expect(await result).toBe(false); expect(document.activeElement).toBe(opener);
  });
  it('submits New document through its form with immediate focus, and Escape cleans up', () => {
    const create = vi.fn(); openNewDocModal({ sources: [{ name: 'Docs', component: 'Docs', path: 'docs' }], exists: () => false, onCreate: create });
    const input = document.activeElement as HTMLInputElement; expect(input.placeholder).toBe('guides/setup/installation'); input.value = 'new';
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); expect(create).toHaveBeenCalledWith('Docs/new'); expect(document.querySelector('dialog')).toBeNull();
  });
  it('uses arrow keys and Escape to operate a block menu and restore its handle', () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    openActionMenu(opener, [{ label: 'First', run: vi.fn() }, { label: 'Second', run: vi.fn() }]); expect(document.activeElement?.textContent).toBe('First'); key(document.activeElement as HTMLElement, 'ArrowDown'); expect(document.activeElement?.textContent).toBe('Second');
    document.querySelector('.blk-menu')!.dispatchEvent(new Event('scroll')); expect(document.querySelector('.blk-menu')).toBeTruthy();
    // A queued opener/canvas scroll must not dismiss a just-opened menu.
    opener.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('.blk-menu')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Second');
    key(document.activeElement as HTMLElement, 'Escape'); expect(document.querySelector('.blk-menu')).toBeNull(); expect(document.activeElement).toBe(opener);
  });
});
