import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTableReader, parseCsv, parseJson, parseMarkdownTable, columnOptions, tableRows, renderTable, formattedCell, tableSource } from '/js/widgets/table-data.js';
import { widgetHarness, wrapped } from './widget-harness.js';
import { loadAuth } from '/js/auth.js';

const source = { kind: 'markdown' as const, src: 'LM/live/queue', section: 'Running' };
const markdown = '# Queue\n## Running\n| job | progress | status |\n|---|---|---|\n| second | 0.5 | running |\n| first | 0.25 | done |\n## Done\n| job |\n|---|\n| excluded |';
const csv = 'job,progress,status\r\nsecond,0.5,running\r\nfirst,0.25,done\r\n';
const json = '[{"job":"second","progress":0.5,"status":"running"},{"job":"first","progress":0.25,"status":"done"}]';
const destroy: (() => void)[] = [];
let hidden = false;
beforeEach(() => { vi.useFakeTimers(); hidden = false; vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden); });
afterEach(() => { destroy.splice(0).forEach(fn => fn()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('table source formats', () => {
  it('reads only the Markdown table in the named section', () => {
    const result = parseMarkdownTable(markdown, source);
    expect(result.columns).toEqual(['job', 'progress', 'status']);
    expect(result.rows).toHaveLength(2); expect(result.rows[0].job).toBe('second');
    expect(() => parseMarkdownTable('## Running\nNo table', source)).toThrow('No Markdown table');
  });
  it('preserves safe Markdown link labels and resolves relative document targets', () => {
    const result = parseMarkdownTable('## Running\n| plan |\n|---|\n| [Plan](../plans/a.md) |', source);
    expect(result.rows[0].plan).toEqual({ label: 'Plan', href: '#/LM/plans/a' });
  });
  it('parses CSV escaped quotes, commas, multiline cells, CRLF and BOM', () => {
    expect(parseCsv('\uFEFFjob,notes\r\n"a,b","line 1\nline ""2"""\r\n')).toEqual({ columns: ['job', 'notes'], rows: [{ job: 'a,b', notes: 'line 1\nline "2"' }] });
  });
  it.each(['a,a\n1,2', 'a,b\n"unclosed', 'a\n1,2', 'a\n"closed"bad'])('isolates malformed CSV: %s', raw => expect(() => parseCsv(raw)).toThrow());
  it('parses JSON arrays and configurable nested array keys, preserving first-seen columns', () => {
    expect(parseJson(json).rows).toHaveLength(2);
    expect(parseJson('{"data":{"jobs":[{"a":1},{"b":2,"a":3}]}}', 'data.jobs').columns).toEqual(['a', 'b']);
    expect(parseJson('[]')).toEqual({ columns: [], rows: [] });
  });
  it.each(['{}', '[1]', '[null]', 'bad JSON'])('rejects non-table JSON: %s', raw => expect(() => parseJson(raw)).toThrow());
  it('refuses missing/prototype keys and duplicate/invalid columns', () => {
    expect(() => parseJson('{"jobs":[]}', 'missing')).toThrow('array key');
    expect(() => parseJson('{}', '__proto__')).toThrow('array key');
    expect(() => columnOptions([{ key: 'job', label: 'Job', format: 'wrong' }])).toThrow('format');
    expect(() => columnOptions([{ key: 'job', label: 'Job', format: 'text' }, { key: 'job', label: 'Again', format: 'text' }])).toThrow('once');
  });
  it.each(['https://elsewhere/file.csv', 'LM/../file.csv', 'LM/%2e%2e/file.csv', 'LM\\file.csv', 'LM/a.csv?x=1'])('refuses an unsafe file source %s', src => expect(() => tableSource({ kind: 'csv', src })).toThrow());
  it('uses session credentials, conditional validators and reuses 304 data', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(csv, { headers: { ETag: '"csv1"' } })).mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetch); const reader = createTableReader(); const signal = new AbortController().signal;
    const value = { kind: 'csv', src: 'Docs/jobs.csv' };
    const data = await reader.read(value, signal); expect(await reader.read(value, signal)).toBe(data);
    expect(fetch.mock.calls[0]).toEqual(['/api/data/file?src=Docs%2Fjobs.csv', expect.objectContaining({ credentials: 'same-origin', redirect: 'error', signal })]);
    expect(fetch.mock.calls[1][1].headers).toEqual({ 'If-None-Match': '"csv1"' });
  });
});

describe('column formatting, sorting and filtering', () => {
  it('renames/reorders columns and applies sort, filter and maximum rows', () => {
    const columns = [{ key: 'status', label: 'State', format: 'status' as const }, { key: 'progress', label: 'Complete', format: 'percent' as const }];
    const table = renderTable(parseJson(json), { columns, sortBy: 'progress', sortDirection: 'asc', maxRows: 1 });
    expect([...table.querySelectorAll('th')].map(c => c.textContent)).toEqual(['State', 'Complete']);
    expect(table.textContent).toContain('25%'); expect(table.querySelector('.wd-status-good')?.textContent).toBe('done');
    expect(tableRows(parseJson(json), columns, { filter: 'RUNNING', maxRows: 100 })).toHaveLength(1);
  });
  it.each([['text', '<script>bad</script>', '<script>bad</script>'], ['number', '1234.5', '1,234.5'], ['percent', '0.25', '25%'], ['percent', '25%', '25%']] as const)('formats %s as safe text', (format, input, expected) => {
    expect(formattedCell(input, format).textContent).toBe(expected);
  });
  it('formats dates, refuses script links and accepts site/https links', () => {
    expect(formattedCell('2026-10-10T08:30:00Z', 'datetime').textContent).toContain('2026');
    expect(formattedCell('javascript:alert(1)', 'link')).not.toBeInstanceOf(HTMLAnchorElement);
    expect((formattedCell('Docs/overview', 'link') as HTMLAnchorElement).getAttribute('href')).toBe('#/Docs/overview');
    expect((formattedCell('https://example.test', 'link') as HTMLAnchorElement).rel).toBe('noopener noreferrer');
  });
  it('does not read inherited object properties and rejects invalid row limits/sorts', () => {
    const columns = [{ key: 'constructor', label: 'Constructor', format: 'text' as const }];
    expect(renderTable({ columns: ['constructor'], rows: [{}] }, { columns }).querySelector('td')?.textContent).toBe('');
    expect(() => tableRows(parseCsv(csv), columnOptions([], ['job']), { maxRows: 0 })).toThrow('Maximum rows');
    expect(() => tableRows(parseCsv(csv), columnOptions([], ['job']), { sortBy: 'absent' })).toThrow('displayed column');
  });
});

