import { elem } from '../dom.js';
import { widgetDefinition, widgetDisplayName } from '../widgets.js';
import { createWidgetFields } from './widget-fields.js';
import { blockToMd, toMarkdownBlocks } from './serialize.js';
import { renderContent, teardownMounted } from '../reader.js';
import type { WidgetEditorBlock } from '../editor.js';

let nextPreview = 0;
export function widgetEditor(widget: WidgetEditorBlock, docId: string, children: HTMLElement) {
  const definition = widgetDefinition(String(widget.options.widget));
  const name = definition ? widgetDisplayName(definition) : String(widget.options.widget);
  const element = elem('div', { class: 'blk-widget', 'data-widget-type': String(widget.options.widget) });
  const preview = elem('div', { class: 'blk-widget-preview', 'aria-label': name + ' preview' });
  const settings = elem('section', { class: 'blk-widget-settings', hidden: true, 'aria-label': name + ' settings', id: 'widget-settings-' + (++nextPreview) });
  const edit = elem('button', { type: 'button', class: 'widget-edit-btn', 'aria-label': 'Edit ' + name, 'aria-controls': settings.id, 'aria-expanded': false }, '⚙ Edit');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  const path = 'editor-widget-' + nextPreview;
  const inline = definition?.editor?.inlineContent === true;
  function drawPreview() {
    if (destroyed) return;
    const pane = element.closest('.editor-canvas'), top = pane?.scrollTop;
    // Inline child editors own their own previews; detach before reader teardown.
    if (inline) element.append(children);
    teardownMounted(preview);
    preview.replaceChildren();
    try {
      const markdown = blockToMd({ type: 'widget', options: widget.options, blocks: inline ? [] : toMarkdownBlocks(widget.blocks) });
      const root = renderContent(markdown, docId, path, 0, true, docId + ':editor');
      preview.append(root);
      if (inline) {
        const content = root.querySelector<HTMLElement>('.wd-collapse > .wd-widget-content');
        if (content) content.append(children); else preview.append(children);
        const summary = root.querySelector<HTMLElement>('.wd-collapse-title');
        if (summary) {
          summary.contentEditable = 'true'; summary.setAttribute('aria-label', 'Section title');
          summary.addEventListener('input', () => { widget.options.title = summary.textContent; fields.refresh(); });
          summary.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); summary.blur(); } });
        }
      }
    } catch (error) { preview.append(elem('p', 'wd-widget-error', 'Preview: ' + (error instanceof Error ? error.message : String(error)))); }
    if (pane && top !== undefined) pane.scrollTop = top;
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(drawPreview, 180); };
  const fields = createWidgetFields(definition, widget.options, docId, schedule);
  const advanced = elem('details', 'widget-advanced');
  const raw = elem('textarea', { rows: 5, 'aria-label': 'Raw widget options', value: JSON.stringify(widget.options, null, 2) });
  raw.addEventListener('input', () => {
    try {
      const value: unknown = JSON.parse(raw.value);
      if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).widget !== widget.options.widget) throw new Error('Keep the widget type and enter a JSON object');
      Object.keys(widget.options).forEach(key => delete widget.options[key]); Object.assign(widget.options, value);
      raw.setCustomValidity(''); fields.setError('advanced'); fields.refresh(); schedule();
    } catch (error) { const text = error instanceof Error ? error.message : String(error); raw.setCustomValidity(text); fields.setError('advanced', text); }
  });
  advanced.addEventListener('toggle', () => { if (advanced.open && document.activeElement !== raw) raw.value = JSON.stringify(widget.options, null, 2); });
  advanced.append(elem('summary', undefined, 'Advanced'), elem('label', 'meta-field', 'Raw options (JSON)', raw));
  settings.append(fields.element);
  if (!inline) settings.append(elem('details', 'widget-fallback-editor', elem('summary', undefined, widget.options.widget === 'panel' ? 'Panel content' : 'Fallback content'), children));
  settings.append(advanced, elem('button', { type: 'button', class: 'btn', onClick: () => { if (fields.validate()) { settings.hidden = true; edit.setAttribute('aria-expanded', 'false'); drawPreview(); } } }, 'Done'));
  edit.addEventListener('click', () => { settings.hidden = !settings.hidden; edit.setAttribute('aria-expanded', String(!settings.hidden)); if (!settings.hidden) fields.refresh(); });
  children.addEventListener('input', () => { if (!inline) schedule(); });
  element.append(elem('div', 'widget-editor-heading', elem('span', { class: 'widget-type-icon', 'aria-hidden': true }, definition?.icon || '◇'), elem('strong', undefined, name), edit),
    elem('p', 'widget-editor-description', definition?.description || 'Load this widget’s plugin to edit its settings.'), preview, settings);
  drawPreview();
  return { element,
    validate() { const valid = fields.validate() && raw.checkValidity(); if (!valid) { settings.hidden = false; edit.setAttribute('aria-expanded', 'true'); if (!raw.checkValidity()) advanced.open = true; } return valid; },
    destroy() { if (destroyed) return; destroyed = true; clearTimeout(timer); fields.destroy(); if (inline) element.append(children); teardownMounted(preview); },
  };
}
