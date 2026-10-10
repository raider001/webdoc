import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { extractSection, liveSourceUrl, fetchLiveSource, liveInterval } from '/js/widgets/live.js';
import { widgetHarness, wrapped } from './widget-harness.js';
import { loadAuth } from '/js/auth.js';

let hidden = false;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers(); hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => {
  cleanups.splice(0).forEach(fn => fn());
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});
const response = (body: string, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const settle = () => vi.advanceTimersByTimeAsync(0);
const mountLive = (interval = 10, fallback = 'Fallback') => {
  const harness = widgetHarness(wrapped('collapse', 'Sibling', { id: 'sibling' }) + '\n' + wrapped('live', fallback, { src: 'LM/live/queue', section: 'Running', interval }));
  cleanups.push(harness.destroy);
  return harness;
};

describe('live source and section extraction', () => {
  it('extracts a heading and its subsections, excluding later peers and fenced headings', () => {
    const source = '<!--meta {"title":"Queue"}-->\n# Queue\n## Running\n- job\n```text\n## Done\n```\n### Details\nwork\n## Done\nfinished';
    expect(extractSection(source, 'Running')).toBe('## Running\n- job\n```text\n## Done\n```\n### Details\nwork');
    expect(extractSection(source)).toContain('# Queue');
    expect(extractSection(source)).not.toContain('<!--meta {');
  });

  it('supports setext and formatted ATX headings and reports absent sections', () => {
    expect(extractSection('Running\n=======\nBody\nDone\n====\nFinished', 'Running')).toBe('Running\n=======\nBody');
    expect(extractSection('## **Running** ##\nBody\n## Done\nFinished', 'Running')).toBe('## **Running** ##\nBody');
    expect(() => extractSection('# Queue\nbody', 'Absent')).toThrow('Section not found');
  });

  it('preserves a body starting with a widget and uses the first duplicate heading', () => {
    expect(extractSection(wrapped('collapse'))).toContain('meta start');
    expect(extractSection('## Running\nfirst\n## Running\nsecond', 'Running')).toBe('## Running\nfirst');
  });

  it('ignores headings inside HTML comments and raw preformatted blocks', () => {
    const source = '<!--\n## Running\nnot a section\n-->\n<pre>\n## Running\nnot a section\n</pre>\n\n## Running\nReal job\n## Done\nFinished';
    expect(extractSection(source, 'Running')).toBe('## Running\nReal job');
  });

  it.each(['https://elsewhere/doc', '../secret', 'LM/../secret', 'LM/%2e%2e/file', 'LM/file?raw=1', 'LM\\file', '/LM/file', 'LM//file', 'LM/file#secret'])('refuses invalid source %s', id => {
    expect(() => liveSourceUrl(id)).toThrow('document id');
  });

  it('fetches only the raw endpoint with session credentials and cancellation', async () => {
    const fetch = vi.fn(async () => response('# Queue'));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect(await fetchLiveSource('LM/live/queue.md', signal)).toBe('# Queue');
    expect(fetch).toHaveBeenCalledWith('/docs/LM/live/queue.md', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
    fetch.mockResolvedValueOnce(response('secret', 403));
    await expect(fetchLiveSource('LM/private', signal)).rejects.toThrow('403');
  });

  it('validates and bounds intervals', () => {
    expect(liveInterval({})).toBe(60000);
    expect(liveInterval({ interval: 1 })).toBe(1000);
    expect(liveInterval({ interval: 999999 })).toBe(86400000);
    for (const interval of [0, -1, 'bad', Infinity]) expect(() => liveInterval({ interval })).toThrow();
  });
});

describe('live widget lifecycle', () => {
  it('refreshes only its body, retaining scroll, sibling nodes and disclosure state', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response('## Running\nFirst')).mockResolvedValueOnce(response('## Running\nSecond\n<script>bad()</script>'));
    vi.stubGlobal('fetch', fetch);
    const pane = document.createElement('div'); pane.id = 'content'; document.body.append(pane); pane.scrollTop = 123;
    const { root } = mountLive(); pane.append(root);
    const sibling = root.querySelector('details')!;
    await settle();
    sibling.open = true; sibling.dispatchEvent(new Event('toggle'));
    const button = root.querySelector<HTMLButtonElement>('.wd-live button')!;
    expect(root.querySelector('.wd-live')!.textContent).toContain('First');
    button.click(); await settle();
    expect(root.querySelector('.wd-live')!.textContent).toContain('Second');
    expect(root.querySelector('details')).toBe(sibling);
    expect(sibling.open).toBe(true);
    expect(pane.scrollTop).toBe(123);
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('.wd-live-status')!.textContent).toMatch(/^updated \d\d:\d\d$/);
    expect(fetch.mock.calls.every(([url]) => url === '/docs/LM/live/queue.md')).toBe(true);
  });

  it('keeps unchanged content and nested widget instances in place', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('## Running\n' + wrapped('collapse', 'Job', { title: 'Job' }))));
    const { root } = mountLive(); await settle();
    const body = root.querySelector('.wd-live > .wd-widget-content');
    const details = root.querySelector('.wd-live details');
    await vi.advanceTimersByTimeAsync(10000);
    expect(root.querySelector('.wd-live > .wd-widget-content')).toBe(body);
    expect(root.querySelector('.wd-live details')).toBe(details);
  });

  it('respects normal intervals longer than the error-backoff cap', async () => {
    const fetch = vi.fn(async () => response('## Running\nJob'));
    vi.stubGlobal('fetch', fetch);
    mountLive(7200); await settle();
    await vi.advanceTimersByTimeAsync(3600000); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3600000); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('pauses when hidden and resumes on visibilitychange', async () => {
    const fetch = vi.fn(async () => response('## Running\nJob'));
    vi.stubGlobal('fetch', fetch);
    mountLive(); await settle();
    hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetch).toHaveBeenCalledTimes(1);
    hidden = false; document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains fallback on network errors, backs off and resets after success', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline again')).mockResolvedValue(response('## Running\nRecovered'));
    vi.stubGlobal('fetch', fetch);
    const { root } = mountLive(); await settle();
    expect(root.textContent).toContain('Fallback');
    expect(root.textContent).toContain('backoff');
    await vi.advanceTimersByTimeAsync(19999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(39999); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(3);
    expect(root.textContent).toContain('Recovered');
    await vi.advanceTimersByTimeAsync(10000); expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([401, 403, 404])('clears previously fetched content after HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValueOnce(response('## Running\nPrivate job')).mockResolvedValueOnce(response('secret', status));
    vi.stubGlobal('fetch', fetch);
    const { root } = mountLive(); await settle();
    expect(root.textContent).toContain('Private job');
    root.querySelector<HTMLButtonElement>('.wd-live button')!.click(); await settle();
    expect(root.textContent).not.toContain('Private job');
    expect(root.textContent).not.toContain('secret');
    expect(root.textContent).toContain(String(status));
  });

  it('aborts an outstanding request and clears all timers on navigation', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const fetch = vi.fn((_url: string, _options: RequestInit) => new Promise<ReturnType<typeof response>>(r => { resolve = r; }));
    vi.stubGlobal('fetch', fetch);
    const harness = mountLive(); await settle();
    const signal = fetch.mock.calls[0][1].signal!;
    harness.destroy(); expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    resolve(response('## Running\nToo late')); await settle();
    expect(harness.root.textContent).not.toContain('Too late');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears fetched content on a session change and unsubscribes at teardown', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me'
      ? { ok: true, json: async () => ({ user: null, auth: { enabled: false } }) }
      : response('## Running\nPrivate job')));
    const harness = mountLive(); await settle();
    expect(harness.root.textContent).toContain('Private job');
    await loadAuth();
    expect(harness.root.textContent).not.toContain('Private job');
    expect(harness.root.textContent).toContain('Session changed');
    harness.destroy();
    await loadAuth();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a stalled request and backs off without losing fallback', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const { root } = mountLive(); await settle();
    await vi.advanceTimersByTimeAsync(30000);
    expect(root.textContent).toContain('timed out');
    expect(root.textContent).toContain('Fallback');
    expect(root.querySelector<HTMLButtonElement>('.wd-live button')!.disabled).toBe(false);
  });
});
