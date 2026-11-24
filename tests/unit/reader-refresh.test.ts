import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { app, state } from '/js/app-shell.js';
import { renderDoc, registerMounted, teardownMounted } from '/js/reader.js';
import { loadDoc, type Doc } from '/js/catalog.js';
import { refreshReadingDocument } from '/js/reader-refresh.js';
import { createIndexWatcher } from '/js/index-watch.js';
import { wrapped } from './widget-harness.js';

const source = (timestamp = '12:00', row = 'one') => `# Queue\n\nRebuilt ${timestamp}\n\n## Running\n\nRead this paragraph.\n\n` + wrapped('collapse', wrapped('live-table', `| Job |\n|---|\n| ${row} |`, { source: { kind: 'markdown', src: 'LM/live/queue', section: 'Running' }, interval: 60 }), { title: 'Jobs', open: false, id: 'jobs' }) + '\n\n## Later\n\nStill reading here.';
let doc: Doc;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<main id="content" tabindex="-1"></main><nav id="tocList"></nav><div id="footPrev"></div><div id="footNext"></div><div id="toc"></div>';
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('# Running\n\n| Job |\n|---|\n| fetched |')));
  app.registerMounted = registerMounted;
  doc = { id: 'LM/live/queue', name: 'queue.md', source: 'LM', rel: 'live/queue.md', url: '/docs/LM/live/queue.md', title: 'Queue', body: source(), assumes: [], next: [] };
  state.current = doc; renderDoc(doc);
});
afterEach(() => { teardownMounted(document.body); document.body.replaceChildren(); state.current = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('tears down an article host exactly once across two navigations and leaves an outside host alive', () => {
  const inside = document.createElement('span'), outside = document.createElement('span');
  document.querySelector('#content .doc')!.appendChild(inside);
  document.body.appendChild(outside);
  const torn: string[] = [];
  registerMounted(inside, () => torn.push('inside'));
  registerMounted(outside, () => torn.push('outside'));
  for (const title of ['Verification', 'Requirements']) {
    const next = { ...doc, id: 'LM/' + title, body: '# ' + title };
    state.current = next;
    renderDoc(next);
  }
  expect(torn).toEqual(['inside']);
  expect(outside.isConnected).toBe(true);
});

it('preserves the reading offset and widget identity through a generated timestamp rewrite', () => {
  const pane = document.getElementById('content')!, widget = pane.querySelector('.wd-live-table'), details = pane.querySelector('details')!;
  details.open = true; pane.scrollTop = 480;
  doc.body = source('12:02'); renderDoc(doc, { preserveReading: true });
  expect(pane.scrollTop).toBe(480); expect(pane.querySelector('.wd-live-table')).toBe(widget); expect(pane.querySelector('details')?.open).toBe(true);
});
it('does not replace the article for fallback-only or identical rendered-output rewrites', () => {
  const pane = document.getElementById('content')!, article = pane.firstElementChild; pane.scrollTop = 480;
  doc.body = source('12:00', 'changed fallback'); renderDoc(doc, { preserveReading: true });
  expect(pane.firstElementChild).toBe(article); expect(pane.scrollTop).toBe(480);
  doc.body += '\n\n'; renderDoc(doc, { preserveReading: true }); expect(pane.firstElementChild).toBe(article);
});

it('anchors the same heading at the same viewport offset when content above it grows', () => {
  const pane = document.getElementById('content')!; pane.scrollTop = 480;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.id === 'later' ? 490 + (this.closest('article')?.textContent?.includes('Added above') ? 120 : 0) - pane.scrollTop : 10;
    return { top, bottom: top + (this.id === 'later' ? 20 : 0), height: this.id === 'later' ? 20 : 0, left: 0, right: 700, width: 700, x: 0, y: top, toJSON() {} };
  });
  const oldOffset = pane.querySelector('#later')!.getBoundingClientRect().top;
  doc.body = source('12:02').replace('## Later', 'Added above\n\n## Later'); renderDoc(doc, { preserveReading: true });
  expect(pane.scrollTop).toBe(600); expect(pane.querySelector('#later')!.getBoundingClientRect().top).toBe(oldOffset);
});

it('keeps live-table state, focus, text selection and the TOC highlight through a real fetch rewrite', async () => {
  const pane = document.getElementById('content')!;
  await vi.waitFor(() => expect(pane.querySelector('.wd-live-status')?.textContent).toMatch(/^updated /));
  const live = pane.querySelector<HTMLElement>('.wd-live-table')!, status = live.querySelector('.wd-live-status')!.textContent;
  const button = live.querySelector<HTMLButtonElement>('button')!; button.focus(); live.scrollLeft = 36;
  pane.querySelector('details')!.open = true; pane.scrollTop = 510;
  const text = [...pane.querySelectorAll('p')].find(node => node.textContent === 'Read this paragraph.')!.firstChild!;
  window.getSelection()!.setBaseAndExtent(text, 5, text, 9);
  document.getElementById('tocList')!.innerHTML = '<a class="active" data-target="later">Later</a>';
  doc._loaded = true; doc._etag = '"before"';
  vi.mocked(fetch).mockResolvedValueOnce(new Response(source('12:02', 'new fallback'), { headers: { ETag: '"after"' } }));
  await refreshReadingDocument(doc, () => state.current === doc);
  expect(pane.scrollTop).toBe(510); expect(pane.querySelector('.wd-live-table')).toBe(live);
  expect(live.scrollLeft).toBe(36); expect(live.querySelector('.wd-live-status')!.textContent).toBe(status);
  expect(document.activeElement).toBe(button); expect(window.getSelection()!.toString()).toBe('this');
  expect(document.querySelector('#tocList a.active')?.getAttribute('data-target')).toBe('later');
  expect(pane.querySelector('details')?.open).toBe(true); expect(doc._etag).toBe('"after"');
});

