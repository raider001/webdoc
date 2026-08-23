import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { render } from '@testing-library/svelte';
import GroupChip from './GroupChip.svelte';
import { auth } from '/js/auth.js';

// The colour a chip draws is the one piece of real logic on this path, and it is
// the piece with a dependency nothing else in the suite has: groupColor() reads
// --group-sat and --group-light off document.documentElement. jsdom parses no
// stylesheets, so those custom properties do not exist here and the function
// would silently fall through to its own hardcoded fallbacks - which would make
// a naive assertion pass for entirely the wrong reason. So getComputedStyle is
// stubbed for the ROOT ELEMENT ONLY, from mutable values, and the decisive test
// is that changing them changes the chip.
let sat = '71%';
let light = '39%';

let spy: MockInstance<typeof window.getComputedStyle>;

beforeEach(() => {
  sat = '71%';
  light = '39%';
  const real = window.getComputedStyle.bind(window);
  spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt, pseudo) => {
    if (elt !== document.documentElement) return real(elt, pseudo);
    // A stand-in, not a CSSStyleDeclaration: getPropertyValue is the only member
    // the component under test ever reaches for, and building a real one would
    // mean building a real stylesheet engine.
    return {
      getPropertyValue: (prop: string) =>
        prop === '--group-sat' ? sat : prop === '--group-light' ? light : '',
    } as unknown as CSSStyleDeclaration;
  });
  auth.policy.groups = [];
});

afterEach(() => { spy.mockRestore(); auth.policy.groups = []; });

/**
 * The dot's inline background, as jsdom serialises it. jsdom resolves the
 * hsl() the component wrote into rgb(), which is why nothing here asserts on the
 * hsl text: what matters is that the VALUE moves with the tokens.
 */
const dotColor = (container: Element) =>
  container.querySelector('.group-dot')!.getAttribute('style');

const chipFor = (name: string) => dotColor(render(GroupChip, { props: { name } }).container);

describe('GroupChip colour derivation', () => {
  it('takes saturation and lightness from the THEME TOKENS, not from a hardcoded palette', () => {
    const themed = chipFor('engineering');
    expect(themed).toMatch(/^background:\s*rgb\(\d{1,3}, \d{1,3}, \d{1,3}\);?$/);
    // Same group, same hue - but with the tokens absent groupColor() falls back
    // to its own envelope, and the chip must come out a different colour. If it
    // did not, the tokens were never being read and the assertion above would be
    // testing nothing.
    sat = '';
    light = '';
    expect(chipFor('engineering')).not.toBe(themed);
  });

  it('gives one group the same hue every time, and different groups different ones', () => {
    expect(chipFor('engineering')).toBe(chipFor('engineering'));
    expect(chipFor('legal')).not.toBe(chipFor('engineering'));
  });

  it("lets an operator's configured colour win outright", () => {
    auth.policy.groups = [{ name: 'legal', label: 'Legal', description: '', color: '#ff0000' }];
    expect(chipFor('legal')).toBe('background: rgb(255, 0, 0);');
    // ...and only for the group it was configured on.
    expect(chipFor('engineering')).not.toBe('background: rgb(255, 0, 0);');
  });

  it('shows the configured label, and falls back to the raw name for an undeclared group', () => {
    auth.policy.groups = [{ name: 'legal', label: 'Legal & Compliance', description: '', color: null }];
    const known = render(GroupChip, { props: { name: 'legal' } });
    expect(known.container.querySelector('.group-chip')!.textContent).toBe('Legal & Compliance');
    // A group named only inside a document, never declared in config.json, still
    // has to read sensibly rather than render blank.
    const unknown = render(GroupChip, { props: { name: 'ad-hoc' } });
    expect(unknown.container.querySelector('.group-chip')!.textContent).toBe('ad-hoc');
  });

  it('reproduces the DOM contract auth.css and the editor select on', () => {
    const { container } = render(GroupChip, { props: { name: 'legal', small: true, title: 'Legal team' } });
    const chip = container.querySelector('span.group-chip')!;
    expect(chip.classList.contains('is-small')).toBe(true);
    expect(chip.getAttribute('title')).toBe('Legal team');
    expect(chip.firstElementChild!.className).toBe('group-dot');
  });

  it('omits the tooltip when none was asked for, as groupChip() did', () => {
    const { container } = render(GroupChip, { props: { name: 'legal' } });
    expect(container.querySelector('.group-chip')!.hasAttribute('title')).toBe(false);
  });

  it('renders an attacker-chosen group name as TEXT, never as markup', () => {
    const { container } = render(GroupChip, { props: { name: '<img src=x onerror=alert(1)>' } });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.group-chip')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
