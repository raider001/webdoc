import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

// The server is the thing under test's only dependency, so it is the only thing
// faked. Everything else - the store, the lazy effect, the recursion - is real.
const fetchChildren = vi.fn();
vi.mock('/js/tree.js', () => ({ fetchChildren: (...a) => fetchChildren(...a) }));

const { default: TreeFolder } = await import('./TreeFolder.svelte');
const { treeState, invalidateTree } = await import('./stores/tree.svelte.js');

const wait = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  fetchChildren.mockReset();
  treeState.expanded = {};
  treeState.activeId = null;
});

describe('TreeFolder', () => {
  it('does NOT fetch its children while collapsed - the whole point of the lazy tree', async () => {
    render(TreeFolder, { props: { name: 'concepts', path: 'Guides/concepts', onSelect: () => {} } });
    await tick(); await wait();
    expect(fetchChildren).not.toHaveBeenCalled();
  });

  it('fetches exactly its own path when expanded', async () => {
    fetchChildren.mockResolvedValue({ folders: [], docs: [{ id: 'Guides/concepts/a', title: 'A' }] });
    treeState.expanded['Guides/concepts'] = true;
    const { container } = render(TreeFolder, { props: { name: 'concepts', path: 'Guides/concepts', onSelect: () => {} } });
    await tick(); await wait(); await tick();
    expect(fetchChildren).toHaveBeenCalledWith('Guides/concepts');
    expect(container.querySelector('a.doc-link[data-id="Guides/concepts/a"]')).toBeTruthy();
  });

  it('carries data-path, which is how the e2e suite targets a specific folder', async () => {
    const { container } = render(TreeFolder, { props: { name: 'concepts', path: 'Guides/concepts', onSelect: () => {} } });
    await tick();
    expect(container.querySelector('details[data-path="Guides/concepts"]')).toBeTruthy();
  });

  it('refetches on invalidateTree WITHOUT collapsing - the regression this phase fixes', async () => {
    fetchChildren.mockResolvedValue({ folders: [], docs: [{ id: 'Guides/concepts/a', title: 'A' }] });
    treeState.expanded['Guides/concepts'] = true;
    const { container } = render(TreeFolder, { props: { name: 'concepts', path: 'Guides/concepts', onSelect: () => {} } });
    await tick(); await wait(); await tick();
    expect(fetchChildren).toHaveBeenCalledTimes(1);

    invalidateTree();
    await tick(); await wait(); await tick();
    expect(fetchChildren).toHaveBeenCalledTimes(2);
    // Still open, and still showing children. The old renderTree() cleared the
    // container and collapsed everything at this point.
    expect(container.querySelector('details').open).toBe(true);
    expect(container.querySelector('a.doc-link[data-id="Guides/concepts/a"]')).toBeTruthy();
  });

  it('renders nested folders recursively', async () => {
    fetchChildren.mockResolvedValue({ folders: ['deeper'], docs: [] });
    treeState.expanded['Guides/concepts'] = true;
    const { container } = render(TreeFolder, { props: { name: 'concepts', path: 'Guides/concepts', onSelect: () => {} } });
    await tick(); await wait(); await tick();
    expect(container.querySelector('details[data-path="Guides/concepts/deeper"]')).toBeTruthy();
  });
});
