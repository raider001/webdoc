import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSite, type SiteConfig } from '/js/catalog.js';
import { menuIndex, projectMenuModel, projectRoute, projectUrl } from '/js/project-navigation.js';
import { setupProjectMenu } from '/js/project-menu.js';
import { renderProjectStart } from '/js/project-start.js';
import { setActiveProject } from '/js/project.js';

const projects = [
  { name: 'one', title: 'First project', description: 'Project details', defaultDoc: 'A/home', sources: ['A'] },
  { name: 'two', title: 'Second project', defaultDoc: 'B/start', sources: ['B'] },
];
const site: SiteConfig = { siteTitle: 'Kalynx', project: 'one', projects,
  defaultDoc: 'A/home', sources: [{ name: 'A', url: '/docs/A/' }] };

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); setActiveProject(null);
  document.body.replaceChildren(); document.body.className = '';
  history.replaceState(null, '', '/');
});

describe('start-page routing', () => {
  it('opens the start page for a bare multi-project URL without selecting the server default', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(site)));
    vi.stubGlobal('fetch', fetcher);
    const result = await loadSite();
    expect(result.startPage).toBe(true);
    expect(result.project).toBeUndefined();
    expect(location.search).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('opens a sole project directly and keeps legacy URLs unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...site, projects: projects.slice(0, 1) }))));
    expect((await loadSite()).startPage).toBe(false);
    expect(location.search).toBe('?project=one');
    history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...site, legacy: true }))));
    expect((await loadSite()).startPage).toBe(false);
    expect(location.search).toBe('');
  });
  it('infers ownership from hash-only bookmarks and fetches the scoped default', async () => {
    history.replaceState(null, '', '/#/B/deep?req=R_B_1');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(site)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...site, project: 'two', defaultDoc: 'B/start', sources: [{ name: 'B', url: '/docs/B/' }] })));
    vi.stubGlobal('fetch', fetcher);
    expect((await loadSite()).project).toBe('two');
    expect(fetcher).toHaveBeenNthCalledWith(2, '/site.json?project=two', { cache: 'no-cache' });
    expect(location.search).toBe('?project=two');
    expect(location.hash).toBe('#/B/deep?req=R_B_1');
  });
  it('gives an explicit project priority, including an invalid explicit name', () => {
    expect(projectRoute(site, '?project=two', '#/A/home')).toEqual({ project: 'two', startPage: false });
    expect(projectRoute(site, '?project=missing', '')).toEqual({ project: 'missing', startPage: false });
  });
  it('does not mistake a page bookmark, an empty route, or a heading for a selected project', () => {
    expect(projectRoute(site, '', '#/B/start').project).toBe('two');
    expect(projectRoute(site, '', '#/').startPage).toBe(true);
    expect(projectRoute(site, '', '#heading').startPage).toBe(true);
    expect(projectRoute(site, '', '#/%E0%A4%A/page').startPage).toBe(false);
  });
  it('builds project defaults and clean start URLs while preserving unrelated query parameters', () => {
    expect(projectUrl('http://localhost/?view=projects&x=1#/A/deep', projects[1])).toBe('http://localhost/?x=1&project=two#/B/start');
    expect(projectUrl('http://localhost/?project=two&x=1#/B/start', null)).toBe('http://localhost/?x=1');
    expect(projectUrl('http://localhost/', projects[0], true)).toBe('http://localhost/#/A/home');
    expect(projectRoute({ ...site, projects: projects.slice(0, 1) }, '?view=projects', '').startPage).toBe(true);
    expect(projectRoute({ ...site, legacy: true }, '?view=projects', '').startPage).toBe(true);
  });
});

