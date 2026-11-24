import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const authoring = vi.hoisted(() => ({ imports: 0, forbidden: false }));
vi.mock('/js/authoring.js', async original => {
  authoring.imports++;
  if (authoring.forbidden) throw new Error('Read-only boot imported authoring');
  return original<typeof import('/js/authoring.js')>();
});
// Resolve the server's /build URL to the same shipped bundle on disk in Vitest.
vi.mock('/js/islands.js', () => ({ loadIslands: () => import('../../app/build/islands.js') }));

afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren();
  document.body.className = ''; history.replaceState(null, '', '/');
});

it.each([true, false])('boots the real two-project start page and menu with readOnly=%s', async readOnly => {
  vi.resetModules(); authoring.imports = 0; authoring.forbidden = readOnly;
  localStorage.clear(); history.replaceState(null, '', '/');
  const shell = new DOMParser().parseFromString(readFileSync('app/index.html', 'utf8'), 'text/html');
  document.body.innerHTML = shell.body.innerHTML;
  const projects = [
    { name: 'LM', title: 'LM', defaultDoc: 'LM/overview', sources: ['LM'] },
    { name: 'FAF-CLONE', title: 'FAF Clone', defaultDoc: 'FAF-CLONE/overview', sources: ['FAF-CLONE'] },
  ];
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input, location.origin);
    let body;
    if (url.pathname === '/site.json') body = { siteTitle: 'Kalynx', project: 'LM', projects, readOnly,
      defaultDoc: 'LM/overview', sources: [{ name: 'LM', url: '/docs/LM/' }] };
    else if (url.pathname === '/api/auth/me') body = { auth: { enabled: false }, canWrite: !readOnly };
    else if (url.pathname === '/api/index/status') body = { state: 'ready', docs: url.searchParams.get('project') === 'LM' ? 2 : 1 };
    else throw new Error('Unexpected start-page request: ' + input);
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', fetcher);
  await import('/js/main.js');
  await vi.waitFor(() => expect(document.body.getAttribute('data-app-ready')).toBe('1'));
  await vi.waitFor(() => expect([...document.querySelectorAll('.project-page-count')].map(el => el.textContent)).toEqual(['2 pages', '1 page']));
  expect(document.querySelector('h1')?.textContent).toBe('Kalynx');
  expect([...document.querySelectorAll<HTMLAnchorElement>('.project-card')].map(el => el.getAttribute('href'))).toEqual([
    location.origin + '/?project=LM#/LM/overview', location.origin + '/?project=FAF-CLONE#/FAF-CLONE/overview',
  ]);
  const button = document.querySelector<HTMLButtonElement>('#brand')!;
  button.click();
  expect([...document.querySelectorAll('[role=menuitem]')].map(el => el.textContent)).toEqual(['LM', 'FAF Clone', 'All projectsCurrent']);
  document.querySelector<HTMLElement>('[role=menuitem]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.activeElement).toBe(button);
  expect(authoring.imports).toBe(readOnly ? 0 : 1);
  expect(document.querySelector('link[href="/css/editor.css"],link[href="/css/runner.css"]')).toBeNull();
  expect(fetcher.mock.calls.every(([url]) => !/\/docs\//.test(url))).toBe(true);
});

it('keeps authoring and run assets outside the complete static entry and reader graphs', () => {
  const seen = new Set<string>();
  function visit(path: string): void {
    if (seen.has(path)) return;
    seen.add(path);
    // Match the path inside the repository only: the checkout's own location can
    // contain these words (GitHub's runners check out under /home/runner/).
    expect('/' + relative(resolve('.'), path)).not.toMatch(/(?:[\\/](?:authoring|editor|runner|automated-runs)(?:[.\\/-])|RunControls-)/);
    const code = readFileSync(path, 'utf8');
    for (const match of code.matchAll(/(?:^|\n)\s*import\s+(?:[^;\n]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const dep = match[1];
      if (dep.startsWith('.')) visit(resolve(dirname(path), dep));
      else if (dep.startsWith('/js/')) visit(resolve('app', dep.slice(1)));
      else if (dep.startsWith('/build/')) visit(resolve('app', dep.slice(1)));
    }
  }
  visit(resolve('app/js/main.js'));
  visit(resolve('app/build/islands.js'));
});
