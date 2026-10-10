import { registerWidget } from './registry.js';
import type { WidgetContext } from './registry.js';
import { renderMarkdown } from '../commonmark.js';
import { sanitizeToFragment } from '../sanitize.js';
import { onAuthChange } from '../auth.js';
import { htmlBlockKind, htmlBlockCloses } from '../md/patterns.js';

/** Document ids only: no URL, traversal, query, fragment or encoded path input. */
export function liveSourceUrl(id: string): string {
  const parts = id.replace(/\.md$/i, '').split('/');
  if (parts.length < 2 || parts.some(p => !p || p === '.' || p === '..' || /[\\%?#:\u0000-\u001f]/.test(p))) {
    throw new Error('Live source must be a document id such as LM/live/queue');
  }
  return '/docs/' + parts.map(encodeURIComponent).join('/') + '.md';
}

export class LiveFetchError extends Error {
  constructor(public readonly status: number) { super('Source unavailable (' + status + ')'); }
}

export async function fetchLiveSource(id: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(liveSourceUrl(id), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  if (!response.ok) throw new LiveFetchError(response.status);
  return response.text();
}

/** Preserve source Markdown while using the actual parser to recognise headings. */
export function extractSection(markdown: string, section?: string): string {
  // A page header is not a widget opener; keep body-only documents intact.
  const body = markdown.replace(/^\uFEFF?\s*<!--\s*meta\b(?!\s+(?:start|end)\b)[\s\S]*?-->\s*/i, '');
  if (!section) return body;
  const lines = body.split('\n');
  let fence: { char: string; length: number } | null = null;
  let html = 0;
  const headings: { index: number; level: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (html) {
      if ((html >= 6 && !lines[i].trim()) || htmlBlockCloses(html, lines[i])) html = 0;
      continue;
    }
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (f) {
      if (!fence) fence = { char: f[1][0], length: f[1].length };
      else if (f[1][0] === fence.char && f[1].length >= fence.length && !f[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const kind = htmlBlockKind(lines[i], true);
    if (kind) {
      if (!htmlBlockCloses(kind, lines[i])) html = kind;
      continue;
    }
    let candidate = lines[i];
    if (!/^ {0,3}#{1,6}(?:\s|$)/.test(candidate)) {
      if (!candidate.trim() || !/^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1] || '')) continue;
      candidate += '\n' + lines[i + 1];
    }
    const fragment = sanitizeToFragment(renderMarkdown(candidate));
    const heading = fragment.firstElementChild;
    if (heading && /^H[1-6]$/.test(heading.tagName)) headings.push({ index: i, level: +heading.tagName[1], title: heading.textContent.trim() });
  }
  const start = headings.findIndex(h => h.title === section);
  if (start < 0) throw new Error('Section not found: ' + section);
  const first = headings[start];
  const end = headings.slice(start + 1).find(h => h.level <= first.level)?.index ?? lines.length;
  return lines.slice(first.index, end).join('\n').trim();
}

export function liveInterval(options: Record<string, unknown>): number {
  const seconds = Number(options.interval ?? 60);
  if (!Number.isFinite(seconds) || seconds < 1) throw new Error('Live interval must be at least 1 second');
  return Math.min(seconds, 86400) * 1000;
}

const cleanups = new WeakMap<WidgetContext, () => void>();

registerWidget({
  name: 'live', label: 'Auto-update section',
  icon: '↻', description: 'Keep a document section current without reloading the page.',
  editor: { fields: [
    { name: 'src', label: 'Source document', type: 'document', default: '', required: true },
    { name: 'section', label: 'Section', type: 'section', documentField: 'src', default: '', hint: 'Leave empty to include the whole document.' },
    { name: 'interval', label: 'Refresh interval', type: 'interval', default: 60, min: 1, max: 86400 },
  ] },
  render(ctx) {
    liveSourceUrl(String(ctx.options.src || ''));
    liveInterval(ctx.options);
    const box = document.createElement('section');
    box.className = 'wd-live';
    const toolbar = document.createElement('div');
    toolbar.className = 'wd-live-toolbar';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Refresh';
    button.setAttribute('aria-label', 'Refresh ' + String(ctx.options.section || ctx.options.src));
    const status = document.createElement('span');
    status.className = 'wd-live-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Waiting for first update';
    toolbar.append(button, status);
    box.append(toolbar, ctx.content);
    return box;
  },
  mount(ctx) {
    const button = ctx.host.querySelector<HTMLButtonElement>(':scope > section > .wd-live-toolbar > button')!;
    const status = ctx.host.querySelector<HTMLElement>(':scope > section > .wd-live-toolbar > .wd-live-status')!;
    let content = ctx.content;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    let failures = 0;
    let previous: string | null = null;
    const interval = liveInterval(ctx.options);
    const schedule = () => {
      clearTimeout(timer);
      if (!ctx.signal.aborted && !document.hidden) timer = setTimeout(refresh, Math.min(interval * 2 ** Math.min(failures, 6), Math.max(interval, 3600000)));
    };
    const refresh = ctx.guard(async () => {
      if (ctx.signal.aborted || document.hidden || active) return;
      clearTimeout(timer);
      const request = new AbortController();
      let timedOut = false;
      requestTimer = setTimeout(() => { timedOut = true; request.abort(); }, 30000);
      active = request;
      button.disabled = true;
      status.textContent = 'Updating…';
      try {
        const raw = await fetchLiveSource(String(ctx.options.src), request.signal);
        if (ctx.signal.aborted || request.signal.aborted) return;
        const markdown = extractSection(raw, typeof ctx.options.section === 'string' ? ctx.options.section : undefined);
        if (markdown !== previous) {
          const pane = document.getElementById('content');
          const top = pane?.scrollTop;
          const left = pane?.scrollLeft;
          const next = ctx.renderContent(markdown, String(ctx.options.src).replace(/\.md$/i, ''));
          ctx.teardown(content);
          content.replaceWith(next);
          content = next;
          ctx.content = next;
          ctx.innerMarkdown = markdown;
          ctx.innerHTML = next.innerHTML;
          previous = markdown;
          if (pane && top !== undefined && left !== undefined) { pane.scrollTop = top; pane.scrollLeft = left; }
          await ctx.update();
        }
        failures = 0;
        status.textContent = 'updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      } catch (error) {
        if (ctx.signal.aborted || (request.signal.aborted && !timedOut)) return;
        failures++;
        // Never leave previously fetched content visible after access is refused.
        if (error instanceof LiveFetchError && [401, 403, 404].includes(error.status)) {
          ctx.teardown(content);
          content.replaceChildren();
          previous = null;
        }
        status.textContent = (timedOut ? 'Update timed out' : error instanceof Error ? error.message : 'Update failed') + ' · retrying with backoff';
      } finally {
        clearTimeout(requestTimer);
        active = null;
        button.disabled = false;
        schedule();
      }
    });
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) active?.abort();
      else refresh();
    };
    const unsubscribe = onAuthChange(() => {
      active?.abort();
      ctx.teardown(content);
      content.replaceChildren();
      previous = null;
      status.textContent = 'Session changed; waiting for update';
      schedule();
    });
    button.addEventListener('click', refresh);
    document.addEventListener('visibilitychange', visibility);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(requestTimer);
      active?.abort();
      button.removeEventListener('click', refresh);
      document.removeEventListener('visibilitychange', visibility);
      unsubscribe();
    };
    cleanups.set(ctx, cleanup);
    ctx.signal.addEventListener('abort', cleanup, { once: true });
    refresh();
  },
  destroy(ctx) { cleanups.get(ctx)?.(); cleanups.delete(ctx); },
});
