import { afterEach, expect, it, vi } from 'vitest';
import { loadSite, type SiteConfig } from '/js/catalog.js';
import { projectFetch, setActiveProject } from '/js/project.js';

const legacy: SiteConfig = {
  legacy: true, siteTitle: 'WebDocs Fixtures', defaultDoc: 'Guides/getting-started',
  project: 'default', projects: [{ name: 'default', title: 'WebDocs Fixtures', sources: ['Guides'] }],
  sources: [{ name: 'Guides', url: '/docs/Guides/', component: 'FX' }],
};

afterEach(() => {
  setActiveProject(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

function respond(site: SiteConfig) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(site)));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it('keeps fixture hash navigation in the same document and still scopes API requests', async () => {
  history.replaceState(null, '', '/#/Guides/getting-started');
  const replace = vi.spyOn(history, 'replaceState');
  const fetcher = respond(legacy);
  await loadSite();
  expect(replace).not.toHaveBeenCalled();
  // This is the URL pair page.goto uses in the scoped teardown browser test.
  const next = new URL('/#/Guides/Verification', location.href);
  expect(location.pathname + location.search).toBe(next.pathname + next.search);
  expect(location.href).toMatch(/\/#\/Guides\/getting-started$/);
  await projectFetch('/api/index/coverage');
  expect(fetcher).toHaveBeenLastCalledWith('/api/index/coverage?project=default', undefined);
});

it('preserves an explicit legacy query and existing history state', async () => {
  history.replaceState({ reader: 'retained' }, '', '/?project=default&view=reader#/Guides/Requirements');
  respond(legacy);
  await loadSite();
  expect(location.search).toBe('?project=default&view=reader');
  expect(history.state).toEqual({ reader: 'retained' });
});

it('keeps project URLs for explicitly configured projects', async () => {
  history.replaceState(null, '', '/#/Guides/Requirements');
  respond({ ...legacy, legacy: false });
  await loadSite();
  expect(location.search).toBe('?project=default');
  expect(location.hash).toBe('#/Guides/Requirements');
});

it('selects the owning project from a legacy document bookmark', async () => {
  history.replaceState(null, '', '/#/LM/overview');
  const lm = { ...legacy, legacy: false, project: 'LM', defaultDoc: 'LM/overview',
    sources: [{ name: 'LM', url: '/docs/LM/', component: 'LM' }] };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
    ...legacy, legacy: false,
    projects: [...legacy.projects!, { name: 'LM', title: 'LM', sources: ['LM'] }],
  }))).mockResolvedValueOnce(new Response(JSON.stringify(lm)));
  vi.stubGlobal('fetch', fetcher);
  expect((await loadSite()).project).toBe('LM');
  expect(fetcher).toHaveBeenNthCalledWith(2, '/site.json?project=LM', { cache: 'no-cache' });
  expect(location.search).toBe('?project=LM');
  expect(location.hash).toBe('#/LM/overview');
});
