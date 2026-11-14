import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import FolderPage from './FolderPage.svelte';
import Crumbs from './Crumbs.svelte';
import type { FolderInfo } from '/js/folders.js';

const info: FolderInfo = {
  path: 'Guides/kit',
  name: 'kit',
  title: 'Kit',
  page: null,
  folders: [{ name: 'parts', path: 'Guides/kit/parts', title: 'Parts', description: 'Every part.', page: null, docs: 3 }],
  docs: [
    { id: 'Guides/kit/setup', title: 'Setup', description: 'Put it together.' },
    { id: 'Guides/kit/secret', title: 'Secret', description: '', locked: true },
  ],
};

describe('FolderPage', () => {
  it('lists sub-folders and pages as links to their own addresses', () => {
    const { container } = render(FolderPage, { props: { info } });
    expect(container.querySelector('article.doc.folder-page h1')!.textContent).toBe('Kit');
    expect(container.querySelector('.doc-lede')!.textContent).toBe('1 folder · 2 pages');
    const folder = container.querySelector<HTMLAnchorElement>('a.folder-entry.is-folder')!;
    expect(folder.getAttribute('href')).toBe('#/Guides/kit/parts');
    expect(folder.textContent).toContain('Every part.');
    expect(folder.textContent).toContain('3 pages');
    const pages = [...container.querySelectorAll<HTMLAnchorElement>('a.folder-entry:not(.is-folder)')];
    expect(pages.map(a => a.getAttribute('href'))).toEqual(['#/Guides/kit/setup', '#/Guides/kit/secret']);
    expect(pages[1].classList.contains('is-locked')).toBe(true);
  });

  it('renders author-supplied titles as text, never markup', () => {
    const hostile = { ...info, title: '<img src=x onerror=alert(1)>', folders: [], docs: [] };
    const { container } = render(FolderPage, { props: { info: hostile } });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('h1')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(container.querySelector('.doc-lede')!.textContent).toBe('This folder is empty.');
  });

  it('offers to write a page only to an account that can write', () => {
    const onCreatePage = vi.fn();
    const reader = render(FolderPage, { props: { info, canWrite: false, onCreatePage } });
    expect(reader.container.querySelector('.folder-page-write')).toBeNull();
    reader.unmount();

    const writer = render(FolderPage, { props: { info, canWrite: true, onCreatePage } });
    writer.container.querySelector<HTMLButtonElement>('.folder-page-write button')!.click();
    expect(onCreatePage).toHaveBeenCalledOnce();
  });
});

describe('Crumbs', () => {
  it('links every folder in the trail to its page and leaves the current page as text', () => {
    const { container } = render(Crumbs, { props: { docId: 'Guides/kit/parts/bolt' } });
    expect([...container.querySelectorAll('a')].map(a => a.getAttribute('href')))
      .toEqual(['#/Guides', '#/Guides/kit', '#/Guides/kit/parts']);
    expect(container.querySelector('[aria-current="page"]')!.textContent).toBe('bolt');
    expect(container.querySelectorAll('.crumb-sep')).toHaveLength(3);
  });

  it('renders nothing for no page', () => {
    const { container } = render(Crumbs, { props: { docId: '' } });
    expect(container.textContent!.trim()).toBe('');
  });
});
