import { afterEach, describe, it, expect } from 'vitest';
import { parseDoc, serializeDoc, htmlToMd } from '/js/editor/serialize.js';
import { openEditor } from '/js/editor.js';
import type { Block } from '/js/editor.js';
import type { MdSourceBlock } from '/js/editor/serialize.js';
import { wrapped } from './widget-harness.js';

function convert(b: Block): MdSourceBlock {
  if (b.type === 'heading') return { type: b.type, level: b.level, text: htmlToMd(b.html) };
  if (b.type === 'paragraph' || b.type === 'quote') return { type: b.type, text: htmlToMd(b.html) };
  if (b.type === 'list') return { type: b.type, ordered: b.ordered, items: b.itemsHtml.map(htmlToMd) };
  if (b.type === 'widget') return { ...b, blocks: b.blocks.map(convert) };
  return b;
}
const metadata = { title: 'Dashboard', description: '', assumes: [], next: [] };
afterEach(() => { document.body.replaceChildren(); });

describe('widget editor round-trips', () => {
  it.each(['collapse', 'live', 'unknown-extension'])('retains %s options and nested Markdown', widget => {
    const inner = '## Heading\n\n**bold** [link](Docs/overview)\n\n| A | B |\n|---|---|\n| x | y |\n\n```text\n' + wrapped('collapse') + '\n```';
    const parsed = parseDoc(wrapped(widget, inner, { title: 'Queue', open: false, src: 'LM/live/queue', section: 'Running', interval: 60, extra: { nested: true } }));
    const markdown = serializeDoc(metadata, parsed.blocks.map(convert));
    const again = parseDoc(markdown);
    expect(again.blocks).toEqual(parsed.blocks);
    expect(markdown).toContain('"open":false');
    expect(markdown).toContain('[link](Docs/overview)');
    expect(markdown).toContain('"extra":{"nested":true}');
  });

  it('preserves nested widgets, requirements, tests and access boundaries', () => {
    const requirement = '<!--meta start {"requirement-group":"queue"}-->\n| requirement-no | description | trace-to |\n|---|---|---|\n| 1 | Job | sys_1 |\n<!--meta end {"requirement-group":"queue"}-->';
    const test = '<!--meta start {"test":"job","name":"Job","verifies":["queue_1"],"steps":[{"action":"Run | once","expected":"Done"}]}-->\n<!--meta end {"test":"job"}-->';
    const source = wrapped('collapse', '<!--access start {"read":["staff"]}-->\n' + requirement + '\n' + wrapped('collapse', test) + '\n<!--access end-->');
    const parsed = parseDoc(source);
    expect(parsed.lostMarkers).toBe(0);
    const markdown = serializeDoc(metadata, parsed.blocks.map(convert));
    expect(parseDoc(markdown).blocks).toEqual(parsed.blocks);
    expect(markdown).toContain('<!--access start {"read":["staff"]}-->');
    expect(markdown).toContain('Run | once');
  });

  it('preserves malformed widget source verbatim', () => {
    const source = '<!--meta start {"widget":"collapse",}-->\nDo not lose me\n<!--meta end {"widget":"collapse"}-->';
    const parsed = parseDoc(source);
    expect(parsed.blocks[0].type).toBe('widget');
    expect(serializeDoc(metadata, parsed.blocks.map(convert))).toContain(source);
  });

  it('escapes comment terminators in widget JSON without changing the option value', () => {
    const markdown = serializeDoc(metadata, [{ type: 'widget', options: { widget: 'collapse', title: 'Queue --> next' }, blocks: [] }]);
    const widget = parseDoc(markdown).blocks.find(b => b.type === 'widget')!;
    expect(widget.type === 'widget' && widget.options.title).toBe('Queue --> next');
  });

  it('inserts a collapsible section from the toolbar, edits fields and saves meta Markdown', () => {
    let saved = '';
    const editor = openEditor({ docId: 'Docs/example', meta: metadata, blocks: [{ type: 'paragraph', html: 'Before' }], allDocs: [], isNew: false, onSave: markdown => { saved = markdown; }, onClose: () => {} });
    document.body.append(editor);
    const add = [...editor.querySelectorAll('button')].find(b => b.textContent === '+ Add block')!;
    add.click();
    document.querySelector<HTMLButtonElement>('.blk-menu button[aria-label="Collapsible section"]')!.click();
    const widget = editor.querySelector('.blk-widget')!;
    widget.querySelector<HTMLButtonElement>('button[aria-label="Edit Collapsible section"]')!.click();
    const title = widget.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
    title.value = 'Card queue'; title.dispatchEvent(new Event('input'));
    const open = widget.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    open.checked = true; open.dispatchEvent(new Event('input'));
    const paragraph = widget.querySelector<HTMLElement>('.blk-widget-children [contenteditable="true"]')!;
    paragraph.innerHTML = '<strong>Nested</strong>'; paragraph.dispatchEvent(new Event('input'));
    [...editor.querySelectorAll('button')].find(b => b.textContent === 'Save')!.click();
    expect(saved).toContain('<!--meta start {"widget":"collapse","title":"Card queue","open":true}-->');
    expect(saved).toContain('**Nested**');
    expect(saved).toContain('<!--meta end {"widget":"collapse"}-->');
    expect(parseDoc(saved).blocks.some(b => b.type === 'widget')).toBe(true);
  });
});
