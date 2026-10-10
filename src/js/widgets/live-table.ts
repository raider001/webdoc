import { registerWidget } from './registry.js';
import type { WidgetContext } from './registry.js';
import { createTableReader, columnOptions, renderTable, tableSource } from './table-data.js';
import { liveInterval, LiveFetchError } from './live.js';
import { onAuthChange } from '../auth.js';

const cleanups = new WeakMap<WidgetContext, () => void>();
registerWidget({
  name: 'live-table', displayName: 'Auto-update table', icon: '▦',
  description: 'Show selected columns from a document table, CSV or JSON file.',
  editor: { fields: [
    { name: 'source', label: 'Data source', type: 'data-source', default: { kind: 'markdown', src: '', section: '' }, required: true,
      validate(value) { try { tableSource(value); return undefined; } catch (error) { return (error as Error).message; } } },
    { name: 'columns', label: 'Columns', type: 'columns', default: [], hint: 'Empty means all source columns. Pick, rename, reorder and format below.',
      dependsOn: ['source'], choices: async (options, signal) => (await createTableReader().read(options.source, signal)).columns,
      validate(value) { try { columnOptions(value); return undefined; } catch (error) { return (error as Error).message; } } },
    { name: 'sortBy', label: 'Default sort', type: 'select', default: '', choices: options => columnOptions(options.columns).map(c => c.key), hint: 'Choose columns first to sort; empty keeps source order.' },
    { name: 'sortDirection', label: 'Sort direction', type: 'select', default: 'asc', choices: ['asc', 'desc'] },
    { name: 'filter', label: 'Filter rows containing', type: 'text', default: '', hint: 'Case-insensitive text across displayed columns.' },
    { name: 'maxRows', label: 'Maximum rows', type: 'number', default: 100, min: 1, max: 10000, required: true,
      validate: value => Number.isInteger(Number(value)) ? undefined : 'Use a whole number of rows' },
    { name: 'interval', label: 'Refresh interval', type: 'interval', default: 60, min: 1, max: 86400 },
  ] },
  render(ctx) {
    tableSource(ctx.options.source); liveInterval(ctx.options);
    const box = document.createElement('section'); box.className = 'wd-live wd-live-table';
    const bar = document.createElement('div'); bar.className = 'wd-live-toolbar';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Refresh'; button.setAttribute('aria-label', 'Refresh table');
    const status = document.createElement('span'); status.className = 'wd-live-status'; status.setAttribute('role', 'status'); status.textContent = 'Waiting for table';
    bar.append(button, status); box.append(bar, ctx.content); return box;
  },
  mount(ctx) {
    const box = ctx.host.querySelector<HTMLElement>(':scope > .wd-live-table')!;
    const button = box.querySelector<HTMLButtonElement>('.wd-live-toolbar button')!;
    const status = box.querySelector<HTMLElement>('.wd-live-status')!;
    const reader = createTableReader();
    let content = ctx.content, fingerprint = '', failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | undefined;
    const interval = liveInterval(ctx.options);
    const schedule = () => { clearTimeout(timer); if (!ctx.signal.aborted && !document.hidden) timer = setTimeout(refresh, Math.min(interval * 2 ** Math.min(failures, 6), Math.max(interval, 3600000))); };
    const refresh = ctx.guard(async () => {
      if (active || document.hidden || ctx.signal.aborted) return;
      clearTimeout(timer); const request = new AbortController(); active = request;
      let timedOut = false;
      deadline = setTimeout(() => { timedOut = true; request.abort(); }, 30000);
      button.disabled = true; status.textContent = 'Updating…';
      try {
        const data = await reader.read(ctx.options.source, request.signal);
        if (request.signal.aborted || ctx.signal.aborted) return;
        const nextFingerprint = JSON.stringify([data, ctx.options.columns, ctx.options.sortBy, ctx.options.sortDirection, ctx.options.filter, ctx.options.maxRows]);
        if (nextFingerprint !== fingerprint) {
          const pane = ctx.host.closest('.editor-canvas') || document.getElementById('content');
          const top = pane?.scrollTop, left = pane?.scrollLeft, localTop = content.scrollTop, localLeft = content.scrollLeft;
          const next = renderTable(data, ctx.options);
          ctx.teardown(content); content.replaceWith(next); content = next; ctx.content = next; ctx.innerHTML = next.innerHTML;
          content.scrollTop = localTop; content.scrollLeft = localLeft;
          if (pane && top !== undefined && left !== undefined) { pane.scrollTop = top; pane.scrollLeft = left; }
          fingerprint = nextFingerprint; await ctx.update();
        }
        failures = 0; status.textContent = 'updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      } catch (error) {
        if (ctx.signal.aborted || (request.signal.aborted && !timedOut)) return;
        failures++;
        if (error instanceof LiveFetchError && [401, 403, 404].includes(error.status)) { ctx.teardown(content); content.replaceChildren(); reader.clear(); fingerprint = ''; }
        status.textContent = (timedOut ? 'Update timed out' : error instanceof Error ? error.message : 'Update failed') + ' · retrying with backoff';
      } finally { clearTimeout(deadline); active = undefined; button.disabled = false; schedule(); }
    });
    const visibility = () => { clearTimeout(timer); if (document.hidden) active?.abort(); else refresh(); };
    const unsubscribe = onAuthChange(() => { active?.abort(); ctx.teardown(content); content.replaceChildren(); fingerprint = ''; reader.clear(); status.textContent = 'Session changed; waiting for update'; schedule(); });
    const cleanup = () => { clearTimeout(timer); clearTimeout(deadline); active?.abort(); button.removeEventListener('click', refresh); document.removeEventListener('visibilitychange', visibility); unsubscribe(); };
    button.addEventListener('click', refresh); document.addEventListener('visibilitychange', visibility);
    cleanups.set(ctx, cleanup); ctx.signal.addEventListener('abort', cleanup, { once: true }); refresh();
  },
  destroy(ctx) { cleanups.get(ctx)?.(); cleanups.delete(ctx); },
});
