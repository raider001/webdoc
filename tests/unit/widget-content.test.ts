import { afterEach, describe, it, expect, vi } from 'vitest';
import { replaceWidgetContent } from '/js/meta-blocks.js';
import { registerWidget } from '/js/widgets.js';
import type { WidgetContext } from '/js/widgets.js';
import { renderContent, teardownMounted, registerMounted } from '/js/reader.js';
import { app } from '/js/app-shell.js';
import { openEditor } from '/js/editor.js';
import { parseDoc } from '/js/editor/serialize.js';
import { wrapped } from './widget-harness.js';

// Widgets whose content is data their own editor changes (a diagram, say): the
// page editor hands them their inner Markdown, and the reader lets them save it.

const meta = { title: 'Example', description: '', assumes: [], next: [] };
afterEach(() => { teardownMounted(document.body); document.body.replaceChildren(); delete app.saveWidgetContent; });

describe('replaceWidgetContent', () => {
  const page = '# Page\r\n\r\n' + wrapped('diagram', 'old', { title: 'A' }) + '\r\n\r\n' + wrapped('diagram', 'other', { title: 'B' }) + '\r\nEnd\r\n';

  it('replaces only what the matching widget holds', () => {
    const updated = replaceWidgetContent(page, { widget: 'diagram', title: 'A' }, '\nold\n', '\nnew\n');
    expect(updated).toBe(page.replace('\nold\n', '\nnew\n'));
    expect(updated).toContain('other');
    expect(updated).toContain('# Page\r\n\r\n');
  });

  it('finds the widget by its options as well as its content', () => {
    const twins = wrapped('diagram', 'same', { title: 'A' }) + '\n' + wrapped('diagram', 'same', { title: 'B' });
    const updated = replaceWidgetContent(twins, { widget: 'diagram', title: 'B' }, '\nsame\n', '\nchanged\n')!;
    expect(updated.indexOf('changed')).toBeGreaterThan(updated.indexOf('"title":"B"'));
    expect(updated).toContain('\nsame\n');
  });

  it('finds widgets nested in other widgets', () => {
    const nested = wrapped('collapse', wrapped('diagram', 'inner'), { title: 'Section' });
    expect(replaceWidgetContent(nested, { widget: 'diagram' }, '\ninner\n', '\nnew\n')).toContain('\nnew\n');
  });

  it('refuses when the widget changed since the page was rendered', () => {
    expect(replaceWidgetContent(page, { widget: 'diagram', title: 'A' }, '\nsomething else\n', '\nnew\n')).toBeNull();
    expect(replaceWidgetContent(page, { widget: 'diagram', title: 'C' }, '\nold\n', '\nnew\n')).toBeNull();
  });
});

describe('a widget saving its own content from the reader', () => {
  let seen: WidgetContext | undefined;
  registerWidget({ name: 'self-saving-example', render: ctx => { seen = ctx; return ctx.content; } });

  it('may save on the page being read, each save following the last', async () => {
    app.registerMounted = registerMounted;
    const save = vi.fn(async () => {});
    app.saveWidgetContent = save;
    const root = renderContent(wrapped('self-saving-example', 'v1', { n: 1 }), 'Docs/example');
    document.body.append(root);
    expect(seen?.saveContent).toBeTypeOf('function');
    await seen!.saveContent!('\nv2\n');
    await seen!.saveContent!('\nv3\n');
    expect(save.mock.calls).toEqual([
      ['Docs/example', { widget: 'self-saving-example', n: 1 }, '\nv1\n', '\nv2\n'],
      ['Docs/example', { widget: 'self-saving-example', n: 1 }, '\nv2\n', '\nv3\n'],
    ]);
  });

  it('may not save from an editor preview', () => {
    seen = undefined;
    document.body.append(renderContent(wrapped('self-saving-example', 'v1'), 'Docs/example', 'editor-widget-1', 0, true, 'Docs/example:editor'));
    expect(seen).toBeDefined();
    expect(seen!.saveContent).toBeUndefined();
  });

  it('passes on why a save failed', async () => {
    app.saveWidgetContent = async () => { throw new Error('This part of the page was changed by someone else.'); };
    document.body.append(renderContent(wrapped('self-saving-example', 'v1'), 'Docs/example'));
    await expect(seen!.saveContent!('\nv2\n')).rejects.toThrow('changed by someone else');
  });
});

describe('a widget editor changing the widget content', () => {
  registerWidget({
    name: 'content-editor-example', displayName: 'Content example', render: ctx => ctx.content,
    editor: { component(ctx) {
      const read = document.createElement('button'); read.type = 'button'; read.textContent = 'Read content';
      read.onclick = () => { read.dataset.content = ctx.content?.get(); };
      const write = document.createElement('button'); write.type = 'button'; write.textContent = 'Write content';
      write.onclick = () => ctx.content?.set('```json\n{"changed":true}\n```');
      const box = document.createElement('div'); box.append(read, write); return box;
    } },
  });

  it('reads what the widget holds, replaces it, and the page saves the new content', () => {
    let saved = '';
    const blocks = parseDoc(wrapped('content-editor-example', '```json\n{"changed":false}\n```')).blocks;
    const editor = openEditor({ docId: 'Docs/demo', meta, blocks, allDocs: [], isNew: false, onSave: markdown => { saved = markdown; }, onClose: vi.fn() });
    document.body.append(editor);
    const button = (text: string) => [...editor.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
    editor.querySelector<HTMLButtonElement>('[aria-label="Edit Content example"]')!.click();

    button('Read content').click();
    expect(button('Read content').dataset.content).toBe('```json\n{"changed":false}\n```');

    button('Write content').click();
    // The blocks shown under the widget follow
    expect(editor.querySelector<HTMLTextAreaElement>('.blk-widget textarea.blk-code')!.value).toBe('{"changed":true}');
    button('Save').click();
    expect(saved).toContain('{"changed":true}');
    expect(saved).not.toContain('{"changed":false}');
  });
});
