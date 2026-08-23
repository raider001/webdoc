import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Toc from './Toc.svelte';

// A stand-in for the #content pane: the headings the TOC points at, with the ids
// numberHeadings() would have assigned them.
/** @param {{id: string}[]} headings */
function contentPane(headings) {
  const pane = document.createElement('div');
  for (const h of headings) {
    const el = document.createElement('h2');
    el.id = h.id;
    el.textContent = h.id;
    // jsdom implements neither scrollIntoView nor smooth scrolling.
    el.scrollIntoView = () => {};
    pane.appendChild(el);
  }
  document.body.appendChild(pane);
  return pane;
}

const entries = [
  { level: 1, number: '1', text: 'Overview', id: 'overview' },
  { level: 2, number: '1.1', text: 'Getting started', id: 'getting-started' },
];

describe('Toc', () => {
  it('reproduces the DOM contract scroll-spy and the e2e suite select on', () => {
    const { container } = render(Toc, { props: { entries, contentEl: contentPane(entries) } });

    // data-target is how setupScrollSpy() maps a heading back to its entry.
    const links = container.querySelectorAll('ol > li > a[data-target]');
    expect(links.length).toBe(2);
    expect([...links].map(a => a.getAttribute('data-target'))).toEqual(['overview', 'getting-started']);
    expect([...links].map(a => a.getAttribute('href'))).toEqual(['#overview', '#getting-started']);

    // `#tocList a .n` is asserted against the headings' data-heading-number by
    // tests/test_e2e.py::test_heading_numbers_match_toc.
    expect([...container.querySelectorAll('a .n')].map(n => n.textContent.trim())).toEqual(['1', '1.1']);

    // The level lives on the <li>; app.css indents `#tocList .lvl-N a` by it.
    expect([...container.querySelectorAll('ol > li')].map(li => li.className)).toEqual(['lvl-1', 'lvl-2']);

    // The heading text is a sibling of span.n, not inside it.
    expect(links[0].textContent).toBe('1Overview');
  });

  it('scrolls and focuses the heading instead of following the href', () => {
    const pane = contentPane(entries);
    const { container } = render(Toc, { props: { entries, contentEl: pane } });

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    container.querySelector('a[data-target="getting-started"]').dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    const heading = pane.querySelector('#getting-started');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
  });

  it('survives ids that are legal ids but illegal selectors', () => {
    // Both come out of numberHeadings(): a heading starting with a digit, and
    // the 'sec-<dotted number>' fallback for one whose text slugifies to
    // nothing. Unescaped, the first THROWS in querySelector and the second
    // silently matches nothing - which is why cssEscape() is still here.
    const odd = [
      { level: 1, number: '1', text: '2024 Roadmap', id: '2024-roadmap' },
      { level: 2, number: '1.2.1', text: '???', id: 'sec-1.2.1' },
    ];
    const pane = contentPane(odd);
    const { container } = render(Toc, { props: { entries: odd, contentEl: pane } });

    container.querySelector('a[data-target="2024-roadmap"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(pane.querySelector('[id="2024-roadmap"]'));

    container.querySelector('a[data-target="sec-1.2.1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(pane.querySelector('[id="sec-1.2.1"]'));
  });

  it('renders an empty list before the first document, as buildTOC always did', () => {
    const { container } = render(Toc, { props: { contentEl: contentPane([]) } });
    expect(container.querySelector('ol')).toBeTruthy();
    expect(container.querySelectorAll('a').length).toBe(0);
  });
});
