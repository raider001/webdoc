// requirements/render.js - build the in-document requirement / test-case tables
// from the parsed block structures, and swap them in for the fenced placeholders
// after sanitize. This is the DOM half of the subsystem. Extracted from
// requirements.js. Reads the shared index/status (./store.js) and the ref
// resolver + id-slugger (./parse.js); renders cell markdown through the engine.
// ---------------------------------------------------------------------------
import { elem } from '../dom.js';
import { html } from '../html.js';
import { renderInline, renderMarkdown } from '../commonmark.js';
import { sanitizeToFragment } from '../sanitize.js';
import { index, testIndex, groupsByDoc, statusOf } from './store.js';
import { resolveReqRef, cssSafe } from './parse.js';
import { warningIcon, playIcon } from '../icons.js';

/** @typedef {import('../requirements.js').RequirementEntry} RequirementEntry */
/** @typedef {import('../editor/widgets.js').TestStep} TestStep */
/** @typedef {import('./parse.js').ReqGroupBlock} ReqGroupBlock */
/** @typedef {import('./parse.js').TestCaseDocBlock} TestCaseDocBlock */

/**
 * INLINE markdown (code / emphasis / links, no block constructs) -> sanitized
 * fragment. For single-line contexts like a requirement description.
 * @param {*} text
 * @returns {DocumentFragment}
 */
export function inlineMarkdown(text) {
  return sanitizeToFragment(renderInline(String(text == null ? '' : text)));
}
/**
 * FULL markdown (paragraphs, lists, code blocks, ...) -> sanitized fragment. Test
 * steps are structured data now, so their action / expected may be any markdown.
 * @param {*} text
 * @returns {DocumentFragment}
 */
export function blockMarkdown(text) {
  return sanitizeToFragment(renderMarkdown(String(text == null ? '' : text)));
}

/** @param {string} composedId - resolved requirement id, assumed present in index @returns {HTMLElement} */
function reqLink(composedId) {
  const rec = index.get(composedId);
  return elem('a', { class: 'req-link', href: '#/' + rec.docId + '?req=' + encodeURIComponent(composedId) }, composedId);
}
/** @param {string} testId - resolved test id, assumed present in testIndex @returns {HTMLElement} */
function testLink(testId) {
  const rec = testIndex.get(testId);
  return elem('a', { class: 'req-link tc-link', href: '#/' + rec.docId + '?test=' + encodeURIComponent(testId) }, testId);
}
/** @param {string} raw - the unresolved reference text @returns {HTMLElement} */
function missingChip(raw) {
  return elem('span', { class: 'req-missing', title: 'Not found: ' + raw }, warningIcon(), ' ' + raw);
}
/** @returns {HTMLElement} the em-dash placeholder for an empty trace cell */
function noneCell() { return elem('span', 'req-none', '—'); }
/**
 * Comma-join a list of nodes for a text-flow cell (a trace list, a Verifies line).
 * @param {Node[]} nodes
 * @param {string} sep
 * @returns {(Node|string)[]}
 */
function joinNodes(nodes, sep) {
  const out = [];
  nodes.forEach((n, i) => { if (i) out.push(sep); out.push(n); });
  return out;
}
/**
 * A trace cell's content: its comma-joined links/chips, or the em-dash placeholder.
 * @param {HTMLElement[]} nodes
 * @returns {(Node|string)[]|HTMLElement}
 */
function traceCell(nodes) { return nodes.length ? joinNodes(nodes, ', ') : noneCell(); }
/** @param {HTMLElement} badge @param {string} id @returns {void} */
function badgeStatus(badge, id) { const s = statusOf(id); if (s) badge.classList.add('req-badge-st-' + s.status); }
/** @param {string} testId @returns {HTMLElement} */
function resultBadge(testId) {
  const st = (statusOf(testId) || {}).status || 'untested';
  const label = st === 'pass' ? 'Pass' : st === 'fail' ? 'Fail' : st === 'partial' ? 'Partial' : 'Untested';
  return elem('span', 'tc-result tc-result-' + st, label);
}

const REQ_HEADERS = ['Requirement', 'Description', 'Trace To', 'Trace From', 'Verified By'];

/**
 * One row: an id badge (coloured by status), inline-markdown description, and
 * three trace cells (raw refs resolved against this row, plain ids for the rest).
 * @param {RequirementEntry} rec
 * @returns {HTMLElement}
 */
