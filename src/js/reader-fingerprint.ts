import { renderMarkdown } from './commonmark.js';
import { sanitizeToFragment } from './sanitize.js';
import { preprocessRequirements } from './requirements.js';
import { scanMetaBlocks, replaceMetaBlocks } from './meta-blocks.js';
import type { Doc } from './catalog.js';

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  return value;
}
export function widgetFingerprint(spec: { options: Record<string, unknown>; markdown: string; error?: string }, docId: string, depth = 0): string {
  const live = !spec.error && ['live', 'live-table'].includes(String(spec.options.widget));
  // Extensions may interpret raw Markdown as data; be conservative for them.
  const container = ['collapse', 'panel'].includes(String(spec.options.widget));
  return JSON.stringify([ordered(spec.options), spec.error || '', live ? '' : container && depth < 16 ? contentFingerprint(spec.markdown, docId, depth + 1) : spec.markdown]);
}
/** Pure, inert comparison: never mounts a component or starts a widget fetch. */
export function contentFingerprint(markdown: string, docId: string, depth = 0): string {
  const body = replaceMetaBlocks(markdown, scanMetaBlocks(markdown).filter(block => block.widget), block => {
    const spec = { options: block.options, markdown: markdown.slice(block.innerStart, block.innerEnd), error: block.error };
    return '\n\n```wd-widget\n' + widgetFingerprint(spec, docId, depth) + '\n```\n\n';
  });
  const root = document.createElement('div');
  root.append(sanitizeToFragment(renderMarkdown(preprocessRequirements(body, docId))));
  const comments = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT); const remove: Node[] = [];
  while (comments.nextNode()) remove.push(comments.currentNode);
  remove.forEach(node => node.parentNode?.removeChild(node));
  return root.innerHTML.trim();
}
export function documentFingerprint(doc: Doc): string {
  return JSON.stringify([doc.id, doc.title, doc.description || '', doc.assumes || [], doc.next || [], contentFingerprint(doc.body || '', doc.id)]);
}
