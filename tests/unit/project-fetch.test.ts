import { afterEach, expect, it, vi } from 'vitest';
import { projectFetch, setActiveProject } from '../../src/js/project.js';

afterEach(() => { setActiveProject(null); vi.unstubAllGlobals(); });
it('scopes each index and run request while preserving its existing query', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
  setActiveProject('FAF-CLONE'); await projectFetch('/api/index/search?q=hello&limit=8');
  expect(fetch.mock.calls[0][0]).toBe('/api/index/search?q=hello&limit=8&project=FAF-CLONE');
  await projectFetch('/api/runs', { method: 'POST', body: '{}' });
  expect(fetch.mock.calls[1][0]).toBe('/api/runs?project=FAF-CLONE');
  setActiveProject('LM'); await projectFetch('/api/index/graph');
  expect(fetch.mock.calls[2][0]).toBe('/api/index/graph?project=LM');
});
