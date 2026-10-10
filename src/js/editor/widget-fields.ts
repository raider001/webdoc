import { elem } from '../dom.js';
import { widgetFields } from '../widgets/registry.js';
import type { WidgetDefinition, WidgetField, CustomWidgetEditor } from '../widgets/registry.js';
import { COLUMN_FORMATS, columnOptions, tableSource } from '../widgets/table-data.js';
import type { TableColumn } from '../widgets/table-data.js';
import { fetchLiveSource, extractSection, liveSourceUrl } from '../widgets/live.js';
import { renderMarkdown } from '../commonmark.js';
import { sanitizeToFragment } from '../sanitize.js';

interface Control { element: HTMLElement; refresh: () => void; destroy?: () => void; invalid?: () => string; }
let nextFieldId = 0;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function validateWidgetField(field: WidgetField, value: unknown, options: Record<string, unknown>): string {
  try { if (field.visibleWhen && !field.visibleWhen(options)) return ''; } catch (error) { return message(error); }
  if (field.required && (value === undefined || value === null || value === '')) return 'This field is required';
  if (field.type === 'interval' && (value === undefined || value === '')) return 'Enter a refresh interval in seconds';
  if ((field.type === 'number' || field.type === 'interval') && value !== undefined && value !== '') {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Enter a number';
    const min = field.min ?? (field.type === 'interval' ? 1 : undefined), max = field.max ?? (field.type === 'interval' ? 86400 : undefined);
    if (min !== undefined && number < min) return 'Minimum is ' + min;
    if (max !== undefined && number > max) return 'Maximum is ' + max;
  }
  try {
    if (field.type === 'document' && value) liveSourceUrl(String(value));
    if (field.type === 'data-source') tableSource(value);
    if (field.type === 'columns') columnOptions(value);
    if (field.type === 'boolean' && value !== undefined && typeof value !== 'boolean') return 'Choose true or false';
    if ((field.type === 'text' || field.type === 'section') && value !== undefined && typeof value !== 'string') return 'Enter text';
    return field.validate?.(value, options) || '';
  } catch (error) { return message(error); }
}

/** Inline tree browser; all entries come from the same reader-filtered APIs. */
export function documentPicker(label: string, getValue: () => string, signal: AbortSignal, change: (value: string) => void, error: (value: string) => void, format?: 'csv' | 'json'): Control {
  const input = elem('input', { type: 'text', 'aria-label': label, value: getValue(), placeholder: format ? 'Source/path.' + format : 'Source/document' });
  const browse = elem('button', { type: 'button', 'aria-label': 'Browse ' + label }, 'Browse…');
  const listing = elem('div', { class: 'widget-picker-tree', hidden: true });
  let active: AbortController | undefined, sequence = 0;
  const load = async (path: string) => {
    active?.abort(); active = new AbortController(); const request = active, seq = ++sequence;
    listing.hidden = false; listing.replaceChildren(elem('p', undefined, 'Loading…'));
    try {
      const url = format ? '/api/data/tree?format=' + format + '&path=' + encodeURIComponent(path) : '/api/index/tree?path=' + encodeURIComponent(path);
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: request.signal });
      if (!response.ok) throw new Error('Cannot browse source (' + response.status + ')');
      const data = await response.json() as { folders: string[]; docs?: { id: string; title: string; locked?: boolean }[]; files?: { id: string; title: string }[] };
      if (signal.aborted || request.signal.aborted || seq !== sequence) return;
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      listing.replaceChildren(elem('div', 'widget-picker-path', elem('strong', undefined, path || 'Site sources'),
        ...(path ? [elem('button', { type: 'button', onClick: () => void load(parent) }, '↑ Up')] : [])));
      for (const folder of [...new Set(data.folders)]) listing.append(elem('button', { type: 'button', class: 'widget-picker-folder', onClick: () => void load(path ? path + '/' + folder : folder) }, '▸ ' + folder));
      for (const doc of data.docs || data.files || []) listing.append(elem('button', { type: 'button', disabled: 'locked' in doc && doc.locked === true, onClick: () => { input.value = doc.id; change(doc.id); error(''); listing.hidden = true; } }, doc.title || doc.id));
      if (!data.folders.length && !(data.docs || data.files || []).length) listing.append(elem('p', undefined, 'No readable sources here'));
    } catch (failure) { if (!request.signal.aborted && !signal.aborted) { listing.replaceChildren(elem('p', 'widget-field-error', message(failure))); error(message(failure)); } }
  };
  input.addEventListener('input', () => { change(input.value.trim()); error(''); });
  browse.addEventListener('click', () => { if (!listing.hidden) listing.hidden = true; else void load(''); });
  const cleanup = () => { active?.abort(); };
  signal.addEventListener('abort', cleanup, { once: true });
  return { element: elem('div', 'widget-document-picker', input, browse, listing), refresh: () => { if (document.activeElement !== input) input.value = getValue(); }, destroy: cleanup };
}

