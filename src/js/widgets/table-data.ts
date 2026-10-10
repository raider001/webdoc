import { extractSection, liveSourceUrl, LiveFetchError } from './live.js';
import { renderMarkdown } from '../commonmark.js';
import { sanitizeToFragment } from '../sanitize.js';
import { joinDocPath } from '../doclinks.js';

export interface TableSource { kind: 'markdown' | 'csv' | 'json'; src: string; section?: string; key?: string; }
export interface TableData { columns: string[]; rows: Record<string, unknown>[]; }
export interface TableColumn { key: string; label: string; format: 'text' | 'number' | 'percent' | 'datetime' | 'link' | 'status'; }
export const COLUMN_FORMATS = ['text', 'number', 'percent', 'datetime', 'link', 'status'] as const;
const MAX_ROWS = 10000;

export function tableSource(value: unknown): TableSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a data source');
  const source = value as TableSource;
  if (typeof source.src !== 'string' || !source.src) throw new Error('Choose a source document or file');
  if (!['markdown', 'csv', 'json'].includes(source.kind)) throw new Error('Choose Markdown, CSV or JSON');
  liveSourceUrl(String(source.src || '')); // same document-root id/path rules
  if (source.kind !== 'markdown' && !source.src.toLowerCase().endsWith('.' + source.kind)) throw new Error('Choose a .' + source.kind + ' file');
  if (source.section !== undefined && typeof source.section !== 'string') throw new Error('Section must be text');
  if (source.key !== undefined && typeof source.key !== 'string') throw new Error('JSON array key must be text');
  return source;
}

export function dataSourceUrl(source: TableSource): string {
  return source.kind === 'markdown' ? liveSourceUrl(source.src) : '/api/data/file?src=' + encodeURIComponent(source.src);
}

function checked(data: TableData): TableData {
  if (data.rows.length > MAX_ROWS || data.columns.length > 128) throw new Error('Data exceeds 10,000 rows or 128 columns');
  if (!data.columns.length || data.columns.some(c => !c.trim()) || new Set(data.columns).size !== data.columns.length) throw new Error('Columns need unique, non-empty names');
  return data;
}

export function parseCsv(raw: string): TableData {
  raw = raw.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; };
  const finishRow = () => { finishCell(); if (row.some(c => c !== '')) records.push(row); row = []; if (records.length > MAX_ROWS + 1) throw new Error('Data exceeds 10,000 rows'); };
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      if (char === '"') { if (raw[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === ',') finishCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && raw[i + 1] === '\n') i++; finishRow(); }
    else if (char === '"') { if (cell || closed) throw new Error('Invalid CSV quote'); quoted = true; }
    else if (closed) { if (char.trim()) throw new Error('Unexpected text after CSV quote'); }
    else cell += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length || closed) finishRow();
  const columns = (records.shift() || []).map(c => c.trim());
  const rows = records.map(values => {
    if (values.length > columns.length) throw new Error('CSV row has too many cells');
    return Object.fromEntries(columns.map((key, index) => [key, values[index] ?? '']));
  });
  return checked({ columns, rows });
}

