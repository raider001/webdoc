import { renderMarkdown } from '/js/commonmark.js';
import { sanitizeToFragment } from '/js/sanitize.js';
import { preprocessWidgets, renderWidgets } from '/js/widgets.js';
import type { WidgetServices } from '/js/widgets.js';

export function widgetHarness(markdown: string, docId = 'Docs/example') {
  const mounted = new Map<Element, () => void>();
  const teardown = (root: Element) => {
    for (const [host, destroy] of mounted) {
      if (!root.contains(host)) continue;
      mounted.delete(host);
      destroy();
    }
  };
  const renderContent: WidgetServices['renderContent'] = (source, id, path, depth) => {
    const root = document.createElement('div');
    root.className = 'wd-widget-content';
    root.append(sanitizeToFragment(renderMarkdown(preprocessWidgets(source))));
    renderWidgets(root, { docId: id, path, depth, renderContent, register: (host, destroy) => mounted.set(host, destroy), teardown });
    return root;
  };
  const root = renderContent(markdown, docId, 'page', 0);
  document.body.append(root);
  return { root, mounted, destroy: () => { teardown(root); root.remove(); } };
}

export function wrapped(widget: string, body = 'Fallback', options: Record<string, unknown> = {}): string {
  return '<!--meta start ' + JSON.stringify({ widget, ...options }) + '-->\n' + body + '\n<!--meta end ' + JSON.stringify({ widget }) + '-->';
}