it('does not redraw or reset the pane for unrelated index changes and a current-document 304', async () => {
  const pane = document.getElementById('content')!, article = pane.firstElementChild; pane.scrollTop = 470;
  doc._loaded = true; doc._etag = '"unchanged"';
  const watcher = createIndexWatcher(() => refreshReadingDocument(doc, () => state.current === doc));
  await watcher.observe({ state: 'ready', generation: 1 });
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 304 }));
  await watcher.observe({ state: 'ready', generation: 2 });
  expect(pane.firstElementChild).toBe(article); expect(pane.scrollTop).toBe(470);
  expect(fetch).toHaveBeenCalledWith(doc.url, expect.objectContaining({ headers: { 'If-None-Match': '"unchanged"' } }));
});

it('ignores an obsolete fetch after navigation and still resets scroll for explicit navigation', async () => {
  const pane = document.getElementById('content')!, article = pane.firstElementChild; pane.scrollTop = 450;
  vi.mocked(fetch).mockResolvedValueOnce(new Response(source('12:04')));
  await refreshReadingDocument(doc, () => false); expect(pane.firstElementChild).toBe(article); expect(pane.scrollTop).toBe(450);
  renderDoc(doc); expect(pane.scrollTop).toBe(0); expect(document.activeElement).toBe(pane);
});

it('does not accumulate numbering inside retained collapsibles', () => {
  doc.body = source() + '\n' + wrapped('collapse', '## Nested\n\nText', { title: 'Nested', id: 'nested' }); renderDoc(doc);
  doc.body = doc.body.replace('12:00', '12:02'); renderDoc(doc, { preserveReading: true });
  doc.body = doc.body.replace('12:02', '12:04'); renderDoc(doc, { preserveReading: true });
  expect(document.querySelector('#nested')?.querySelectorAll('.secnum')).toHaveLength(1);
  expect(document.querySelector('#nested')?.textContent).toMatch(/Nested$/);
});

it('skips the watcher redraw for a fetched fallback-only rewrite and an equivalent heading syntax', async () => {
  const pane = document.getElementById('content')!, article = pane.firstElementChild; pane.scrollTop = 420;
  doc._loaded = true; doc._etag = '"before"';
  vi.mocked(fetch).mockResolvedValueOnce(new Response(source('12:00', 'updated row'), { headers: { ETag: '"fallback"' } }));
  await refreshReadingDocument(doc, () => state.current === doc);
  expect(pane.firstElementChild).toBe(article); expect(pane.scrollTop).toBe(420); expect(doc.body).toContain('updated row');
  vi.mocked(fetch).mockResolvedValueOnce(new Response(source('12:00', 'updated row').replace('# Queue', 'Queue\n=====')));
  await refreshReadingDocument(doc, () => state.current === doc); expect(pane.firstElementChild).toBe(article); expect(pane.scrollTop).toBe(420);
});

it('restores a changed collapsible before its mount, despite stale persisted defaults, and keeps its nested table', async () => {
  await Promise.resolve();
  const pane = document.getElementById('content')!, table = pane.querySelector('.wd-live-table');
  pane.querySelector('details')!.open = true; localStorage.setItem('wd-widget:LM/live/queue:jobs', 'false');
  doc.body = doc.body!.replace('"title":"Jobs"', '"title":"Updated jobs"');
  renderDoc(doc, { preserveReading: true }); await Promise.resolve();
  expect(pane.querySelector('details')?.open).toBe(true); expect(pane.querySelector('.wd-live-table')).toBe(table);
});

it('remounts a widget when its source options change instead of retaining data for the old source', () => {
  const pane = document.getElementById('content')!, table = pane.querySelector('.wd-live-table');
  doc.body = doc.body!.replace('LM/live/queue', 'LM/live/other'); renderDoc(doc, { preserveReading: true });
  expect(pane.querySelector('.wd-live-table')).not.toBe(table);
});

it('leaves focus outside the article alone during a background update', () => {
  const search = document.createElement('input'); document.body.append(search); search.focus();
  doc.body = source('12:04'); renderDoc(doc, { preserveReading: true }); expect(document.activeElement).toBe(search);
});

it('isolates malformed low-level widget specifications inline', () => {
  doc.body = '# Queue\n\n```wd-widget\n{"options":{},"markdown":42}\n```';
  expect(() => renderDoc(doc)).not.toThrow(); expect(document.querySelector('.wd-widget-error')?.textContent).toContain('Invalid widget specification');
});
