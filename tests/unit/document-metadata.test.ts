import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDoc, splitMeta, type Doc } from '/js/catalog.js';
import { documentLinks } from '/js/doclinks.js';
import { createIndexWatcher } from '/js/index-watch.js';

const stub = (): Doc => ({ id: 'LM/models/fl', source: 'LM', rel: 'models/fl.md', name: 'fl.md', url: '/docs/LM/models/fl.md' });
const response = (text: string, etag = '"v1"') => new Response(text, { headers: { ETag: etag } });
afterEach(() => vi.unstubAllGlobals());

describe('authored relation lists', () => {
  it.each(['next', 'assumes'] as const)('keeps the first occurrence of duplicate %s ids', field => {
    const source = `<!--meta ${JSON.stringify({ title: 'FL', [field]: ['LM/a', 'LM/a', 'LM/b', 'LM/a'] })}-->\n# Body`;
    const parsed = splitMeta(source);
    expect(parsed.meta[field]).toEqual(['LM/a', 'LM/b']);
    expect(parsed.body).toBe('# Body');
    expect(parsed.metaError).toBeNull();
  });
  it('rejects non-object metadata and sanitizes malformed relation arrays', () => {
    expect(splitMeta('<!--meta null-->\nBody').metaError).toBeTruthy();
    expect(splitMeta('<!--meta {"next":"LM/a","assumes":[null,"LM/a",42,"LM/a"]}-->').meta).toEqual({ next: [], assumes: ['LM/a'] });
  });
  it('does not duplicate inline links, external nodes or backlinks in the map model', () => {
    const a = { ...stub(), id: 'LM/a', body: '[B](LM/b) [B again](LM/b) [Web](https://example.test) [Web again](https://example.test)' };
    const b = { ...stub(), id: 'LM/b', body: '' };
    const links = documentLinks([a, b], []);
    expect(links.pageLinks).toEqual([{ from: 'LM/a', to: 'LM/b' }, { from: 'LM/a', to: 'ext:https://example.test' }]);
    expect(links.externalNodes).toHaveLength(1);
  });
});

describe('navigation document revalidation', () => {
  it('uses session credentials and replaces stale title, next and assumes on navigation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response('<!--meta {"title":"Old","next":["LM/a","LM/a"]}-->\nOld'))
      .mockResolvedValueOnce(response('<!--meta {"title":"New","next":["LM/b","LM/b"],"assumes":["LM/c","LM/c"]}-->\nNew', '"v2"'));
    vi.stubGlobal('fetch', fetch);
    const doc = stub();
    await loadDoc(doc);
    await loadDoc(doc); // secondary consumers can still share the loaded document
    expect(fetch).toHaveBeenCalledTimes(1);
    await loadDoc(doc, true);
    expect(doc.title).toBe('New');
    expect(doc.next).toEqual(['LM/b']);
    expect(doc.assumes).toEqual(['LM/c']);
    expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', headers: { 'If-None-Match': '"v1"' } });
  });
  it('keeps an unchanged document and revision on a conditional 304', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response('# Same')).mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetch);
    const doc = await loadDoc(stub());
    const revision = doc._rev;
    expect(await loadDoc(doc, true)).toBe(doc);
    expect(doc._rev).toBe(revision);
    expect(doc.body).toBe('# Same');
  });
  it.each([403, 404])('never reuses a successful cached read after a %s refusal', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('# Cached')).mockResolvedValueOnce(new Response('{}', { status })));
    const doc = await loadDoc(stub());
    await expect(loadDoc(doc, true)).rejects.toThrow();
    expect(doc._loaded).toBe(false);
  });
  it('invalidates a cache entry on network failure so it can recover', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('# Cached')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('# Recovered')));
    const doc = await loadDoc(stub());
    await expect(loadDoc(doc, true)).rejects.toThrow('offline');
    await loadDoc(doc);
    expect(doc.body).toBe('# Recovered');
  });
});

describe('index version checks', () => {
  it('sets its baseline at boot and refreshes once per new version, including server restarts', async () => {
    const refresh = vi.fn(async () => {});
    const watcher = createIndexWatcher(refresh);
    await watcher.observe({ state: 'ready', generation: 3, version: 'server1:3' });
    await watcher.observe({ state: 'ready', generation: 3, version: 'server1:3' });
    expect(refresh).not.toHaveBeenCalled();
    await watcher.observe({ state: 'ready', generation: 4, version: 'server1:4' });
    await watcher.observe({ state: 'ready', generation: 4, version: 'server1:4' });
    await watcher.observe({ state: 'ready', generation: 4, version: 'server2:4' });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('shares concurrent navigation and timer requests until refresh completes', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const watcher = createIndexWatcher(refresh);
    await watcher.observe({ state: 'ready', generation: 0 });
    const fetch = vi.fn(async () => Response.json({ state: 'ready', generation: 1 }));
    vi.stubGlobal('fetch', fetch);
    const first = watcher.check();
    expect(watcher.check()).toBe(first);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(watcher.check()).toBe(first);
    finish(); await first;
    await watcher.check();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('does not react to a building index or start a retry loop after failure', async () => {
    const refresh = vi.fn(async () => {});
    const watcher = createIndexWatcher(refresh);
    await watcher.observe({ state: 'building', generation: 1 });
    await watcher.observe({ state: 'ready', generation: 2 });
    expect(refresh).not.toHaveBeenCalled();
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ state: 'ready', generation: 3 }));
    vi.stubGlobal('fetch', fetch);
    await expect(watcher.check()).rejects.toThrow('offline');
    expect(fetch).toHaveBeenCalledTimes(1);
    await watcher.check();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
