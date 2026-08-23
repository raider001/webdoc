import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import SearchHit from './SearchHit.svelte';

describe('SearchHit', () => {
  it('reproduces the DOM contract the CSS and the e2e suite select on', () => {
    const { container } = render(SearchHit, {
      props: { hit: { docId: 'Guides/getting-started', title: 'Getting Started', snippet: 'a snippet' }, onSelect: () => {} },
    });
    const a = container.querySelector('a.search-hit')!;
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe('#/Guides/getting-started');
    expect(container.querySelector('.search-hit-title')!.textContent).toBe('Getting Started');
    expect(container.querySelector('.search-hit-sub')!.textContent).toBe('a snippet');
    expect(a.classList.contains('is-locked')).toBe(false);
  });

  it('omits the subtitle when the server withheld a snippet', () => {
    const { container } = render(SearchHit, {
      props: { hit: { docId: 'a/b', title: 'T' }, onSelect: () => {} },
    });
    expect(container.querySelector('.search-hit-sub')).toBeNull();
  });

  it('marks a locked hit, which the server sends without a snippet', () => {
    const { container } = render(SearchHit, {
      props: { hit: { docId: 'a/b', title: 'Secret', locked: true }, onSelect: () => {} },
    });
    expect(container.querySelector('a.search-hit')!.classList.contains('is-locked')).toBe(true);
  });

  it('routes through onSelect instead of letting the browser follow the href', async () => {
    const onSelect = vi.fn();
    const { container } = render(SearchHit, {
      props: { hit: { docId: 'x/y', title: 'X' }, onSelect },
    });
    const a = container.querySelector('a.search-hit')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(onSelect).toHaveBeenCalledWith('x/y');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('leaves a modified click alone so open-in-new-tab still works', () => {
    const onSelect = vi.fn();
    const { container } = render(SearchHit, {
      props: { hit: { docId: 'x/y', title: 'X' }, onSelect },
    });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    container.querySelector('a.search-hit')!.dispatchEvent(ev);
    expect(onSelect).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});
