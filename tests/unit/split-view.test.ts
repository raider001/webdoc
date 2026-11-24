import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { document.body.innerHTML = '<button id="splitBtn"></button><button id="graphBtn"></button><div id="graphOverlay"></div>'; localStorage.clear(); vi.resetModules(); });

it('toggles the split pane, resizes with the keyboard, and remembers the choice', async () => {
  const view = await import('../../src/js/split-view.js'); view.setupSplitView();
  document.getElementById('splitBtn')!.click();
  expect(document.body.classList.contains('is-map-split')).toBe(true);
  expect(localStorage.getItem('wd-map-split')).toBe('true');
  const divider = document.getElementById('mapDivider')!;
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(divider.getAttribute('aria-valuenow')).toBe('52');
  view.applySplitView(false); expect(divider.hidden).toBe(true);
  view.applySplitView(true); expect(divider.hidden).toBe(false);
  document.getElementById('splitBtn')!.click(); expect(localStorage.getItem('wd-map-split')).toBe('false');
  expect(document.body.classList.contains('is-map-split')).toBe(false);
});

it('works when local storage refuses access', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const view = await import('../../src/js/split-view.js'); view.setupSplitView();
  expect(() => document.getElementById('splitBtn')!.click()).not.toThrow();
  expect(document.body.classList.contains('is-map-split')).toBe(true);
  vi.restoreAllMocks();
});
