import { afterEach, describe, expect, it } from 'vitest';
import { scrubRendered, trustLiveMount } from '/js/blocks.js';
import { setReadOnly } from '/js/policy.js';
import { registerWidget } from '/js/widgets.js';
import type { WidgetContext } from '/js/widgets.js';
import { renderContent, teardownMounted } from '/js/reader.js';
import { app } from '/js/app-shell.js';
import { wrapped } from './widget-harness.js';

// Re-merging 158 over software designs: a plugin library's live viewer must keep
// the DOM it draws and ticks checkboxes with, and read-only mode must offer no
// widget writes. The renderer scrub stays as strict as 154E everywhere else.

afterEach(() => { setReadOnly(false); teardownMounted(document.body); document.body.replaceChildren(); delete app.saveWidgetContent; });

const SVG = 'http://www.w3.org/2000/svg';

function design(): string {
  return `<svg xmlns="${SVG}" style="width:100%" data-zoom="1"><defs><pattern id="grid" patternUnits="userSpaceOnUse"><path d="M0 0" style="stroke: var(--sd-grid)"/></pattern></defs>
    <g class="sd-checkbox" data-checkbox-for="add" role="checkbox" tabindex="0" aria-checked="true" onclick="attack()"><rect width="9" height="9"/></g>
    <foreignObject width="10" height="10"><div style="display:flex">label</div></foreignObject>
    <set attributeName="href" to="javascript:attack()"/><a href="javascript:attack()"><text>x</text></a></svg><script>attack()</script>`;
}

describe('a trusted live mount under the 154E renderer scrub', () => {
  it('keeps its presentation and checkboxes but still loses executable content', () => {
    const host = document.createElement('div');
    const mount = document.createElement('div');
    mount.innerHTML = design();
    host.append(mount);
    trustLiveMount(mount);
    scrubRendered(host);
    expect(mount.querySelector('pattern')).not.toBeNull();
    expect(mount.querySelector('foreignObject div')?.getAttribute('style')).toBe('display:flex');
    expect(mount.querySelector('svg')?.getAttribute('style')).toBe('width:100%');
    expect(mount.querySelector('svg')?.getAttribute('data-zoom')).toBe('1');
    const box = mount.querySelector('.sd-checkbox')!;
    expect([box.getAttribute('data-checkbox-for'), box.getAttribute('role'), box.getAttribute('tabindex'), box.getAttribute('aria-checked')])
      .toEqual(['add', 'checkbox', '0', 'true']);
    expect(box.hasAttribute('onclick')).toBe(false);
    expect(mount.querySelectorAll('script,set')).toHaveLength(0);
    expect(mount.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  it('a class name cannot claim the exemption; untrusted output is scrubbed as before', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="wd-mounted wd-software-design">' + design() + '</div>';
    scrubRendered(host);
    expect(host.querySelectorAll('pattern,foreignObject,script,set')).toHaveLength(0);
    expect(host.querySelectorAll('[style],[data-checkbox-for],[tabindex],[onclick]')).toHaveLength(0);
  });

  it('the mount point itself is still scrubbed when it is the container', () => {
    const mount = document.createElement('div');
    mount.innerHTML = design();
    trustLiveMount(mount);
    scrubRendered(mount);
    // Descendants of a trusted root keep presentation, even when the root is the container.
    expect(mount.querySelector('pattern')).not.toBeNull();
    expect(mount.querySelectorAll('script,set')).toHaveLength(0);
  });
});

describe('widget writes in read-only mode', () => {
  let seen: WidgetContext | undefined;
  registerWidget({ name: 'remerge-158r-saver', render: ctx => { seen = ctx; return ctx.content; } });

  it('are offered on the page being read in private mode', () => {
    seen = undefined;
    app.saveWidgetContent = async () => {};
    document.body.append(renderContent(wrapped('remerge-158r-saver', 'v1'), 'Docs/example'));
    expect(seen?.saveContent).toBeTypeOf('function');
  });

  it('are not offered at all in read-only mode', () => {
    seen = undefined;
    setReadOnly(true);
    app.saveWidgetContent = async () => {};
    document.body.append(renderContent(wrapped('remerge-158r-saver', 'v1'), 'Docs/example'));
    expect(seen).toBeDefined();
    expect(seen!.saveContent).toBeUndefined();
  });
});
