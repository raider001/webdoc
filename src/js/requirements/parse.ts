// requirements/parse.ts - turn a document's RAW markdown into requirement-group
// and test-case block structures, and resolve requirement references. This is
// the extraction half of the subsystem (no DOM): it finds the meta-wrapped
// tables, parses their pipe rows, composes R_/T_ ids, and rewrites each meta
// region to a fenced `reqgroup` placeholder the parser emits. Extracted from
// requirements.js. Reads the requirement index (from ./store.js) for ref
// resolution; imports nothing else.
// ---------------------------------------------------------------------------
import { index } from './store.js';

import type { RequirementEntry, TestCaseEntry, TestStep } from '../requirements.js';

/**
 * The minimal per-document context extractGroups needs: just enough to compose
 * ids and resolve the source's component. requirements.js's prepareDocGroups
 * builds this ad hoc from the loaded Doc's id/source - it is not the full Doc
 * shape (catalog.js).
 */
export interface DocRef {
  id: string;
  source: string;
}

/**
 * A meta-block's table, parsed generically before knowing whether it is a
 * requirement group or a test case: the lower-cased/hyphenated header names, and
 * each data row as a header-name -> cell-text record (pick() reads known aliases
 * out of it).
 */
export interface ParsedTable {
  header: string[];
  rows: Record<string, string>[];
}

export interface ReqRefContext {
  component: string;
  group?: string;
}

/**
 * The JSON inside a `<!--meta start {…}-->` header. Authors write it by hand, so
 * every field is optional and several are spelled more than one way - the alias
 * hunts below are what reconcile them. This is the one place the two block
 * KINDS overlap: `requirement-group`/`group` mark a requirement table, `test`/
 * `test-case` mark a test case, and extractGroups picks the reader by which is
 * present.
 */
export interface BlockMeta {
  'requirement-group'?: string;
  group?: string;
  test?: string;
  'test-case'?: string;
  name?: string;
  steps?: AuthoredStep[];
  /** an array of ids, or the older comma-separated string */
  verifies?: unknown[] | string;
  /** the older singular spelling of `verifies` */
  verify?: string;
}

/**
 * One step exactly as an author may have written it in a test case's meta
 * header. Distinct from TestStep, which is the normalised {action, expected}
 * pair extractTestCase produces: an authored step may spell the response any of
 * three ways, and may omit either half.
 */
export interface AuthoredStep {
  action?: string;
  expected?: string;
  'expected-response'?: string;
  response?: string;
}

/**
 * One requirement-group block parsed from a document's meta-wrapped table
 * (`<!--meta start {"requirement-group":"nav"}-->`). Distinct from the editor's
 * ReqBlock (editor/widgets.js), which is the WYSIWYG in-progress widget shape.
 */
export interface ReqGroupBlock {
  kind: 'req';
  group: string;
  component: string;
  rows: RequirementEntry[];
  error: string | null;
}

/**
 * One test-case block parsed from a document's meta-wrapped table
 * (`<!--meta start {"test":"nav-tree",...}-->`). Distinct from the editor's
 * TestCaseBlock (editor/widgets.js), which is the WYSIWYG in-progress widget shape.
 */
export interface TestCaseDocBlock {
  kind: 'test';
  rec: TestCaseEntry;
  error: string | null;
}

/**
 * A single parsed block, in document order, as stored in requirements/store.js's
 * groupsByDoc and returned by extractGroups.
 */
export type ReqOrTestBlock = ReqGroupBlock | TestCaseDocBlock;

/** Fresh regex each call (global-flag lastIndex safety). */
function metaBlockRe(): RegExp {
  return /<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->([\s\S]*?)<!--\s*meta\s+end\b[\s\S]*?-->/gi;
}
/**
 * @returns the id with any character outside [A-Za-z0-9_-] replaced by '-'
 *   (safe for use as an element id)
 */
export function cssSafe(id: unknown): string { return String(id).replace(/[^A-Za-z0-9_-]/g, '-'); }
/** @param raw - a comma-separated reference list, or any falsy value */
function splitRefs(raw: string | null): string[] { return raw ? String(raw).split(',').map(s => s.trim()).filter(Boolean) : []; }