describe('project menu', () => {
  it('lists titles in config order, marks only the current project and includes All projects', () => {
    expect(projectMenuModel(projects, 'two').map(({ label, current }) => [label, current])).toEqual([
      ['First project', false], ['Second project', true], ['All projects', false],
    ]);
    expect(projectMenuModel(projects, null).at(-1)?.current).toBe(true);
  });
  it('wraps arrows and supports Home and End', () => {
    expect(menuIndex('ArrowUp', 0, 3)).toBe(2);
    expect(menuIndex('ArrowDown', 2, 3)).toBe(0);
    expect(menuIndex('Home', 2, 3)).toBe(0);
    expect(menuIndex('End', 0, 3)).toBe(2);
    expect(menuIndex('ArrowDown', 0, 0)).toBe(-1);
  });
  it('opens, moves focus, closes on Escape and restores button focus', () => {
    document.body.innerHTML = '<button id="brand"></button><div id="projectMenu" hidden></div>';
    setupProjectMenu(site, async () => true, vi.fn());
    const button = document.querySelector<HTMLButtonElement>('#brand')!;
    button.click();
    const items = document.querySelectorAll<HTMLButtonElement>('[role=menuitem]');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(items[0]);
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(items[2]);
    items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector<HTMLElement>('#projectMenu')!.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    button.click(); document.body.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
  it('closes on an outside click without moving focus to the menu button', () => {
    document.body.innerHTML = '<button id="brand"></button><div id="projectMenu" hidden></div><h1>Document</h1>';
    setupProjectMenu(site, async () => true, vi.fn());
    const button = document.querySelector<HTMLButtonElement>('#brand')!;
    button.click();
    const focus = vi.spyOn(button, 'focus');
    document.querySelector('h1')!.click();
    expect(document.querySelector<HTMLElement>('#projectMenu')!.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(focus).not.toHaveBeenCalled();
  });
  it('keeps focus on a clicked outside control', () => {
    document.body.innerHTML = '<button id="brand"></button><div id="projectMenu" hidden></div><input id="outside">';
    setupProjectMenu(site, async () => true, vi.fn());
    document.querySelector<HTMLButtonElement>('#brand')!.click();
    const outside = document.querySelector<HTMLInputElement>('#outside')!;
    // jsdom does not perform the browser's native pointer-focus step.
    outside.focus(); outside.click();
    expect(document.querySelector<HTMLElement>('#projectMenu')!.hidden).toBe(true);
    expect(document.activeElement).toBe(outside);
  });
  it('waits for the discard guard and leaves the URL unchanged when cancelled', async () => {
    document.body.innerHTML = '<button id="brand"></button><div id="projectMenu" hidden></div>';
    const guard = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const button = document.querySelector<HTMLButtonElement>('#brand')!;
    const go = vi.fn(() => expect(document.activeElement).toBe(button));
    setupProjectMenu(site, guard, go);
    const target = document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')[1];
    button.click(); target.focus();
    target.click(); await Promise.resolve(); expect(go).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    button.click(); target.focus();
    target.click(); await Promise.resolve(); expect(go).toHaveBeenCalledWith(expect.stringContaining('?project=two#/B/start'));
  });
});

it('renders safe project cards with optional descriptions, counts and default links', async () => {
  document.body.innerHTML = '<main id="content"></main>';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'ready', docs: 1 }))));
  renderProjectStart({ ...site, siteTitle: '<Kalynx>' });
  await vi.waitFor(() => expect(document.querySelector('.project-page-count')?.textContent).toBe('1 page'));
  expect(document.title).toBe('<Kalynx>');
  expect(document.querySelector('h1')?.textContent).toBe('<Kalynx>');
  expect(document.querySelectorAll('.project-card')).toHaveLength(2);
  expect(document.querySelectorAll('.project-description')).toHaveLength(1);
  expect(document.querySelector('.project-card')?.getAttribute('href')).toContain('?project=one#/A/home');
  expect(fetch).toHaveBeenCalledWith('/api/index/status?project=two', { cache: 'no-cache' });
});

it('keeps cards usable while a cold index builds, then shows its completed count', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<main id="content"></main>';
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ state: 'building', docs: 1 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'ready', docs: 0 })));
  vi.stubGlobal('fetch', fetcher);
  renderProjectStart({ ...site, projects: projects.slice(0, 1) });
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.project-page-count')?.textContent).toBe('Counting pages…');
  expect(document.querySelector<HTMLAnchorElement>('.project-card')?.href).toContain('#/A/home');
  await vi.advanceTimersByTimeAsync(500);
  expect(document.querySelector('.project-page-count')?.textContent).toBe('0 pages');
});