function sectionPicker(getDocument: () => string, getValue: () => string, signal: AbortSignal, change: (value: string) => void, error: (value: string) => void): Control {
  const select = elem('select', { 'aria-label': 'Section' });
  let previous = '', active: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let titles: string[] = [], loaded = false;
  const draw = () => {
    const current = getValue();
    select.replaceChildren(elem('option', { value: '' }, 'Whole document'));
    for (const title of [...new Set([...titles, ...(current && !titles.includes(current) ? [current] : [])])]) select.append(elem('option', { value: title }, title));
    select.value = current; select.disabled = !getDocument();
    if (loaded && current && !titles.includes(current)) error('Section not found in the chosen document');
  };
  const refresh = () => {
    const source = getDocument(); draw();
    if (source === previous) return;
    previous = source; loaded = false; titles = []; active?.abort(); clearTimeout(timer);
    if (!source) { draw(); return; }
    timer = setTimeout(async () => {
      active = new AbortController(); const request = active;
      try {
        const raw = await fetchLiveSource(source, request.signal);
        if (signal.aborted || request.signal.aborted || source !== getDocument()) return;
        const body = sanitizeToFragment(renderMarkdown(extractSection(raw)));
        titles = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.textContent.trim());
        loaded = true; error(''); draw();
      } catch (failure) { if (!request.signal.aborted && !signal.aborted) error(message(failure)); }
    }, 250);
  };
  select.addEventListener('change', () => { change(select.value); error(''); draw(); });
  const cleanup = () => { active?.abort(); clearTimeout(timer); };
  signal.addEventListener('abort', cleanup, { once: true }); refresh();
  return { element: select, refresh, destroy: cleanup, invalid: () => loaded && getValue() && !titles.includes(getValue()) ? 'Section not found in the chosen document' : '' };
}