export function parseJson(raw: string, key = ''): TableData {
  let value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
  for (const part of key ? key.split('.') : []) {
    if (!part || ['__proto__', 'prototype', 'constructor'].includes(part) || !value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw new Error('JSON array key not found: ' + key);
    value = (value as Record<string, unknown>)[part];
  }
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('JSON must contain an array of objects');
  if (!value.length) return { columns: [], rows: [] };
  const rows = value as Record<string, unknown>[];
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return checked({ columns, rows });
}

export function parseMarkdownTable(raw: string, source: TableSource): TableData {
  const fragment = sanitizeToFragment(renderMarkdown(extractSection(raw, source.section)));
  const table = fragment.querySelector('table');
  if (!table) throw new Error('No Markdown table in the selected section');
  const columns = [...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim());
  const rows = [...table.querySelectorAll('tbody tr')].map(row => Object.fromEntries([...row.querySelectorAll('td')].map((cell, i) => {
    const link = cell.querySelector('a');
    let href = link?.getAttribute('href');
    if (href && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) href = '#/' + joinDocPath(source.src.replace(/\.md$/i, ''), href.replace(/\.md(?:#.*)?$/i, ''));
    return [columns[i], href ? { label: cell.textContent.trim(), href } : cell.textContent.trim()];
  })));
  return checked({ columns, rows });
}

export function createTableReader() {
  let cached: { source: string; etag?: string; raw: string; data: TableData } | undefined;
  return {
    clear() { cached = undefined; },
    async read(value: unknown, signal: AbortSignal): Promise<TableData> {
      const source = tableSource(value);
      const key = JSON.stringify(source);
      const previous = cached?.source === key ? cached : undefined;
      const headers: Record<string, string> = {};
      if (previous?.etag) headers['If-None-Match'] = previous.etag;
      const response = await fetch(dataSourceUrl(source), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers });
      if (response.status === 304 && previous) return previous.data;
      if (!response.ok) throw new LiveFetchError(response.status);
      const raw = await response.text();
      if (raw.length > 2 * 1024 * 1024) throw new Error('Data source exceeds 2 MiB');
      const data = previous?.raw === raw ? previous.data : source.kind === 'csv' ? parseCsv(raw) : source.kind === 'json' ? parseJson(raw, source.key) : parseMarkdownTable(raw, source);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      cached = { source: key, etag: response.headers.get('ETag') || undefined, raw, data };
      return data;
    },
  };
}

export function columnOptions(value: unknown, available: string[] = []): TableColumn[] {
  if (value === undefined || (Array.isArray(value) && !value.length)) return available.map(key => ({ key, label: key, format: 'text' }));
  if (!Array.isArray(value)) throw new Error('Columns must be a list');
  const columns = value as TableColumn[];
  if (columns.some(c => !c || typeof c.key !== 'string' || !c.key.trim() || typeof c.label !== 'string' || !c.label.trim() || !COLUMN_FORMATS.includes(c.format))) throw new Error('Each column needs a source name, label and format');
  if (new Set(columns.map(c => c.key)).size !== columns.length) throw new Error('Choose each column once');
  if (available.length && columns.some(c => !available.includes(c.key))) throw new Error('A selected column is absent from the source');
  return columns;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return 'label' in value ? String((value as { label: unknown }).label) : JSON.stringify(value);
  return String(value);
}

function comparable(value: unknown, format: TableColumn['format']): string | number {
  const text = cellText(value);
  if (format === 'number' || format === 'percent') { const number = Number(text.replace(/[,%]/g, '')); return Number.isFinite(number) ? format === 'percent' && text.endsWith('%') ? number / 100 : number : -Infinity; }
  if (format === 'datetime') { const time = Date.parse(text); return Number.isFinite(time) ? time : -Infinity; }
  return text;
}

export function tableRows(data: TableData, columns: TableColumn[], options: Record<string, unknown>): Record<string, unknown>[] {
  const max = Number(options.maxRows ?? 100);
  if (!Number.isInteger(max) || max < 1 || max > MAX_ROWS) throw new Error('Maximum rows must be 1–10,000');
  const filter = String(options.filter || '').toLocaleLowerCase();
  const rows = data.rows.filter(row => !filter || columns.some(c => cellText(Object.hasOwn(row, c.key) ? row[c.key] : null).toLocaleLowerCase().includes(filter)));
  const sort = columns.find(c => c.key === options.sortBy);
  if (options.sortBy && !sort) throw new Error('Choose a displayed column for sorting');
  if (sort) rows.sort((a, b) => {
    const x = comparable(Object.hasOwn(a, sort.key) ? a[sort.key] : null, sort.format), y = comparable(Object.hasOwn(b, sort.key) ? b[sort.key] : null, sort.format);
    const order = typeof x === 'number' && typeof y === 'number' ? (x === y ? 0 : x < y ? -1 : 1) : String(x).localeCompare(String(y), undefined, { numeric: true });
    return options.sortDirection === 'desc' ? -order : order;
  });
  return rows.slice(0, max);
}

export function formattedCell(value: unknown, format: TableColumn['format']): Node {
  const text = cellText(value);
  if (format === 'link') {
    const href = value && typeof value === 'object' && 'href' in value ? String((value as { href: unknown }).href) : text;
    const safe = /^(?:https?:\/\/|mailto:|#|\/(?!\/))/i.test(href) ? href : /^[\w-]+\/(?!.*(?:\.\.|:|\\))[^\s?#]+$/.test(href) ? '#/' + href : '';
    if (safe) { const link = document.createElement('a'); link.textContent = text; link.href = safe; if (/^https?:/i.test(safe)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; } return link; }
  }
  if (format === 'status') {
    const badge = document.createElement('span');
    const normalized = text.toLowerCase();
    badge.className = 'wd-status wd-status-' + (/^(done|complete|pass|ok|success)$/.test(normalized) ? 'good' : /^(failed|fail|error|blocked)$/.test(normalized) ? 'bad' : /^(running|active|pending|queued)$/.test(normalized) ? 'pending' : 'neutral');
    badge.textContent = text; return badge;
  }
  let result = text;
  if (text && (format === 'number' || format === 'percent')) {
    const numeric = Number(text.replace(/[,%]/g, ''));
    if (Number.isFinite(numeric)) result = format === 'percent' ? (text.endsWith('%') ? numeric : numeric * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '%' : numeric.toLocaleString(undefined, { maximumFractionDigits: 3 });
  } else if (text && format === 'datetime' && Number.isFinite(Date.parse(text))) result = new Date(text).toLocaleString();
  return document.createTextNode(result);
}

export function renderTable(data: TableData, options: Record<string, unknown>): HTMLElement {
  const columns = columnOptions(options.columns, data.columns);
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const column of columns) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = column.label; head.append(cell); }
  const body = table.createTBody();
  for (const row of tableRows(data, columns, options)) {
    const tr = body.insertRow();
    for (const column of columns) tr.insertCell().append(formattedCell(Object.hasOwn(row, column.key) ? row[column.key] : null, column.format));
  }
  const box = document.createElement('div'); box.className = 'wd-table-data'; box.append(table);
  if (!body.rows.length) { const note = document.createElement('p'); note.textContent = 'No rows'; box.append(note); }
  return box;
}
