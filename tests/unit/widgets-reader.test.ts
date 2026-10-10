import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountReqTable, mountTestCase } from '../../app/svelte/islands/requirements.js';
import { app } from '/js/app-shell.js';
import { setComponentBySource } from '/js/requirements/store.js';
import { renderContent, teardownMounted, registerMounted } from '/js/reader.js';
import { wrapped } from './widget-harness.js';

vi.mock('/js/islands.js', () => ({
  loadedIslands: () => ({ mountReqTable, mountTestCase, flushSync }),
  loadIslands: async () => ({ mountReqTable, mountTestCase, flushSync }),
}));

beforeEach(() => {
  app.registerMounted = registerMounted;
  setComponentBySource({ Docs: 'WD', LM: 'LM' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ resolved: { 'Docs/overview': 'Docs/overview' } }) })));
});
afterEach(() => { teardownMounted(document.body); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('reader widget integration', () => {
  it('renders nested requirements and tests with their real Svelte components and source ids', async () => {
    const req = '<!--meta start {"requirement-group":"queue"}-->\n| requirement-no | description | trace-to |\n|---|---|---|\n| 1 | **Queue** | |\n<!--meta end {"requirement-group":"queue"}-->';
    const test = '<!--meta start {"test":"queue","name":"Queue test","steps":[{"action":"Run","expected":"Done"}]}-->\n<!--meta end {"test":"queue"}-->';
    const root = renderContent(wrapped('collapse', req + '\n' + wrapped('collapse', test)), 'Docs/example', 'page', 0, true);
    document.body.append(root); await Promise.resolve();
    expect(root.querySelector('#req-R_WD_QUEUE_1')).toBeTruthy();
    expect(root.querySelector('#test-T_WD_queue')).toBeTruthy();
    expect(root.querySelector('details table')).toBeTruthy();
    expect(root.textContent).toContain('Queue test');
    expect(root.querySelector('.wd-widget-error')).toBeNull();
  });

  it('resolves refreshed links and images against the source, and scopes heading anchors', async () => {
    const root = renderContent('## Running\n[Jump](#running)\n[Docs](Docs/overview)\n![image](queue.png)', 'LM/live/queue', 'page.0', 1, true);
    document.body.append(root); await Promise.resolve(); await Promise.resolve();
    const heading = root.querySelector('h2')!;
    expect(heading.id).toBe('page.0-running');
    expect(root.querySelector('img')?.getAttribute('src')).toBe('/docs/LM/live/queue.png');
    await vi.waitFor(() => expect([...root.querySelectorAll('a')].some(a => a.getAttribute('href') === '#/Docs/overview')).toBe(true));
    const scroll = vi.fn(); heading.scrollIntoView = scroll;
    root.querySelector('a[href="#running"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(scroll).toHaveBeenCalledOnce();
  });
});
