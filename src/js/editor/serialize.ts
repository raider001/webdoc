// editor/serialize.ts - conversion between the editor's visual block model and
// Markdown, in both directions.
//   * inline HTML (<strong>/<em>/<code>/<a>) -> Markdown
//   * blocks -> Markdown (serializeDoc, normalize-on-save)
//   * an existing document's Markdown -> { meta, blocks } (parseDoc)
// Zero UI here - pure data transforms (plus the shared renderer/sanitizer).
import { renderMarkdown } from '../commonmark.js';
import { sanitizeToFragment } from '../sanitize.js';

import type {
  Block, ImageBlock, HrBlock, CodeBlock, AccessStartBlock, AccessEndBlock
} from '../editor.js';
import type {
  TableBlock, ReqBlock, RequirementRow, TestCaseBlock, TestStep
} from './widgets.js';

/**
 * A document header's `access` block, as the editor round-trips it: `read` names
 * the groups allowed to read the page, `hidden` withholds it from the map and
 * search. serializeDoc writes the object straight back out, so a key the server
 * understands and this editor does not still survives a save.
 */
export interface DocAccessRule {
  read?: string[];
  hidden?: boolean;
}

/**
 * The normalized document front-matter bundle read from / written to the
 * <!--meta ...--> header. serializeDoc/parseDoc (this file) are the canonical
 * write/read; editor.ts's working `meta` object and editor/panels.ts's
 * metadataPanel share and mutate the same shape.
 */
export interface DocMeta {
  title: string;
  description: string;
  assumes: string[];
  next: string[];
  /** the document's access-control block, when it has one */
  access?: DocAccessRule | null;
  /** every OTHER header key, carried through untouched */
  _extra?: Record<string, unknown>;
}

// Header keys this editor understands. Everything else is preserved verbatim
// through _extra rather than dropped: serializeDoc used to rebuild the header
// from a fixed field list, so any key it did not know about vanished on the next
// save. For a permission block that is not lost formatting - it is a page
// quietly unlocking itself.
const KNOWN_META_KEYS = ['title', 'description', 'assumes', 'next', 'access'];

/**
 * The paired markers that delimit an access-controlled section in the body.
 * They round-trip as two standalone marker BLOCKS (access-start / access-end)
 * rather than a wrapper, because the editor's block model is flat - and because
 * a marker the editor cannot represent is a marker the editor deletes.
 */
const ACCESS_TOKEN_RE = /<!--\s*access\s+(start|end)\b\s*(\{[\s\S]*?\})?\s*-->/gi;

/**
 * Character ranges covered by fenced code blocks, so a marker written inside a
 * ``` example is left alone. Same line-scan as requirements/parse.js and the
 * server's webdoc_access.fenced_ranges - all three must agree, or the editor
 * and the server disagree about where a restricted section begins.
 */
function fencedRanges(body: string): [number, number][] {
  const ranges: [number, number][] = [];
  let offset = 0, open: { ch: string, len: number, from: number } | null = null;
  for (const line of String(body).split('\n')) {
    const start = offset, end = offset + line.length;
    if (!open) {
      const o = /^ {0,3}([`~]{3,})/.exec(line);
      if (o) open = { ch: o[1][0], len: o[1].length, from: start };
    } else {
      const c = /^ {0,3}([`~]{3,})[ \t]*$/.exec(line);
      if (c && c[1][0] === open.ch && c[1].length >= open.len) { ranges.push([open.from, end]); open = null; }
    }
    offset = end + 1;
  }
  if (open) ranges.push([open.from, String(body).length]);
  return ranges;
}
/**
 * Character ranges covered by inline `code spans`, so a marker mentioned inside
 * one is prose about the syntax rather than a use of it. A code span never
 * crosses a newline - that is what excluding \n from the class enforces.
 * Mirrors the server's webdoc_access.INLINE_CODE_RE; the two must agree, or the
 * editor moves a marker the server ignores.
 */