/**
 * Character ranges [start,end) that lie inside a fenced code block. A document
 * that DOCUMENTS this syntax (e.g. the authoring reference, the how-to guide)
 * shows a `<!--meta start … -->` / `<!--meta end … -->` pair literally inside a
 * code fence; those must NOT be mistaken for real requirement/test blocks. Both
 * the index build (extractGroups) and the placeholder pass (preprocessRequirements)
 * skip fenced matches identically, so their Nth-block counting stays aligned.
 * @returns start/end index pairs
 */
function fencedRanges(body: string): [number, number][] {
  const ranges: [number, number][] = [];
  let offset = 0;
  let open: { ch: string, len: number, from: number } | null = null;
  for (const line of String(body).split('\n')) {
    const start = offset, end = offset + line.length;
    if (!open) {
      const o = /^ {0,3}([`~]{3,})/.exec(line);            // opening fence (info string allowed)
      if (o) open = { ch: o[1][0], len: o[1].length, from: start };
    } else {
      const c = /^ {0,3}([`~]{3,})[ \t]*$/.exec(line);     // closing fence: bare, no info
      if (c && c[1][0] === open.ch && c[1].length >= open.len) { ranges.push([open.from, end]); open = null; }
    }
    offset = end + 1;                                       // + the consumed '\n'
  }
  if (open) ranges.push([open.from, String(body).length]); // an unterminated fence runs to the end
  return ranges;
}
function inFence(ranges: [number, number][], pos: number): boolean {
  for (let i = 0; i < ranges.length; i++) if (pos >= ranges[i][0] && pos < ranges[i][1]) return true;
  return false;
}

// ---- table parsing --------------------------------------------------------
/**
 * Split one pipe-delimited table row into trimmed cells, honoring `\|` escapes.
 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}
function parseTable(text: string): ParsedTable {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && l.indexOf('|') !== -1);
  if (lines.length < 2) return { header: [], rows: [] };
  const header = splitRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '-'));
  const rows: Record<string, string>[] = [];
  for (let r = 2; r < lines.length; r++) { // lines[1] is the |---| delimiter
    const cells = splitRow(lines[r]);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (cells[i] || '').trim(); });
    rows.push(rec);
  }
  return { header, rows };
}
/**
 * Return the first non-empty value among the given header-name aliases.
 */
function pick(rec: Record<string, string>, names: string[]): string { for (const n of names) if (rec[n] !== undefined && rec[n] !== '') return rec[n]; return ''; }

// ---- reference resolution -------------------------------------------------
/**
 * @returns the first candidate present as a key in idx, else null
 */
function resolveIn(idx: Map<string, unknown>, cands: string[]): string | null { for (const c of cands) if (idx.has(c)) return c; return null; }
/**
 * A requirement ref: full id (R_WD_nav_1), group_no (nav_1, same component), or a
 * bare no (1, same group).
 * @returns the composed requirement id, or null if not found
 */
export function resolveReqRef(raw: string, ctx: ReqRefContext): string | null {
  const cands = [raw, 'R_' + ctx.component + '_' + raw];
  if (ctx.group) cands.push('R_' + ctx.component + '_' + ctx.group + '_' + raw);
  return resolveIn(index, cands.map(c => c.toUpperCase())); // requirement ids are upper-case; match case-insensitively
}
/**
 * A requirement ref (short or full) -> its composed id, or null. For the app to
 * match a test's `verifies` entries when linking / unlinking.
 */
export function resolveRequirementRef(raw: unknown, component: string): string | null {
  return resolveReqRef(String(raw == null ? '' : raw), { component: component });
}

// ---- extraction -----------------------------------------------------------
/**
 * Find every meta-wrapped table in a document's raw markdown (skipping any that
 * are only a literal example inside a fenced code block) and parse each into a
 * requirement-group or test-case block, in document order.
 * @param body - raw markdown
 */
export function extractGroups(body: string, doc: DocRef, component: string): ReqOrTestBlock[] {
  const blocks: ReqOrTestBlock[] = [];
  const ranges = fencedRanges(body);
  const RE = metaBlockRe();
  let m;
  while ((m = RE.exec(body)) !== null) {
    if (inFence(ranges, m.index)) continue;   // literal example in a code fence, not a real block
    let meta: BlockMeta | null = null;
    try { meta = JSON.parse(m[1]); } catch (e) { /* handled below */ }
    const table = parseTable(m[2]);
    const isTest = !!(meta && (meta.test || meta['test-case']));
    blocks.push(isTest ? extractTestCase(meta, table, doc, component)
                       : extractReqGroup(meta, table, doc, component));
  }
  return blocks;
}