describe('auto-update table lifecycle', () => {
  const mount = (kind: 'markdown' | 'csv' | 'json') => {
    const harness = widgetHarness(wrapped('collapse', 'Sibling', { id: 'sibling', open: true }) + '\n' + wrapped('live-table', 'Fallback', {
      source: { kind, src: kind === 'markdown' ? source.src : 'Docs/jobs.' + kind, section: kind === 'markdown' ? 'Running' : undefined }, interval: 10,
    })); destroy.push(harness.destroy); return harness;
  };
  it.each(['markdown', 'csv', 'json'] as const)('updates %s in place, leaving siblings and unchanged data mounted', async kind => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(kind === 'markdown' ? markdown : kind === 'csv' ? csv : json, { headers: { ETag: '"v1"' } })).mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetch); const harness = mount(kind); await vi.advanceTimersByTimeAsync(0);
    const table = harness.root.querySelector('table')!; const sibling = harness.root.querySelector('details')!;
    expect(table.textContent).toContain('second'); expect(harness.root.textContent).toContain('updated');
    harness.root.querySelector<HTMLButtonElement>('.wd-live-table button')!.click(); await vi.advanceTimersByTimeAsync(0);
    expect(harness.root.querySelector('table')).toBe(table); expect(harness.root.querySelector('details')).toBe(sibling);
    expect(sibling.open).toBe(true);
  });
  it('pauses hidden requests, refreshes on return and backs off after errors', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('offline', { status: 500 })); vi.stubGlobal('fetch', fetch);
    const harness = mount('csv'); await vi.advanceTimersByTimeAsync(0); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000); expect(fetch).toHaveBeenCalledTimes(1);
    hidden = true; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(60000); expect(fetch).toHaveBeenCalledTimes(1);
    hidden = false; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); expect(fetch).toHaveBeenCalledTimes(2);
    expect(harness.root.textContent).toContain('backoff'); expect(harness.root.textContent).toContain('Fallback');
  });
  it('clears fetched rows on permission refusal and session changes', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(csv)).mockResolvedValueOnce(new Response('{}', { status: 403 })); vi.stubGlobal('fetch', fetch);
    const harness = mount('csv'); await vi.advanceTimersByTimeAsync(0); expect(harness.root.querySelector('table')).toBeTruthy();
    harness.root.querySelector<HTMLButtonElement>('.wd-live-table button')!.click(); await vi.advanceTimersByTimeAsync(0); expect(harness.root.querySelector('table')).toBeNull();
    fetch.mockResolvedValueOnce(new Response(csv)); harness.root.querySelector<HTMLButtonElement>('.wd-live-table button')!.click(); await vi.advanceTimersByTimeAsync(0);
    fetch.mockResolvedValueOnce(Response.json({ enabled: false })); await loadAuth(); expect(harness.root.querySelector('table')).toBeNull();
  });
  it('contains parse errors inline and stops requests after teardown', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('not-json')); vi.stubGlobal('fetch', fetch);
    const harness = mount('json'); await vi.advanceTimersByTimeAsync(0);
    expect(harness.root.querySelector('.wd-live-status')?.textContent).toContain('JSON');
    expect(harness.root.querySelector('details')).toBeTruthy(); harness.destroy();
    await vi.advanceTimersByTimeAsync(60000); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves pane and table scroll when changed data replaces only the table body', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(csv)).mockResolvedValueOnce(new Response(csv.replace('running', 'done'))); vi.stubGlobal('fetch', fetch);
    const harness = mount('csv');
    const pane = document.createElement('div'); pane.id = 'content'; document.body.append(pane); pane.append(harness.root);
    await vi.advanceTimersByTimeAsync(0); pane.scrollTop = 321; pane.scrollLeft = 12;
    const previous = harness.root.querySelector<HTMLElement>('.wd-table-data')!; previous.scrollTop = 45; previous.scrollLeft = 67;
    harness.root.querySelector<HTMLButtonElement>('.wd-live-table button')!.click(); await vi.advanceTimersByTimeAsync(0);
    const next = harness.root.querySelector<HTMLElement>('.wd-table-data')!;
    expect(next).not.toBe(previous); expect([pane.scrollTop, pane.scrollLeft, next.scrollTop, next.scrollLeft]).toEqual([321, 12, 45, 67]);
  });
  it('aborts a hanging request at its deadline without breaking the widget', async () => {
    const fetch = vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))); vi.stubGlobal('fetch', fetch);
    const harness = mount('csv'); await vi.advanceTimersByTimeAsync(30000);
    expect(harness.root.querySelector('.wd-live-status')?.textContent).toContain('timed out');
    expect(harness.root.querySelector<HTMLButtonElement>('.wd-live-table button')?.disabled).toBe(false);
  });
});
