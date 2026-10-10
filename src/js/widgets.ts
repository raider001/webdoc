// Paired Markdown widgets share the existing optional renderer plugin loader.
import { scanMetaBlocks, replaceMetaBlocks } from './meta-blocks.js';
import { widgetDefinition } from './widgets/registry.js';
import { scrubRendered } from './blocks.js';
import './widgets/collapse.js';
import './widgets/live.js';
import './widgets/live-table.js';
import './widgets/panel.js';
export { registerWidget, registeredWidgets, widgetDefinition, widgetFields, widgetDisplayName } from './widgets/registry.js';
export type { WidgetContext, WidgetDefinition, WidgetField, WidgetEditorDefinition, WidgetEditorContext, CustomWidgetEditor } from './widgets/registry.js';
import type { WidgetContext } from './widgets/registry.js';

export interface WidgetBlockSpec {
  options: Record<string, unknown>;
  markdown: string;
  error?: string;
}

export interface WidgetServices {
  docId: string;
  pageId?: string;
  path: string;
  depth: number;
  renderContent: (markdown: string, docId: string, path: string, depth: number, complete?: boolean) => HTMLElement;
  register: (host: Element, destroy: () => void) => void;
  teardown: (root: Element) => void;
}

export function preprocessWidgets(markdown: string): string {
  return replaceMetaBlocks(markdown, scanMetaBlocks(markdown).filter(b => b.widget), block => {
    const spec: WidgetBlockSpec = { options: block.options, markdown: markdown.slice(block.innerStart, block.innerEnd), error: block.error };
    return '\n\n```wd-widget\n' + JSON.stringify(spec) + '\n```\n\n';
  });
}

export function renderWidgets(root: HTMLElement, services: WidgetServices): void {
  const codes = [...root.querySelectorAll('pre > code.language-wd-widget')];
  codes.forEach((code, index) => {
    const pre = code.parentElement;
    if (!pre) return;
    const host = document.createElement('div');
    host.className = 'wd-widget';
    pre.replaceWith(host);
    const abort = new AbortController();
    let context: WidgetContext | undefined;
    let destroyed = false;
    let failed = false;
    let definition: ReturnType<typeof widgetDefinition>;
    const reportError = (error: unknown) => {
      if (destroyed || failed) return;
      failed = true;
      abort.abort();
      if (context) services.teardown(context.content);
      services.teardown(host);
      const note = document.createElement('p');
      note.className = 'wd-widget-error';
      note.setAttribute('role', 'status');
      note.textContent = 'Widget could not be rendered: ' + (error instanceof Error ? error.message : String(error));
      host.replaceChildren(note);
    };
    services.register(host, () => {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      if (context) services.teardown(context.content);
      if (context && definition?.destroy) {
        try { Promise.resolve(definition.destroy(context)).catch(() => {}); } catch { /* isolated teardown */ }
      }
    });
    try {
      const spec: WidgetBlockSpec = JSON.parse(code.textContent || '{}');
      if (spec.error) throw new Error(spec.error);
      if (services.depth >= 16) throw new Error('Widget nesting limit (16) reached');
      definition = widgetDefinition(String(spec.options?.widget || ''));
      if (!definition) throw new Error('Unknown widget: ' + String(spec.options?.widget || '(unnamed)'));
      const key = services.path + '.' + index;
      host.dataset.widgetKey = key;
      const content = services.renderContent(spec.markdown || '', services.docId, key, services.depth + 1);
      context = {
        host, options: spec.options, innerMarkdown: spec.markdown, content, innerHTML: content.innerHTML,
        docId: services.docId, pageId: services.pageId || services.docId, key, depth: services.depth, signal: abort.signal,
        renderContent: (markdown, docId = services.docId) => services.renderContent(markdown, docId, key, services.depth + 1, true),
        teardown: services.teardown, reportError,
        guard: fn => (...args) => {
          if (destroyed || failed) return;
          try { Promise.resolve(fn(...args)).catch(reportError); } catch (error) { reportError(error); }
        },
        update: async options => {
          if (destroyed || failed || !context) return;
          if (options) context.options = options;
          try { await definition?.update?.(context); scrubRendered(host); } catch (error) { reportError(error); }
        },
      };
      const ctx = context;
      const mount = () => {
        queueMicrotask(() => {
          if (destroyed || failed || !host.isConnected) return;
          try { Promise.resolve(definition?.mount?.(ctx)).catch(reportError); } catch (error) { reportError(error); }
        });
      };
      const fill = (node: Node | void) => {
        if (destroyed || failed) return;
        if (node) host.append(node);
        scrubRendered(host);
        mount();
      };
      const result = definition.render(ctx);
      if (result && typeof (result as Promise<Node | void>).then === 'function') {
        Promise.resolve(result).then(fill).catch(reportError);
      } else fill(result as Node | void);
    } catch (error) { reportError(error); }
  });
}
