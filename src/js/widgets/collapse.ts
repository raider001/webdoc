import { registerWidget } from './registry.js';
import type { WidgetContext } from './registry.js';

const cleanups = new WeakMap<WidgetContext, () => void>();

registerWidget({
  name: 'collapse',
  label: 'Collapsible section',
  icon: '▾', description: 'Fold a titled section; edit its Markdown inline.',
  editor: { inlineContent: true, fields: [
    { name: 'title', label: 'Title', type: 'text', default: 'Collapsible section' },
    { name: 'open', label: 'Open by default', type: 'boolean', default: false },
  ] },
  render(ctx) {
    const details = document.createElement('details');
    details.className = 'wd-collapse';
    details.open = ctx.options.open === true;
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.className = 'wd-collapse-title';
    title.textContent = String(ctx.options.title || 'Collapsible section');
    summary.append(title);
    details.append(summary, ctx.content);
    return details;
  },
  mount(ctx) {
    const details = ctx.host.querySelector<HTMLDetailsElement>(':scope > details')!;
    const key = 'wd-widget:' + ctx.pageId + ':' + String(ctx.options.id || ctx.key);
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) details.open = saved === 'true';
    } catch { /* blocked storage still leaves an accessible disclosure */ }
    let printing = false;
    let wasOpen = details.open;
    const toggle = () => {
      if (printing) return;
      try { localStorage.setItem(key, String(details.open)); } catch { /* optional persistence */ }
    };
    const beforePrint = () => { if (printing) return; printing = true; wasOpen = details.open; details.open = true; };
    const afterPrint = () => { details.open = wasOpen; setTimeout(() => { printing = false; }, 0); };
    details.addEventListener('toggle', toggle);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    cleanups.set(ctx, () => {
      details.removeEventListener('toggle', toggle);
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
    });
  },
  destroy(ctx) { cleanups.get(ctx)?.(); cleanups.delete(ctx); },
});