export function createWidgetFields(definition: WidgetDefinition | undefined, options: Record<string, unknown>, docId: string, onChange: () => void) {
  const abort = new AbortController();
  const element = elem('div', 'blk-widget-fields');
  const schema = widgetFields(definition);
  const controls: { field: WidgetField; control: Control; root: HTMLElement; input?: HTMLInputElement | HTMLSelectElement; error: HTMLElement; external: string }[] = [];
  const globalErrors = new Map<string, string>();
  let custom: CustomWidgetEditor | undefined;
  let refreshing = false;
  const setError = (name: string, text = '') => {
    const item = controls.find(c => c.field.name === name);
    if (item) { item.external = text; check(item); }
    else { if (text) globalErrors.set(name, text); else globalErrors.delete(name); globalNote.textContent = [...globalErrors.values()].join(' · '); }
  };
  const globalNote = elem('p', { class: 'widget-field-error', role: 'status' });
  function changed(field: WidgetField, value: unknown) { options[field.name] = value; setError(field.name); refresh(); onChange(); }
  function check(item: typeof controls[number]): boolean {
    try { item.root.hidden = !!item.field.visibleWhen && !item.field.visibleWhen(options); }
    catch (failure) { item.root.hidden = false; item.external = message(failure); }
    const text = item.root.hidden ? '' : item.external || item.control.invalid?.() || validateWidgetField(item.field, options[item.field.name] ?? item.field.default, options);
    item.error.textContent = text;
    item.root.dataset.invalid = String(!!text);
    item.input?.setCustomValidity(text);
    item.input?.setAttribute('aria-invalid', String(!!text));
    return !text;
  }
  function refresh() {
    if (refreshing || abort.signal.aborted) return;
    refreshing = true;
    try { for (const item of controls) { item.control.refresh(); check(item); } } finally { refreshing = false; }
  }
  for (const field of schema) {
    const value = () => options[field.name] ?? field.default;
    const error = elem('span', { class: 'widget-field-error', role: 'status', id: 'widget-error-' + (++nextFieldId) });
    const root = elem('div', { class: 'widget-field', 'data-field': field.name });
    const report = (text: string) => setError(field.name, text);
    let control: Control;
    if (field.type === 'document') control = documentPicker(field.label, () => String(value() || ''), abort.signal, text => changed(field, text), report);
    else if (field.type === 'section') control = sectionPicker(() => String(options[field.documentField || 'src'] || ''), () => String(value() || ''), abort.signal, text => changed(field, text), report);
    else if (field.type === 'data-source') {
      const sourceRoot = elem('div', 'widget-data-source');
      const kind = elem('select', { 'aria-label': 'Source format' }, ['markdown', 'csv', 'json'].map(k => elem('option', { value: k }, k === 'markdown' ? 'Markdown table' : k.toUpperCase() + ' file')));
      const details = elem('div', 'widget-source-settings');
      let renderedKind = '', nested: Control[] = [];
      const get = () => (value() && typeof value() === 'object' ? value() : { kind: 'markdown', src: '' }) as Record<string, unknown>;
      const patch = (changes: Record<string, unknown>) => changed(field, { ...get(), ...changes });
      const sourceRefresh = () => {
        const current = get(); kind.value = String(current.kind || 'markdown');
        if (kind.value !== renderedKind) {
          nested.forEach(c => c.destroy?.()); nested = []; renderedKind = kind.value; details.replaceChildren();
          const picker = documentPicker(kind.value === 'markdown' ? 'Source document' : 'Data file', () => String(get().src || ''), abort.signal, src => patch({ src, section: '' }), report, kind.value === 'markdown' ? undefined : kind.value as 'csv' | 'json');
          nested.push(picker); details.append(picker.element);
          if (kind.value === 'markdown') {
            const section = sectionPicker(() => String(get().src || ''), () => String(get().section || ''), abort.signal, section => patch({ section }), report);
            nested.push(section); details.append(elem('label', 'meta-field', 'Section', section.element));
          } else if (kind.value === 'json') {
            const key = elem('input', { 'aria-label': 'JSON array key', value: String(get().key || ''), placeholder: 'Empty for an array; e.g. jobs or data.jobs' });
            key.addEventListener('input', () => patch({ key: key.value }));
            details.append(elem('label', 'meta-field', 'JSON array key', key));
            nested.push({ element: key, refresh: () => { if (document.activeElement !== key) key.value = String(get().key || ''); } });
          }
        }
        nested.forEach(c => c.refresh());
      };
      kind.addEventListener('change', () => patch({ kind: kind.value, src: '', section: '', key: '' }));
      sourceRoot.append(elem('label', 'meta-field', 'Source format', kind), details);
      control = { element: sourceRoot, refresh: sourceRefresh, destroy: () => nested.forEach(c => c.destroy?.()), invalid: () => nested.map(c => c.invalid?.()).find(Boolean) || '' };
    } else if (field.type === 'columns') {
      const rows = elem('div', 'widget-column-rows');
      const add = elem('button', { type: 'button' }, '+ Add column');
      const discover = elem('button', { type: 'button' }, 'Use source columns');
      let available: string[] = [], signature = '', model = '', sequence = 0, active: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      // Preserve temporarily invalid edits so the author can correct them.
      const columns = (): TableColumn[] => Array.isArray(value()) ? (value() as TableColumn[]).filter(c => c && typeof c === 'object') : [];
      const draw = () => {
        rows.replaceChildren();
        let current; try { current = columns(); } catch { return; }
        current.forEach((column, index) => {
          const keys = [...new Set([...available, column.key])];
          const key = elem('select', { 'aria-label': 'Column ' + (index + 1) + ' source' }, keys.map(k => elem('option', { value: k }, k)));
          key.value = column.key;
          const label = elem('input', { 'aria-label': 'Column ' + (index + 1) + ' label', value: column.label });
          const format = elem('select', { 'aria-label': 'Column ' + (index + 1) + ' format' }, COLUMN_FORMATS.map(f => elem('option', { value: f }, f === 'datetime' ? 'date/time' : f === 'status' ? 'status badge' : f)));
          format.value = column.format;
          const commit = (patch: Record<string, unknown>) => { const next = structuredClone(columns()); Object.assign(next[index], patch); changed(field, next); };
          key.addEventListener('change', () => commit({ key: key.value })); label.addEventListener('input', () => { model = ''; commit({ label: label.value }); });
          label.addEventListener('blur', () => refresh());
          format.addEventListener('change', () => commit({ format: format.value }));
          const move = (direction: number) => { const next = structuredClone(columns()); [next[index], next[index + direction]] = [next[index + direction], next[index]]; changed(field, next); };
          rows.append(elem('div', 'widget-column-row', key, label, format,
            elem('button', { type: 'button', disabled: index === 0, 'aria-label': 'Move column ' + (index + 1) + ' up', onClick: () => move(-1) }, '↑'),
            elem('button', { type: 'button', disabled: index === current.length - 1, 'aria-label': 'Move column ' + (index + 1) + ' down', onClick: () => move(1) }, '↓'),
            elem('button', { type: 'button', 'aria-label': 'Remove column ' + (index + 1), onClick: () => changed(field, columns().filter((_, i) => i !== index)) }, '×')));
        });
        if (!current.length) rows.append(elem('p', 'widget-field-hint', 'All source columns, using text format'));
      };
      const refreshColumns = () => {
        const nextModel = JSON.stringify(value());
        if (model !== nextModel && !(rows.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement)) { model = nextModel; draw(); }
        const nextSignature = JSON.stringify(typeof field.choices !== 'function' ? field.choices : field.dependsOn ? field.dependsOn.map(key => options[key]) : options);
        if (signature === nextSignature) return;
        signature = nextSignature; clearTimeout(timer); active?.abort();
        if (typeof field.choices !== 'function') { available = [...(field.choices || [])]; draw(); return; }
        timer = setTimeout(async () => {
          const seq = ++sequence; active = new AbortController(); const request = active;
          try {
            available = [...await (field.choices as Exclude<WidgetField['choices'], readonly string[] | undefined>)(options, request.signal)];
            if (abort.signal.aborted || request.signal.aborted || seq !== sequence) return;
            report(''); model = ''; refresh();
          } catch (failure) { if (!abort.signal.aborted && !request.signal.aborted) report('Column discovery: ' + message(failure)); }
        }, 300);
      };
      add.addEventListener('click', () => { const current = columns(); const key = available.find(k => !current.some(c => c.key === k)); if (key) changed(field, [...current, { key, label: key, format: 'text' }]); else report('Choose a readable source to discover more columns'); });
      discover.addEventListener('click', () => { if (available.length) changed(field, columnOptions([], available)); else report('No source columns discovered yet'); });
      control = { element: elem('div', 'widget-columns-editor', rows, add, discover), refresh: refreshColumns, destroy: () => { clearTimeout(timer); active?.abort(); }, invalid: () => { try { columnOptions(value(), available); return ''; } catch (failure) { return message(failure); } } };
    } else if (field.type === 'select') {
      const select = elem('select', { 'aria-label': field.label });
      let signature = '', choices: readonly string[] = [], active: AbortController | undefined;
      const draw = () => { const current = String(value() ?? ''); select.replaceChildren(elem('option', { value: '' }, 'None'), ...[...new Set([...choices, ...(current && !choices.includes(current) ? [current] : [])])].map(v => elem('option', { value: v }, v))); select.value = current; };
      const refreshSelect = () => {
        const next = JSON.stringify(options);
        if (next === signature) { draw(); return; } signature = next;
        active?.abort(); active = new AbortController(); const request = active;
        try {
          const result = typeof field.choices === 'function' ? field.choices(options, request.signal) : field.choices || [];
          if (result instanceof Promise) result.then(values => { if (!request.signal.aborted && !abort.signal.aborted) { choices = values; draw(); report(''); } }).catch(failure => { if (!request.signal.aborted) report(message(failure)); });
          else { choices = result; draw(); report(''); }
        } catch (failure) { report(message(failure)); }
      };
      select.addEventListener('change', () => changed(field, select.value));
      control = { element: select, refresh: refreshSelect, destroy: () => active?.abort(), invalid: () => value() && !choices.includes(String(value())) ? 'Choose an available option' : '' };
    } else {
      const numeric = field.type === 'number' || field.type === 'interval';
      const input = elem('input', { type: field.type === 'boolean' ? 'checkbox' : numeric ? 'number' : 'text', 'aria-label': field.label });
      if (numeric) { input.min = String(field.min ?? (field.type === 'interval' ? 1 : '')); input.max = String(field.max ?? (field.type === 'interval' ? 86400 : '')); }
      input.addEventListener('input', () => changed(field, field.type === 'boolean' ? input.checked : numeric ? input.value === '' ? '' : Number(input.value) : input.value));
      control = { element: field.type === 'interval' ? elem('div', 'widget-interval', input, elem('span', undefined, 'seconds')) : input,
        refresh: () => { if (field.type === 'boolean') input.checked = value() === true; else if (document.activeElement !== input) input.value = String(value() ?? ''); } };
    }
    const input = control.element.matches('input,select') ? control.element as HTMLInputElement | HTMLSelectElement : control.element.querySelector<HTMLInputElement | HTMLSelectElement>('input,select') || undefined;
    if (input) { input.id = 'widget-field-' + nextFieldId; input.setAttribute('aria-describedby', error.id); }
    const label = elem('label', { class: 'meta-field', htmlFor: input?.id }, field.label);
    root.append(label, control.element, ...(field.hint ? [elem('small', 'widget-field-hint', field.hint)] : []), error);
    controls.push({ field, control, root, input, error, external: '' }); element.append(root);
  }
  if (definition?.editor?.component) {
    try {
      const result = definition.editor.component({ options, docId, signal: abort.signal, change: patch => { Object.assign(options, patch); refresh(); onChange(); }, setError });
      custom = result instanceof HTMLElement ? { element: result } : result;
      element.append(custom.element);
    } catch (failure) { setError('editor', 'Editor could not be loaded: ' + message(failure)); }
  }
  element.append(globalNote); refresh();
  return { element, refresh, setError,
    validate() { refresh(); let valid = !globalErrors.size; for (const item of controls) if (!check(item)) valid = false; try { if (custom?.validate?.() === false) valid = false; } catch (failure) { setError('editor', message(failure)); valid = false; } return valid; },
    destroy() { abort.abort(); controls.forEach(c => c.control.destroy?.()); try { custom?.destroy?.(); } catch { /* isolated plugin cleanup */ } },
  };
}
