import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

// The server is the thing under test's only dependency, so it is the only thing
// faked. Everything else - the store, the lazy effect, the recursion - is real.
const fetchChildren = vi.fn();
vi.mock('/js/tree.js', async importOriginal => ({
  ...await importOriginal<typeof import('/js/tree.js')>(),
  fetchChildren: (...a: unknown[]) => fetchChildren(...a),
}));

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
    expect(fetchChildren).toHaveBeenCalledWith('Guides/concepts', expect.any(Number));
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
    expect(container.querySelector('details')!.open).toBe(true);
    expect(container.querySelector('a.doc-link[data-id="Guides/concepts/a"]')).toBeTruthy();
  });

  it('renders nested folders recursively', async () => {
    fetchChildren.mockResolvedValue({ folders: ['deeper'], docs: [] });
    treeState.expanded['Guides/concepts'] = true;
    const { container } = render(TreeFolder, { props: { name: 'concepts', path: 'Guides/concepts', onSelect: () => {} } });
    await tick(); await wait(); await tick();
    expect(container.querySelector('details[data-path="Guides/concepts/deeper"]')).toBeTruthy();
  });

  it('labels the folder with a link to its own page, separate from the expand chevron', async () => {
    const onSelect = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    fetchChildren.mockResolvedValue({ folders: [], docs: [] });   // opening the folder fetches it
    const { container } = render(TreeFolder, { props: { name: 'how-to', path: 'Guides/how-to', onSelect } });
    await tick();
    const link = container.querySelector<HTMLAnchorElement>('summary > a.folder-link')!;
    expect(container.querySelector('summary > .tree-chevron')).toBeTruthy();
    expect(link.getAttribute('href')).toBe('#/Guides/how-to');
    expect(link.textContent).toBe('How To');            // no page file: the prettified name

    link.click();
    await tick();
    expect(onSelect).toHaveBeenCalledWith('Guides/how-to');
    // Opening the page opens the folder, so its contents show alongside.
    expect(treeState.expanded['Guides/how-to']).toBe(true);
  });

  it("is named after its page file, and active when that page is read by its own id", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    fetchChildren.mockResolvedValue({ folders: [], docs: [] });
    const page = { id: 'Guides/kit/README', title: 'Kit Overview' };
    const { container } = render(TreeFolder, { props: { name: 'kit', path: 'Guides/kit', page, onSelect: () => {} } });
    await tick();
    const link = container.querySelector('a.folder-link')!;
    expect(link.textContent).toBe('Kit Overview');
    expect(link.getAttribute('aria-current')).toBeNull();

    treeState.activeId = 'Guides/kit/README';
    await tick(); await wait(); await tick();
    expect(link.getAttribute('aria-current')).toBe('page');
    // Becoming the page being read opens the folder.
    expect(treeState.expanded['Guides/kit']).toBe(true);
  });

  it('passes each child folder its page from the level it fetched', async () => {
    fetchChildren.mockResolvedValue({ folders: ['kit'], docs: [], pages: { kit: { id: 'Guides/concepts/kit/README', title: 'Kit' } } });
    treeState.expanded['Guides/concepts'] = true;
    const { container } = render(TreeFolder, { props: { name: 'concepts', path: 'Guides/concepts', onSelect: () => {} } });
    await tick(); await wait(); await tick();
    expect(container.querySelector('details[data-path="Guides/concepts/kit"] a.folder-link')!.textContent).toBe('Kit');
  });

  it('does not subscribe the loading effect to incidental synchronous dependency reads', async () => {
    fetchChildren.mockImplementation(() => {
      void treeState.activeId;
      return Promise.resolve({ folders: [], docs: [] });
    });
    treeState.expanded['LM/models'] = true;
    render(TreeFolder, { props: { name: 'models', path: 'LM/models', onSelect: () => {} } });
    await tick(); await wait();
    treeState.activeId = 'LM/models/failed';
    await tick(); await wait();
    expect(fetchChildren).toHaveBeenCalledTimes(1);
  });
});