function codeSpanRanges(body: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /`[^`\n]*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(body)))) out.push([m.index, m.index + m[0].length]);
  return out;
}
function inFence(ranges: [number, number][], pos: number): boolean {
  for (const [a, b] of ranges) if (pos >= a && pos < b) return true;
  return false;
}

export interface HeadingMdBlock {
  type: 'heading';
  level: number;
  /** Markdown source (already converted from HTML via htmlToMd) */
  text: string;
}
export interface ParagraphMdBlock {
  type: 'paragraph';
  /** Markdown source */
  text: string;
}
export interface QuoteMdBlock {
  type: 'quote';
  /** Markdown source */
  text: string;
}
export interface ListMdBlock {
  type: 'list';
  ordered: boolean;
  /** Markdown source, one entry per list item */
  items: string[];
}
/**
 * What blockToMd()/serializeDoc() actually consume: editor.ts's onSave already
 * converts the four inline-HTML block types (heading/paragraph/quote/list) from
 * their visual, HTML-holding Block form to Markdown source (text/items) before
 * calling serializeDoc; every other block type is passed through unchanged and
 * keeps its original Block shape. Deliberately distinct from both editor.ts's
 * HTML-based `Block` and md/blocks.ts's parser-tree node `MdBlockNode`.
 */
export type MdSourceBlock =
  | HeadingMdBlock
  | ParagraphMdBlock
  | QuoteMdBlock
  | ListMdBlock
  | CodeBlock
  | TableBlock
  | ImageBlock
  | HrBlock
  | ReqBlock
  | TestCaseBlock
  | AccessStartBlock
  | AccessEndBlock;