function reqRow(rec) {
  const badge = elem('span', 'req-badge', rec.id);
  badgeStatus(badge, rec.id);
  const to = rec.traceTo.map(raw => { const t = resolveReqRef(raw, rec); return t ? reqLink(t) : missingChip(raw); });
  const from = rec.traceFrom.map(id => reqLink(id));
  const verified = (rec.verifiedBy || []).map(id => testLink(id));
  const tr = html`
    <tr>
      <td class="req-idcell">${badge}</td>
      <td>${inlineMarkdown(rec.description)}</td>
      <td>${traceCell(to)}</td>
      <td>${traceCell(from)}</td>
      <td>${traceCell(verified)}</td>
    </tr>
  `.firstElementChild;
  if (rec.component && rec.group) tr.id = 'req-' + cssSafe(rec.id);
  return tr;
}

/**
 * @param {ReqGroupBlock} g
 * @returns {HTMLElement}
 */
function buildReqTable(g) {
  const rows = g.rows.map(reqRow);
  return html`
    <figure class="req-group">
      <figcaption class="req-cap">Requirements — ${g.group}</figcaption>
      ${g.error && html`<p class="req-error">${warningIcon()} ${g.error}</p>`}
      <div class="req-scroll">
        <table class="req-tbl">
          <thead><tr>${REQ_HEADERS.map(h => html`<th>${h}</th>`)}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </figure>
  `.firstElementChild;
}

const TC_HEADERS = ['#', 'Action', 'Expected response'];

/**
 * @param {TestStep} s
 * @param {number} i
 * @returns {DocumentFragment}
 */
function testStepRow(s, i) {
  return html`
    <tr>
      <td class="tc-stepno">${i + 1}</td>
      <td class="tc-md">${blockMarkdown(s.action)}</td>
      <td class="tc-steps tc-md">${blockMarkdown(s.expected)}</td>
    </tr>
  `;
}

/**
 * A test case renders as: a caption (name + id + Result [+ Run]), a "Verifies"
 * line, and the numbered action / expected-response step table.
 * @param {TestCaseDocBlock} block
 * @returns {HTMLElement}
 */
function buildTestCase(block) {
  const rec = block.rec;
  const runBtn = (rec.component && rec.key) && elem('button', {
    type: 'button', class: 'tc-run', title: 'Run this test case',
    onClick: () => document.dispatchEvent(new CustomEvent('webdoc:run-test', { detail: { testId: rec.id } }))
  }, playIcon(), 'Run');
  const verifies = rec.verifies.length ? joinNodes(rec.verifies.map(id => reqLink(id)), ', ') : noneCell();

  const fig = html`
    <figure class="req-group test-case">
      <figcaption class="req-cap tc-cap">Test case — ${rec.name} <span class="tc-id">${rec.id}</span>${resultBadge(rec.id)}${runBtn}</figcaption>
      ${block.error && html`<p class="req-error">${warningIcon()} ${block.error}</p>`}
      <p class="tc-verifies">Verifies: ${verifies}</p>
      <div class="req-scroll">
        <table class="req-tbl test-steps-tbl">
          <thead><tr>${TC_HEADERS.map(h => html`<th>${h}</th>`)}</tr></thead>
          <tbody>${rec.steps.map(testStepRow)}</tbody>
        </table>
      </div>
    </figure>
  `.firstElementChild;
  if (rec.component && rec.key) fig.id = 'test-' + cssSafe(rec.id);
  return fig;
}

/**
 * Replace each reqgroup placeholder with its built table (post-sanitize).
 * @param {Element} article
 * @param {string} docId
 * @returns {void}
 */
export function renderRequirements(article, docId) {
  article.querySelectorAll('pre > code.language-reqgroup').forEach(code => {
    const pre = code.parentElement;
    const key = code.textContent.trim();
    const sep = key.indexOf('::');
    const dId = sep >= 0 ? key.slice(0, sep) : docId;
    const n = sep >= 0 ? parseInt(key.slice(sep + 2), 10) : 0;
    const blocks = groupsByDoc.get(dId);
    const g = blocks && blocks[n];
    if (!g) { pre.remove(); return; }
    pre.replaceWith(g.kind === 'test' ? buildTestCase(g) : buildReqTable(g));
  });
}
