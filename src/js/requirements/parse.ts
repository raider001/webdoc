// requirements/parse.ts - turn a document's RAW markdown into requirement-group
// and test-case block structures, and resolve requirement references. This is
// the extraction half of the subsystem (no DOM): it finds the meta-wrapped
// tables, parses their pipe rows, composes R_/T_ ids, and rewrites each meta
// region to a fenced `reqgroup` placeholder the parser emits. Extracted from
// requirements.js. Reads the requirement index (from ./store.js) for ref
// resolution; imports nothing else.
// ---------------------------------------------------------------------------
import { index } from './store.js';
import { scanMetaBlocks, replaceMetaBlocks } from '../meta-blocks.js';

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

/** Safe DOM id for requirement and test links. */
export function cssSafe(id: unknown): string { return String(id).replace(/[^A-Za-z0-9_-]/g, '-'); }
function splitRefs(raw: string | null): string[] { return raw ? [...new Set(String(raw).split(',').map(s => s.trim()).filter(Boolean))] : []; }

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
  for (const block of scanMetaBlocks(body).filter(b => !b.widget)) {
    const meta = block.error ? null : block.options as BlockMeta;
    const table = parseTable(body.slice(block.innerStart, block.innerEnd));
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
      // `group` is empty when the meta header was absent or unnamed - `error`
      // above already records that; the record's own field stays a string.
      id: id, docId: doc.id, component: component, group: group || '', no: no,
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
  // Read once so the array arm can be narrowed, exactly as `verifies` is below:
  // testing `meta && meta.steps` proves nothing about a property re-read after.
  const authoredSteps = meta && meta.steps;
  let steps: TestStep[] = [];
  if (Array.isArray(authoredSteps)) {
    // Straight out of the meta JSON, so a step is whatever the author wrote -
    // hence AuthoredStep's all-optional fields and the alias hunt below.
    steps = authoredSteps.map(s => ({
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
  const verifiesRaw = Array.isArray(authoredVerifies) ? [...new Set(authoredVerifies.map(String))]
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
  return replaceMetaBlocks(src, scanMetaBlocks(src).filter(b => !b.widget), (_block, n) => {
    const key = docId + '::' + n;
    return '\n```reqgroup\n' + key + '\n```\n';
  });
}