/* ---- Inline HTML -> Markdown ---- */
function escInline(s: string): string {
  return s.replace(/([\\`*_[\]<>])/g, '\\$1');
}
function inlineToMd(node: Node): string {
  let out = '';
  node.childNodes.forEach(n => {
    if (n.nodeType === 3) { out += escInline(n.nodeValue || ''); return; }   // a text node always has one; `|| ''` is a no-op there
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    const inner = inlineToMd(el);
    if (tag === 'strong' || tag === 'b') out += '**' + inner + '**';
    else if (tag === 'em' || tag === 'i') out += '*' + inner + '*';
    else if (tag === 'code') out += '`' + el.textContent + '`';
    else if (tag === 'del' || tag === 's') out += '~~' + inner + '~~';
    else if (tag === 'a') out += '[' + inner + '](' + mdDest(el.getAttribute('href') || '') + ')';
    // Image: prefer data-mdsrc (the ORIGINAL relative path the editor stashes when it
    // resolves a src to /docs/... for display) so a relative image round-trips as
    // written, not rewritten to an absolute server path. Without this case, <img>
    // fell through to `inner` (empty) and inline images were silently lost on save.
    else if (tag === 'img') out += '![' + (el.getAttribute('alt') || '') + '](' + mdDest(el.getAttribute('data-mdsrc') || el.getAttribute('src') || '') + ')';
    else if (tag === 'br') out += '  \n';
    else out += inner;
  });
  return out.replace(/\s+$/g, s => s.replace(/[^\n]/g, ' ')); // keep trailing spaces sane
}
// A Markdown link destination. Bare form breaks on spaces or parentheses, so use
// the angle-bracket form <...> for those, escaping backslash / < / > within.
function mdDest(url: string): string {
  const u = String(url).replace(/[\r\n]+/g, '');
  if (/[\s()<>]/.test(u)) return '<' + u.replace(/([\\<>])/g, '\\$1') + '>';
  return u;
}
export function htmlToMd(html: string): string {
  const d = document.createElement('div'); d.innerHTML = html || '';
  return inlineToMd(d).trim();
}

/* ---- Blocks -> Markdown ---- */
/**
 * The exhaustiveness guard for blockToMd's switch below. Its parameter is
 * `never`, so the call only type-checks while every member of MdSourceBlock has
 * a case above it: adding a block kind without a case becomes a COMPILE error
 * instead of a block that silently serialises to nothing. That drift is exactly
 * what happened before the union was real. The empty string it returns is the
 * same value the old plain `default:` arm returned for a runtime value that is
 * not a block the editor knows.
 */
function unhandledBlock(_block: never): string { return ''; }

function blockToMd(b: MdSourceBlock): string {
  switch (b.type) {
    case 'heading': return '#'.repeat(b.level) + ' ' + b.text;
    case 'paragraph': return b.text;
    case 'quote': return b.text.split('\n').map(l => '> ' + l).join('\n');
    case 'list': return b.items.map(it => (b.ordered ? '1. ' : '- ') + it).join('\n');
    case 'code': return '```' + (b.lang || '') + '\n' + b.code.replace(/\n$/, '') + '\n```';
    case 'hr': return '---';
    case 'image': return '![' + (b.alt || '') + '](' + (b.src || '') + ')';
    case 'table': {
      // GFM pipe table. Cells are inline HTML (rich-text contenteditable) -> convert
      // each to inline Markdown, then escape literal pipes and collapse newlines
      // (a cell must stay on one line; use <br> markup, which htmlToMd emits, for a
      // soft break within a cell).
      const headers = b.headers || [];
      const aligns = b.aligns || [];
      const rows = b.rows || [];
      const esc = (s: string): string => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ');
      /** @param html one cell's inline HTML */
      const cellMd = (html: string): string => esc(htmlToMd(String(html == null ? '' : html)));
      /** @param a a column's align attribute */
      const sepFor = (a: string): string => a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
      // Driven by `headers`, not by the row, so a ragged row is padded rather than
      // producing a table whose rows disagree about their column count.
      const rowLine = (cells: string[]): string => '| ' + headers.map((_, i) => cellMd(cells[i])).join(' | ') + ' |';
      const lines = [rowLine(headers), '| ' + headers.map((_, i) => sepFor(aligns[i] || '')).join(' | ') + ' |'];
      rows.forEach(r => lines.push(rowLine(r)));
      return lines.join('\n');
    }
    case 'requirement': {
      const head = '<!--meta start {"requirement-group":' + JSON.stringify(b.group) + '}-->';
      const foot = '<!--meta end {"requirement-group":' + JSON.stringify(b.group) + '}-->';
      const rows = b.rows.map(r => '| ' + r.no + ' | ' + r.description + ' | ' + r.traceTo + ' |');
      return head + '\n| requirement-no | description | trace-to |\n| --- | --- | --- |\n' +
        rows.join('\n') + '\n' + foot;
    }
    case 'testcase': {
      // Steps are structured data in the meta header (a custom block, not a
      // markdown table), so any markdown - pipes, backslashes, lines - is safe.
      const meta = {
        test: b.key || 'test', name: b.name || '', verifies: b.verifies || [],
        steps: (b.steps || []).map(s => ({ action: s.action || '', expected: s.expected || '' }))
      };
      return '<!--meta start ' + JSON.stringify(meta) + '-->\n<!--meta end {"test":' + JSON.stringify(b.key || 'test') + '}-->';
    }
    case 'access-start': {
      const spec: { read?: string[], label?: string } = {};
      if (Array.isArray(b.read) && b.read.length) spec.read = b.read.map(String);
      if (b.label) spec.label = String(b.label);
      return '<!--access start ' + JSON.stringify(spec) + '-->';
    }
    case 'access-end': return '<!--access end-->';
    default: return unhandledBlock(b);
  }
}
/**
 * The object that BECOMES the header JSON: the four known fields, optionally
 * `access`, and then whatever unknown keys _extra carried in. Open-ended by
 * nature - a header key this editor has never heard of still has to be written
 * back out verbatim (see KNOWN_META_KEYS), so the shape genuinely is
 * "known fields plus arbitrary JSON", not a closed record.
 */
export type HeaderJson = Omit<DocMeta, '_extra'> & Record<string, unknown>;

export function serializeDoc(meta: Partial<DocMeta>, blocks: MdSourceBlock[]): string {
  const m: HeaderJson = {
    title: meta.title || 'Untitled',
    description: meta.description || '',
    assumes: meta.assumes || [],
    next: meta.next || []
  };
  // An access block is only written when the document actually has one, so an
  // ordinary page's header keeps exactly the shape it has always had.
  if (meta.access && typeof meta.access === 'object') m.access = meta.access;
  // Unknown keys last, and never allowed to overwrite a known one.
  const extra: Record<string, unknown> = meta._extra || {};
  for (const key in extra) {
    if (KNOWN_META_KEYS.indexOf(key) === -1) m[key] = extra[key];
  }
  const header = '<!--meta\n' + JSON.stringify(m, null, 2) + '\n-->';
  const body = blocks.map(blockToMd).filter(s => s !== '').join('\n\n');
  return header + '\n\n' + body + '\n';
}

/* ---- Existing document -> { meta, blocks } ---- */
/**
 * The JSON inside an `<!--access start {...}-->` marker, as authors actually
 * write it: `read` tolerates a bare string as well as a list, and the spec is
 * sometimes nested one level under `access` (the same shape the header uses).
 */
export interface AccessSpec {
  read?: string | string[];
  label?: string;
  /** the nested form */
  access?: AccessSpec;
}
/**
 * The JSON inside a `<!--meta start {...}-->` block wrapper. One comment form
 * covers two block kinds - a test case and a requirement group - which is why
 * everything is optional, and every field has a legacy spelling beside it.
 */
export interface BlockMetaJson {
  test?: string;
  'test-case'?: string;
  name?: string;
  verifies?: string[];
  steps?: { action?: string, expected?: string, 'expected-response'?: string, response?: string }[];
  'requirement-group'?: string;
  group?: string;
}

/** What parseDoc hands back. */
export interface ParsedDoc {
  meta: DocMeta;
  blocks: Block[];
  /**
   * Non-zero when an access marker could not be represented as a block; the
   * caller must refuse to edit rather than save a document missing that
   * boundary.
   */
  lostMarkers: number;
}

/**
 * @param docMeta existing front-matter to preserve (a brand-new document passes
 *   {}). Deliberately open-ended: this is the RAW parsed header, and its unknown
 *   keys sit at the top level - collecting them into _extra is exactly what the
 *   loop at the end does.
 */
export function parseDoc(rawBody: string, docMeta?: Partial<DocMeta> & Record<string, unknown>): ParsedDoc {
  // Pull requirement groups out first (they are meta-wrapped tables) and leave
  // placeholders, so their positions survive; everything else renders to HTML.
  const groups: (ReqBlock | TestCaseBlock)[] = [];
  const RE = /<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->([\s\S]*?)<!--\s*meta\s+end[\s\S]*?-->/gi;
  /** @param line one row of a pipe table */
  const cellsOf = (line: string): string[] => {
    const cells = line.split('|').map(c => c.trim());
    return cells.filter((x, i) => !(i === 0 && x === '') && !(i === cells.length - 1 && x === ''));
  };
  // Access markers first: each becomes its own placeholder so it survives the
  // markdown round-trip. They are HTML comments, which the sanitizer strips, so
  // without this step editing any page with a restricted section would silently
  // publish that section on the next save.
  //
  // FENCE-AWARE. A marker written inside a ``` block is a documentation EXAMPLE,
  // not a real boundary. Replacing one would hoist it out of its fence on save -
  // turning an example into a live restriction, and (because the paired end
  // marker moves too) truncating whatever section it landed inside.
  const markers: (AccessStartBlock | AccessEndBlock)[] = [];
  // Fenced blocks AND inline code spans: a marker mentioned in either is prose
  // about the syntax, not a boundary. The server applies exactly the same rule,
  // and the two must agree or the editor moves a marker the server ignores.
  const fences = fencedRanges(String(rawBody)).concat(codeSpanRanges(String(rawBody)));
  let source = String(rawBody).replace(ACCESS_TOKEN_RE, (whole: string, kind: string, json: string, offset: number) => {
    if (inFence(fences, offset)) return whole;
    if (String(kind).toLowerCase() === 'end') {
      markers.push({ type: 'access-end' });
    } else {
      let spec: AccessSpec = {};
      try { spec = JSON.parse(json || '{}') || {}; } catch (e) { spec = {}; }
      if (spec.access && typeof spec.access === 'object') spec = spec.access;
      markers.push({
        type: 'access-start',
        read: Array.isArray(spec.read) ? spec.read.map(String) : (spec.read ? [String(spec.read)] : []),
        label: spec.label ? String(spec.label) : '',
      });
    }
    return '\n\n@@ACCESSMARK' + (markers.length - 1) + '@@\n\n';
  });

  let body = source.replace(RE, (_m: string, json: string, inner: string) => {
    let meta: BlockMetaJson = {};
    try { meta = JSON.parse(json); } catch (e) {}
    if (meta.test || meta['test-case']) {   // test-case block
      let steps: TestStep[];
      if (Array.isArray(meta.steps)) {      // structured steps (current format)
        steps = meta.steps.map(s => ({ action: (s && s.action) || '', expected: (s && (s.expected || s['expected-response'] || s.response)) || '' }));
      } else {                              // legacy: action / expected rows in a table
        steps = [];
        inner.split('\n').forEach(line => {
          if (line.indexOf('|') === -1) return;
          const c = cellsOf(line);
          if (c.length >= 1 && !/^-+$/.test(c[0]) && c[0].toLowerCase() !== 'action')
            steps.push({ action: c[0], expected: c[1] || '' });
        });
      }
      groups.push({
        type: 'testcase', key: meta.test || meta['test-case'] || '', name: meta.name || '',
        verifies: Array.isArray(meta.verifies) ? meta.verifies.map(String) : [],
        steps: steps.length ? steps : [{ action: '', expected: '' }]
      });
      return '\n\n@@REQGROUP' + (groups.length - 1) + '@@\n\n';
    }
    const group = (meta && (meta['requirement-group'] || meta.group)) || '';
    const rows: RequirementRow[] = [];
    inner.split('\n').forEach(line => {
      if (line.indexOf('|') === -1) return;
      const c = cellsOf(line);
      if (c.length >= 3 && !/^-+$/.test(c[0]) && c[0].toLowerCase() !== 'requirement-no')
        rows.push({ no: c[0], description: c[1], traceTo: c[2] });
    });
    groups.push({ type: 'requirement', group, rows });
    return '\n\n@@REQGROUP' + (groups.length - 1) + '@@\n\n';
  });

  const html = renderMarkdown(body);
  const frag = sanitizeToFragment(html);
  const holder = document.createElement('div');
  holder.appendChild(frag);

  const blocks: Block[] = [];
  /**
   * Resolve a placeholder's text back to the block it stands for.
   */
  const placeholder = (text: string): ReqBlock | TestCaseBlock | AccessStartBlock | AccessEndBlock | null => {
    let mm = /^@@REQGROUP(\d+)@@$/.exec(text);
    if (mm) return groups[+mm[1]];
    mm = /^@@ACCESSMARK(\d+)@@$/.exec(text);
    if (mm) return markers[+mm[1]];
    return null;
  };
  holder.childNodes.forEach(n => {
    if (n.nodeType === 3) {
      const hit = placeholder((n.nodeValue || '').trim());   // nodeType 3 -> always a string
      if (hit) blocks.push(hit);
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    const hit = placeholder(el.textContent.trim());
    if (hit) { blocks.push(hit); return; }
    if (/^h[1-6]$/.test(tag)) blocks.push({ type: 'heading', level: +tag[1], html: stripNums(el) });
    else if (tag === 'p') blocks.push({ type: 'paragraph', html: el.innerHTML });
    else if (tag === 'blockquote') blocks.push({ type: 'quote', html: el.innerHTML.replace(/<\/?p>/g, '').trim() });
    else if (tag === 'ul' || tag === 'ol') blocks.push({ type: 'list', ordered: tag === 'ol', itemsHtml: [...el.children].map(li => li.innerHTML) });
    else if (tag === 'pre') { const code = el.querySelector('code'); blocks.push({ type: 'code', lang: langOf(code), code: (code || el).textContent.replace(/\n$/, '') }); }
    else if (tag === 'hr') blocks.push({ type: 'hr' });
    else if (tag === 'table') blocks.push(tableBlock(el as HTMLTableElement));
    else if (tag === 'figure' || tag === 'img') { const img = tag === 'img' ? el : el.querySelector('img'); if (img) blocks.push({ type: 'image', src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '' }); }
    else if (el.textContent.trim()) blocks.push({ type: 'paragraph', html: el.innerHTML });
  });
  if (!blocks.length) blocks.push({ type: 'paragraph', html: '' });

  // Every access marker MUST come back out as a block. If one did not (it landed
  // inside an HTML block, a table cell, or some construct the block model cannot
  // represent), report it: the caller refuses to open the editor rather than
  // saving a document with a permission boundary silently deleted.
  const recovered = blocks.filter(b => b && (b.type === 'access-start' || b.type === 'access-end')).length;
  const lostMarkers = markers.length - recovered;

  // Unknown header keys ride through in _extra. Collected before the literal
  // below so the header is read through one local that is definitely there,
  // rather than through the optional parameter and the optional field.
  const raw = docMeta || {};
  const extra: Record<string, unknown> = {};
  for (const key in raw) {
    if (KNOWN_META_KEYS.indexOf(key) === -1) extra[key] = raw[key];
  }

  const meta: DocMeta = {
    title: raw.title || '',
    description: raw.description || '',
    assumes: raw.assumes ? raw.assumes.slice() : [],
    next: raw.next ? raw.next.slice() : [],
    access: (raw.access && typeof raw.access === 'object') ? raw.access : null,
    _extra: extra,
  };
  return { meta, blocks, lostMarkers };
}
function stripNums(el: Element): string {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.secnum').forEach(s => s.remove());
  return c.innerHTML.trim();
}
function langOf(code: Element | null): string {
  if (!code) return '';
  const m = /language-([\w+.#-]+)/.exec(code.className || '');
  return m ? m[1] : '';
}
function tableBlock(table: HTMLTableElement): TableBlock {
  // innerHTML (not textContent): cells carry inline markup - <strong>, <a>, <code>,
  // <img> - which round-trips back to inline Markdown on save.
  const headers = [...table.querySelectorAll('thead th')].map(th => th.innerHTML.trim());
  const aligns = [...table.querySelectorAll('thead th')].map(th => th.getAttribute('align') || '');
  const rows = [...table.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.innerHTML.trim()));
  return { type: 'table', headers, aligns, rows };
}

/* ---- Block-model factory (new blocks from the "+ Add block" menu) ---- */
/**
 * @param type a BLOCK_MENU entry's `type` (editor/ui.ts), or 'list-ordered'
 */
export function newBlock(type: string): Block {
  if (type === 'list-ordered') return { type: 'list', ordered: true, itemsHtml: [''] };
  if (type === 'list') return { type: 'list', ordered: false, itemsHtml: [''] };
  if (type === 'heading') return { type: 'heading', level: 2, html: '' };
  if (type === 'code') return { type: 'code', lang: '', code: '' };
  if (type === 'quote') return { type: 'quote', html: '' };
  if (type === 'table') return { type: 'table', headers: ['Column 1', 'Column 2'], aligns: ['', ''], rows: [['', '']] };
  if (type === 'image') return { type: 'image', src: '', alt: '' };
  if (type === 'hr') return { type: 'hr' };
  if (type === 'requirement') return { type: 'requirement', group: 'grp', rows: [{ no: '1', description: '', traceTo: '' }] };
  if (type === 'testcase') return { type: 'testcase', key: 'test', name: '', verifies: [], steps: [{ action: '', expected: '' }] };
  // "Restricted section" inserts BOTH markers at once - a lone start marker would
  // run to the end of the file, silently hiding everything after it.
  if (type === 'access') return { type: 'access-start', read: [], label: '' };
  if (type === 'access-end') return { type: 'access-end' };
  return { type: 'paragraph', html: '' };
}
