import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { registerWidget } from '/js/widgets.js';
import type { WidgetContext } from '/js/widgets.js';
import { widgetHarness, wrapped } from './widget-harness.js';

let serial = 0;
const cleanups: (() => void)[] = [];
const mount = (markdown: string, docId?: string) => {
  const harness = widgetHarness(markdown, docId);
  cleanups.push(harness.destroy);
  return harness;
};
beforeEach(() => { localStorage.clear(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); });
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('widget error and lifecycle boundaries', () => {
  it('isolates a throwing render and unknown type from surrounding Markdown/widgets', async () => {
    const name = 'throws-' + serial++;
    registerWidget({ name, render() { throw new Error('Broken render'); } });
    const { root } = mount('# Before\n' + wrapped(name) + '\n' + wrapped('missing') + '\n' + wrapped('collapse', '**Still here**', { title: 'Working' }) + '\n# After');
    await Promise.resolve();
    expect(root.querySelectorAll('.wd-widget-error')).toHaveLength(2);
    expect(root.textContent).toContain('Broken render');
    expect(root.querySelector('details strong')?.textContent).toBe('Still here');
    expect(root.querySelectorAll('h1')).toHaveLength(2);
  });

  it.each(['render', 'mount', 'update'])('contains a rejected %s hook', async hook => {
    const name = 'reject-' + serial++;
    let context: WidgetContext | undefined;
    registerWidget({ name, render(ctx) { context = ctx; return hook === 'render' ? Promise.reject(new Error('Rejected render')) : ctx.content; },
      mount: () => hook === 'mount' ? Promise.reject(new Error('Rejected mount')) : undefined,
      update: () => Promise.reject(new Error('Rejected update')) });
    const { root } = mount(wrapped(name));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    if (hook === 'update') await context!.update();
    expect(root.querySelector('.wd-widget-error')?.textContent).toContain('Rejected ' + hook);
  });

  it('guards event callbacks and calls destroy once even when it throws', async () => {
    const name = 'guarded-' + serial++;
    const destroy = vi.fn(() => { throw new Error('teardown'); });
    let context: WidgetContext | undefined;
    registerWidget({ name, render(ctx) { context = ctx; return ctx.content; }, destroy });
    const harness = mount(wrapped(name));
    context!.guard(() => { throw new Error('event failed'); })();
    expect(harness.root.textContent).toContain('event failed');
    harness.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('ignores a late asynchronous render after navigation teardown', async () => {
    const name = 'late-' + serial++;
    let resolve!: (node: Node) => void;
    const mounted = vi.fn();
    registerWidget({ name, render: () => new Promise<Node>(r => { resolve = r; }), mount: mounted });
    const harness = mount(wrapped(name));
    harness.destroy();
    const late = document.createElement('p'); late.textContent = 'Too late';
    resolve(late);
    await Promise.resolve(); await Promise.resolve();
    expect(harness.root.textContent).not.toContain('Too late');
    expect(mounted).not.toHaveBeenCalled();
    expect(harness.mounted.size).toBe(0);
  });

  it('scrubs scripts, event attributes and script URLs in plugin output', () => {
    const name = 'scrub-' + serial++;
    registerWidget({ name, render() { const box = document.createElement('div'); box.innerHTML = '<script>bad()</script><a href="javascript:bad()" onclick="bad()">link</a>'; return box; } });
    const { root } = mount(wrapped(name));
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('a')?.hasAttribute('onclick')).toBe(false);
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  it('destroys nested content even when a renderer chooses not to display its body', () => {
    const child = 'unplaced-child-' + serial++;
    const parent = 'unplaced-parent-' + serial++;
    const destroyed = vi.fn();
    registerWidget({ name: child, render: ctx => ctx.content, destroy: destroyed });
    registerWidget({ name: parent, render: () => document.createElement('hr') });
    const harness = mount(wrapped(parent, wrapped(child)));
    harness.destroy();
    expect(destroyed).toHaveBeenCalledOnce();
    expect(harness.mounted.size).toBe(0);
  });
});

describe('collapsible reference widget', () => {
  it('uses native disclosure semantics, remembers state per page, and expands for print', async () => {
    const first = mount(wrapped('collapse', 'Body', { title: 'Queue', open: false, id: 'queue' }), 'Docs/one');
    await Promise.resolve();
    const details = first.root.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Queue');
    details.open = true; details.dispatchEvent(new Event('toggle'));
    first.destroy();
    const second = mount(wrapped('collapse', 'Body', { id: 'queue', open: false }), 'Docs/one');
    const other = mount(wrapped('collapse', 'Body', { id: 'queue', open: false }), 'Docs/two');
    await Promise.resolve();
    expect(second.root.querySelector('details')!.open).toBe(true);
    expect(other.root.querySelector('details')!.open).toBe(false);
    window.dispatchEvent(new Event('beforeprint'));
    expect(other.root.querySelector('details')!.open).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(other.root.querySelector('details')!.open).toBe(false);
    expect(localStorage.getItem('wd-widget:Docs/one:queue')).toBe('true');
  });

  it('continues to work when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const { root } = mount(wrapped('collapse', 'Body', { open: true }));
    await Promise.resolve();
    expect(root.querySelector('details')!.open).toBe(true);
    expect(root.querySelector('.wd-widget-error')).toBeNull();
  });
});
