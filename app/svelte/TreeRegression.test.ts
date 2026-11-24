import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import DocTree from './DocTree.svelte';
import FootGroup from './FootGroup.svelte';
import { setActive, treeState, invalidateTree, setFolderOpen } from './stores/tree.svelte.js';
import { setFootLinks, shellState } from './stores/shell.svelte.js';
import { loadDoc } from '/js/catalog.js';
import { fetchChildren } from '/js/tree.js';

beforeEach(() => {
  treeState.expanded = {};
  treeState.activeId = null;
  invalidateTree();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const settle = async () => { await tick(); await new Promise(resolve => setTimeout(resolve, 20)); await tick(); };

describe('duplicate-safe chrome', () => {
  it.each(['next', 'assumes'] as const)('deduplicates %s in both the store and directly supplied footer props', field => {
    setFootLinks(['LM/p', 'LM/p'], ['LM/n', 'LM/n']);
    expect(shellState[field]).toHaveLength(1);
    const { container } = render(FootGroup, { caption: field, ids: ['LM/a', 'LM/a', 'LM/b', 'LM/a'] });
    flushSync();
    expect([...container.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['#/LM/a', '#/LM/b']);
  });
});

describe('tree request regression', () => {
  it('keeps tree fetch counts bounded after a failed document load and repeated chrome updates', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('/docs/')) return new Response('missing', { status: 404 });
      const path = new URL(url, 'http://localhost').searchParams.get('path');
      return Response.json(path === '' ? { folders: ['LM', 'LM'], docs: [] }
        : path === 'LM' ? { folders: ['models', 'models'], docs: [] }
        : { folders: [], docs: [{ id: 'LM/models/fl', title: 'FL' }, { id: 'LM/models/fl', title: 'Duplicate' }] });
    });
    vi.stubGlobal('fetch', fetch);
    setActive('LM/models/fl');
    const { container } = render(DocTree, { onSelect: () => {} });
    await vi.waitFor(() => expect(container.querySelector('a[data-id="LM/models/fl"]')).toBeTruthy());
    await expect(loadDoc({ id: 'LM/models/fl', source: 'LM', rel: 'models/fl.md', name: 'fl.md', url: '/docs/LM/models/fl.md' }, true)).rejects.toThrow();
    for (let i = 0; i < 25; i++) {
      setActive('LM/models/fl');
      setFootLinks(['LM/a', 'LM/a'], ['LM/b', 'LM/b']);
      setFolderOpen('LM/models', true);
      flushSync();
    }
    await settle();
    const treeCalls = fetch.mock.calls.filter(([url]) => url.startsWith('/api/index/tree'));
    expect(treeCalls).toHaveLength(3); // root, source, chapter, once each
    expect(container.querySelectorAll('a[data-id="LM/models/fl"]')).toHaveLength(1);
    invalidateTree();
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/index/tree'))).toHaveLength(6));
    await settle();
    expect(container.querySelector('details[data-path="LM/models"]')?.hasAttribute('open')).toBe(true);
  });

  it('coalesces concurrent/repeated requests, including failures, until explicit invalidation', async () => {
    const fetch = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', fetch);
    const generation = treeState.generation;
    await Promise.all(Array.from({ length: 100 }, () => fetchChildren('LM/models', generation)));
    expect(fetch).toHaveBeenCalledOnce();
    expect(await fetchChildren('LM/models', generation)).toEqual({ folders: [], docs: [] });
    expect(fetch).toHaveBeenCalledOnce();
    await fetchChildren('LM/models', generation + 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('updates tree titles on a new generation without reopening a closed chapter', async () => {
    let title = 'Old';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url, 'http://localhost').searchParams.get('path');
      return Response.json(path === '' ? { folders: ['LM'], docs: [] } : { folders: [], docs: [{ id: 'LM/a', title }] });
    }));
    const { container } = render(DocTree, { onSelect: () => {} });
    await vi.waitFor(() => expect(container.textContent).toContain('Old'));
    title = 'New'; invalidateTree();
    await vi.waitFor(() => expect(container.textContent).toContain('New'));
    setFolderOpen('LM', false); await settle();
    invalidateTree(); await settle();
    expect(container.querySelector('details')?.open).toBe(false);
  });
});