/**
 * @param meta - the parsed meta-header JSON, or null if it failed to parse
 */
function extractReqGroup(meta: BlockMeta | null, table: ParsedTable, doc: DocRef, component: string): ReqGroupBlock {
  const group = meta && (meta['requirement-group'] || meta.group);
  let error: string | null = null;
  if (!component) error = "source '" + doc.source + "' has no 'component' id in the server config";
  else if (!meta) error = 'requirement-group metadata is not valid JSON';
  else if (!group) error = 'requirement-group name is missing';

  const g: ReqGroupBlock = { kind: 'req', group: group || '(unnamed)', component: component || '?', rows: [], error: error };
  for (const row of table.rows) {
    const no = pick(row, ['requirement-no', 'req-no', 'no', 'requirement', '#']);
    if (!no) continue;
    const id = ((component && group) ? 'R_' + component + '_' + group + '_' + no : 'R_?_' + no).toUpperCase();
    const rec: RequirementEntry = {
      id: id, docId: doc.id, component: component, group: group, no: no,
      description: pick(row, ['description', 'desc']),
      traceTo: splitRefs(pick(row, ['trace-to', 'traceto', 'trace'])),
      traceFrom: [], verifiedBy: []   // verifiedBy is CALCULATED from tests' `verifies`
    };
    // NOTE: the global index comes from the server (buildRequirementIndex); per-doc
    // extraction only builds block structure for rendering, so it does NOT populate
    // the global index here (prepareDocGroups enriches from it instead).
    g.rows.push(rec);
  }
  return g;
}

function extractTestCase(meta: BlockMeta | null, table: ParsedTable, doc: DocRef, component: string): TestCaseDocBlock {
  const key = meta && (meta.test || meta['test-case']);
  let error: string | null = null;
  if (!component) error = "source '" + doc.source + "' has no 'component' id in the server config";
  else if (!meta) error = 'test-case metadata is not valid JSON';
  else if (!key) error = 'test-case key ("test") is missing';

  const id = (component && key) ? 'T_' + component + '_' + key : 'T_?_' + (key || 'x');
  // Steps are structured data in the meta header (a custom block, NOT a markdown
  // table), so each action / expected can hold arbitrary markdown - pipes,
  // backslashes, multiple lines. Older docs kept them in a table; still read those.
  let steps: TestStep[] = [];
  if (Array.isArray(meta && meta.steps)) {
    // Straight out of the meta JSON, so a step is whatever the author wrote -
    // hence AuthoredStep's all-optional fields and the alias hunt below.
    steps = meta.steps.map(s => ({
      action: (s && s.action) || '',
      expected: (s && (s.expected || s['expected-response'] || s.response)) || ''
    })).filter(s => s.action || s.expected);
  } else {
    for (const row of table.rows) {
      const action = pick(row, ['action', 'step', 'request', 'do', 'when']);
      const expected = pick(row, ['expected-response', 'expected', 'response', 'result', 'then']);
      if (!action && !expected) continue;
      steps.push({ action: action, expected: expected });
    }
  }
  // Read once so the array arm can be narrowed: an authored `verifies` is either
  // a list of ids or the older comma-separated string, and only the list form
  // may be mapped.
  const authoredVerifies = meta && meta.verifies;
  const verifiesRaw = Array.isArray(authoredVerifies) ? authoredVerifies.map(String)
                    : splitRefs(meta && (authoredVerifies || meta.verify || ''));
  const rec: TestCaseEntry = {
    id: id, docId: doc.id, component: component, key: key || '',
    name: (meta && meta.name) || key || id,
    steps: steps, verifiesRaw: verifiesRaw, verifies: []
  };
  // Global test index comes from the server (see extractReqGroup note).
  return { kind: 'test', rec: rec, error: error };
}

/**
 * Replace each meta-wrapped region in the raw markdown with a fenced `reqgroup`
 * placeholder (`docId::n`); renderRequirements later swaps each placeholder for
 * its built table. Skips any meta block that is only a literal example inside a
 * fenced code block.
 */
export function preprocessRequirements(body: string, docId: string): string {
  const src = String(body);
  const ranges = fencedRanges(src);
  let n = 0;
  return src.replace(metaBlockRe(), (whole, _json, _inner, offset) => {
    if (inFence(ranges, offset)) return whole;   // leave a literal example untouched
    const key = docId + '::' + (n++);
    return '\n```reqgroup\n' + key + '\n```\n';
  });
}
