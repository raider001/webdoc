import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWidgetFields, validateWidgetField } from '/js/editor/widget-fields.js';
import { registerWidget, widgetDefinition } from '/js/widgets.js';
import type { WidgetDefinition, WidgetField } from '/js/widgets.js';
import { openEditor } from '/js/editor.js';
import { parseDoc, serializeDoc, toMarkdownBlocks } from '/js/editor/serialize.js';

const csv = 'job,progress,status\na,0.5,running\nb,1,done';
const headingSource = '# Queue\n## Running\n| job | progress | status |\n|---|---|---|\n| a | 0.5 | running |\n## Done\nFinished';
const cleanups: (() => void)[] = [];
const meta = { title: 'Demo', assumes: [], next: [], description: '' };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/docs/')) return new Response(headingSource);
    if (url.startsWith('/api/data/file')) return new Response(csv);
    const path = new URL(url, 'http://localhost').searchParams.get('path');
    if (url.startsWith('/api/data/tree')) return Response.json(path ? { folders: [], files: [{ id: 'Docs/jobs.csv', title: 'jobs.csv' }] } : { folders: ['Docs'], files: [] });
    return Response.json(path ? { folders: [], docs: [{ id: 'Docs/queue', title: 'Queue' }, { id: 'Docs/locked', title: 'Locked', locked: true }] } : { folders: ['Docs'], docs: [] });
  }));
});
afterEach(async () => { cleanups.splice(0).forEach(fn => fn()); document.body.replaceChildren(); await Promise.resolve(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fields(schema: WidgetField[], options: Record<string, unknown> = {}) {
  const definition: WidgetDefinition = { name: 'test-fields', render: ctx => ctx.content, editor: { fields: schema } };
  const form = createWidgetFields(definition, options, 'Docs/demo', vi.fn()); document.body.append(form.element); cleanups.push(form.destroy); return form;
}
function set(input: HTMLInputElement | HTMLSelectElement, value: string) { input.value = value; input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }

describe('typed widget fields', () => {
  it('edits text, numbers, booleans, selects and interval with adjacent validation', () => {
    const options = { text: 'Original', count: 2, enabled: false, choice: 'a', interval: 60 };
    const form = fields([
      { name: 'text', label: 'Title', type: 'text', required: true },
      { name: 'count', label: 'Count', type: 'number', min: 1, max: 10 },
      { name: 'enabled', label: 'Enabled', type: 'boolean' },
      { name: 'choice', label: 'Choice', type: 'select', choices: ['a', 'b'] },
      { name: 'interval', label: 'Refresh', type: 'interval' },
    ], options);
    set(form.element.querySelector<HTMLInputElement>('[aria-label="Title"]')!, 'Updated');
    set(form.element.querySelector<HTMLInputElement>('[aria-label="Count"]')!, '5');
    const checkbox = form.element.querySelector<HTMLInputElement>('[aria-label="Enabled"]')!; checkbox.checked = true; checkbox.dispatchEvent(new Event('input'));
    set(form.element.querySelector<HTMLSelectElement>('[aria-label="Choice"]')!, 'b');
    set(form.element.querySelector<HTMLInputElement>('[aria-label="Refresh"]')!, '15');
    expect(options).toEqual({ text: 'Updated', count: 5, enabled: true, choice: 'b', interval: 15 }); expect(form.validate()).toBe(true);
    set(form.element.querySelector<HTMLInputElement>('[aria-label="Count"]')!, '11');
    expect(form.element.querySelector('[data-field="count"] .widget-field-error')?.textContent).toBe('Maximum is 10');
    expect(form.validate()).toBe(false); expect(form.element.querySelector('[aria-label="Count"]')?.getAttribute('aria-invalid')).toBe('true');
    set(form.element.querySelector<HTMLInputElement>('[aria-label="Refresh"]')!, '0');
    expect(form.element.querySelector('[data-field="interval"] .widget-field-error')?.textContent).toBe('Minimum is 1');
  });
  it('browses the document tree and fills a section picker from the chosen document', async () => {
    const options: Record<string, unknown> = { src: '', section: '' };
    const form = fields([{ name: 'src', label: 'Document', type: 'document', required: true }, { name: 'section', label: 'Section', type: 'section', documentField: 'src' }], options);
    form.element.querySelector<HTMLButtonElement>('[aria-label="Browse Document"]')!.click(); await vi.advanceTimersByTimeAsync(0);
    [...form.element.querySelectorAll<HTMLButtonElement>('.widget-picker-tree button')].find(b => b.textContent === '▸ Docs')!.click(); await vi.advanceTimersByTimeAsync(0);
    expect([...form.element.querySelectorAll<HTMLButtonElement>('.widget-picker-tree button')].find(b => b.textContent === 'Locked')!.disabled).toBe(true);
    [...form.element.querySelectorAll<HTMLButtonElement>('.widget-picker-tree button')].find(b => b.textContent === 'Queue')!.click();
    await vi.advanceTimersByTimeAsync(250);
    expect(options.src).toBe('Docs/queue');
    const section = form.element.querySelector<HTMLSelectElement>('[aria-label="Section"]')!;
    expect([...section.options].map(o => o.textContent)).toEqual(['Whole document', 'Queue', 'Running', 'Done']);
    set(section, 'Running'); expect(options.section).toBe('Running'); expect(form.validate()).toBe(true);
  });
  it.each(['markdown', 'csv', 'json'])('offers type-specific controls for %s data sources', async kind => {
    const options: Record<string, unknown> = { source: { kind: 'markdown', src: '', section: '' } };
    const form = fields([widgetDefinition('live-table')!.editor!.fields![0]], options);
    set(form.element.querySelector<HTMLSelectElement>('[aria-label="Source format"]')!, kind);
    const label = kind === 'markdown' ? 'Source document' : 'Data file';
    set(form.element.querySelector<HTMLInputElement>('[aria-label="' + label + '"]')!, kind === 'markdown' ? 'Docs/queue' : 'Docs/jobs.' + kind);
    if (kind === 'markdown') { await vi.advanceTimersByTimeAsync(250); set(form.element.querySelector<HTMLSelectElement>('[aria-label="Section"]')!, 'Running'); }
    if (kind === 'json') set(form.element.querySelector<HTMLInputElement>('[aria-label="JSON array key"]')!, 'data.jobs');
    expect((options.source as { kind: string }).kind).toBe(kind); expect(form.validate()).toBe(true);
  });
  it('browses CSV files through the filtered data tree', async () => {
    const form = fields([widgetDefinition('live-table')!.editor!.fields![0]], { source: { kind: 'csv', src: '' } });
    form.element.querySelector<HTMLButtonElement>('[aria-label="Browse Data file"]')!.click(); await vi.advanceTimersByTimeAsync(0);
    [...form.element.querySelectorAll<HTMLButtonElement>('.widget-picker-tree button')].find(b => b.textContent === '▸ Docs')!.click(); await vi.advanceTimersByTimeAsync(0);
    [...form.element.querySelectorAll<HTMLButtonElement>('.widget-picker-tree button')].find(b => b.textContent === 'jobs.csv')!.click();
    expect(form.element.querySelector<HTMLInputElement>('[aria-label="Data file"]')!.value).toBe('Docs/jobs.csv'); expect(form.validate()).toBe(true);
  });
  it('picks, renames, reorders and formats columns and round-trips their options', () => {
    const options: Record<string, unknown> = { columns: [] };
    const form = fields([{ name: 'columns', label: 'Columns', type: 'columns', choices: ['job', 'progress', 'status'] }], options);
    [...form.element.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Use source columns')!.click();
    const label = form.element.querySelector<HTMLInputElement>('[aria-label="Column 2 label"]')!; label.focus(); set(label, '');
    expect(form.validate()).toBe(false); set(label, 'Complete');
    expect(document.activeElement).toBe(label); label.blur();
    set(form.element.querySelector<HTMLSelectElement>('[aria-label="Column 2 format"]')!, 'percent');
    form.element.querySelector<HTMLButtonElement>('[aria-label="Move column 2 up"]')!.click();
    expect((options.columns as { key: string }[])[0].key).toBe('progress');
    form.element.querySelector<HTMLButtonElement>('[aria-label="Remove column 3"]')!.click();
    const block = { type: 'widget' as const, options: { widget: 'live-table', source: { kind: 'csv', src: 'Docs/jobs.csv' }, ...options }, blocks: [] };
    const again = parseDoc(serializeDoc(meta, [block])).blocks[0];
    expect(again.type === 'widget' && again.options.columns).toEqual([{ key: 'progress', label: 'Complete', format: 'percent' }, { key: 'job', label: 'job', format: 'text' }]);
    expect(form.validate()).toBe(true);
  });
  it('runs custom field validation and isolates a faulty custom editor', () => {
    expect(validateWidgetField({ name: 'x', label: 'X', type: 'text', validate: () => 'Custom error' }, 'x', {})).toBe('Custom error');
    const bad = createWidgetFields({ name: 'bad', render: ctx => ctx.content, editor: { component() { throw new Error('broken component'); } } }, {}, 'Docs/demo', vi.fn());
    cleanups.push(bad.destroy); expect(bad.element.textContent).toContain('broken component'); expect(bad.validate()).toBe(false);
    const brokenField = fields([{ name: 'x', label: 'X', type: 'text', visibleWhen() { throw new Error('broken visibility'); } }]);
    expect(brokenField.element.textContent).toContain('broken visibility'); expect(brokenField.validate()).toBe(false);
  });
  it('supplies a custom editor with changes, signal, field errors and teardown', () => {
    let signal!: AbortSignal;
    const destroyed = vi.fn(); const options: Record<string, unknown> = {};
    const form = createWidgetFields({ name: 'custom', render: ctx => ctx.content, editor: { component(ctx) {
      signal = ctx.signal; const element = document.createElement('button'); element.textContent = 'Custom'; element.addEventListener('click', () => ctx.change({ custom: 'edited' }));
      return { element, destroy: destroyed, validate: () => true };
    } } }, options, 'Docs/demo', vi.fn());
    form.element.querySelector('button')!.click(); expect(options.custom).toBe('edited'); form.destroy(); expect(signal.aborted).toBe(true); expect(destroyed).toHaveBeenCalledOnce();
  });
});

describe('type-specific editor insertion, previews and save', () => {
  it('edits the disclosure title inline without making its marker editable', () => {
    let saved = '';
    const editor = openEditor({ docId: 'Docs/demo', meta, blocks: [{ type: 'widget', options: { widget: 'collapse', title: 'Queue', open: true }, blocks: [] }], allDocs: [], onSave: markdown => { saved = markdown; }, onClose: vi.fn() }); document.body.append(editor);
    const summary = editor.querySelector('summary')!, title = summary.querySelector<HTMLElement>('.wd-collapse-title')!;
    expect(title.contentEditable).toBe('true'); expect(summary.contentEditable).not.toBe('true');
    title.textContent = 'Edited inline queue'; title.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.querySelector<HTMLInputElement>('[aria-label="Title"]')!.value).toBe('Edited inline queue');
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Save')!.click();
    expect(saved).toContain('"title":"Edited inline queue"'); expect(saved).not.toContain('wd-collapse-title');
  });
  it('lists named widget types with icons/descriptions and no generic extension entry', () => {
    const editor = openEditor({ docId: 'Docs/demo', meta, blocks: [], allDocs: [], isNew: false, onSave: vi.fn(), onClose: vi.fn() }); document.body.append(editor);
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '+ Add widget')!.click();
    const names = [...document.querySelectorAll('.blk-menu button')].map(b => b.getAttribute('aria-label'));
    expect(names).toEqual(expect.arrayContaining(['Collapsible section', 'Auto-update section', 'Auto-update table', 'Panel']));
    expect(document.querySelector('.blk-menu')?.textContent).not.toContain('Extension widget'); expect(document.querySelectorAll('.blk-menu .widget-type-icon').length).toBeGreaterThanOrEqual(4);
    expect([...document.querySelectorAll('.blk-menu small')].every(n => n.textContent)).toBe(true);
  });
  it('inserts a table, edits its settings, previews real data and saves meta Markdown', async () => {
    let saved = '';
    const editor = openEditor({ docId: 'Docs/demo', meta, blocks: [], allDocs: [], isNew: false, onSave: markdown => { saved = markdown; }, onClose: vi.fn() }); document.body.append(editor);
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '+ Add widget')!.click();
    document.querySelector<HTMLButtonElement>('.blk-menu [aria-label="Auto-update table"]')!.click();
    const widget = editor.querySelector('.blk-widget')!; expect(widget.querySelector<HTMLElement>('.blk-widget-settings')!.hidden).toBe(true);
    expect(widget.querySelector<HTMLDetailsElement>('.widget-advanced')!.open).toBe(false);
    widget.querySelector<HTMLButtonElement>('[aria-label="Edit Auto-update table"]')!.click();
    set(widget.querySelector<HTMLSelectElement>('[aria-label="Source format"]')!, 'csv');
    set(widget.querySelector<HTMLInputElement>('[aria-label="Data file"]')!, 'Docs/jobs.csv');
    await vi.advanceTimersByTimeAsync(350);
    [...widget.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Use source columns')!.click();
    const columnLabel = widget.querySelector<HTMLInputElement>('[aria-label="Column 1 label"]')!; columnLabel.focus(); set(columnLabel, '');
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Save')!.click(); expect(saved).toBe('');
    set(columnLabel, 'Job'); columnLabel.blur();
    set(widget.querySelector<HTMLSelectElement>('[aria-label="Column 2 format"]')!, 'percent');
    await vi.advanceTimersByTimeAsync(200);
    expect(widget.querySelector('.blk-widget-preview table')?.textContent).toContain('50%');
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Save')!.click();
    expect(saved).toContain('"widget":"live-table"'); expect(saved).toContain('"kind":"csv"'); expect(saved).toContain('"format":"percent"');
    const parsed = parseDoc(saved); expect(parseDoc(serializeDoc(meta, toMarkdownBlocks(parsed.blocks))).blocks).toEqual(parsed.blocks);
  });
  it('preserves unknown raw options under Advanced and blocks invalid widget saves', () => {
    let saved = '';
    const editor = openEditor({ docId: 'Docs/demo', meta, blocks: [{ type: 'widget', options: { widget: 'live', src: '', section: '', interval: 60, extra: { preserved: true } }, blocks: [] }], allDocs: [], isNew: false, onSave: markdown => { saved = markdown; }, onClose: vi.fn() }); document.body.append(editor);
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Save')!.click(); expect(saved).toBe('');
    expect(editor.querySelector<HTMLElement>('.blk-widget-settings')!.hidden).toBe(false); expect(editor.querySelector('.widget-field-error')?.textContent).toContain('required');
    set(editor.querySelector<HTMLInputElement>('[aria-label="Source document"]')!, 'Docs/queue');
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Save')!.click(); expect(saved).toContain('"extra":{"preserved":true}');
  });
  it('lets a newly registered plugin appear by its own editor and saves its custom option', () => {
    registerWidget({ name: 'custom-editor-example', displayName: 'Custom card', icon: '✦', description: 'An editor supplied by a plugin.', editor: { component(ctx) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Set custom option'; button.onclick = () => ctx.change({ special: 'custom' }); return button;
    } }, render: ctx => ctx.content });
    let saved = '';
    const editor = openEditor({ docId: 'Docs/demo', meta, blocks: [], allDocs: [], isNew: false, onSave: markdown => { saved = markdown; }, onClose: vi.fn() }); document.body.append(editor);
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '+ Add widget')!.click(); document.querySelector<HTMLButtonElement>('.blk-menu [aria-label="Custom card"]')!.click();
    editor.querySelector<HTMLButtonElement>('[aria-label="Edit Custom card"]')!.click(); [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Set custom option')!.click();
    [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Save')!.click(); expect(saved).toContain('"special":"custom"');
  });
});
