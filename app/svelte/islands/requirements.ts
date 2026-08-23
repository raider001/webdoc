// islands/requirements.ts - the in-document requirement/test mounts.
//
// MOUNT PER BLOCK, WITH A HANDLE, and the opposite discipline to
// islands/reader.ts. The TOC and the breadcrumb live in containers declared in
// app/index.html that outlast every navigation, so they mount once and are
// driven by props. These do not: their hosts are placeholder nodes the Markdown
// pipeline left in the article, and the article is thrown away and rebuilt on
// every route change, on the four-second external-change poll and after every
// runner save. So each mount returns a destroy the caller MUST keep -
// requirements/render.js hands it straight to reader.js's registerMounted, and
// teardownMounted() runs it before the article that contains the host is
// replaced.
//
// That is not bookkeeping for its own sake: detaching a node does not run Svelte
// teardown. A component whose host is merely removed keeps its effects alive
// against DOM nobody can see - here, one badge-repaint effect per requirement
// row, per document ever visited, for the rest of the session.
import { mount, unmount } from 'svelte';
import ReqTable from '../ReqTable.svelte';
import TestCase from '../TestCase.svelte';
import { startCoverageSync } from '../stores/coverage.svelte.js';
import type { ReqGroupBlock, TestCaseDocBlock } from '/js/requirements/parse.js';

/**
 * One requirement group.
 * @param target - a `.wd-mounted` host inside the article
 */
export function mountReqTable(target: Element, block: ReqGroupBlock): { destroy: () => void } {
  // Idempotent, and called from both entry points rather than once at boot: a
  // reader whose first page carries a requirement table must get live badges
  // without the shell having had to predict that. See stores/coverage.svelte.ts.
  startCoverageSync();
  const instance = mount(ReqTable, { target: target, props: { block: block } });
  return { destroy: () => unmount(instance) };
}

/**
 * One test case.
 * @param target - a `.wd-mounted` host inside the article
 */
export function mountTestCase(target: Element, block: TestCaseDocBlock): { destroy: () => void } {
  startCoverageSync();
  const instance = mount(TestCase, { target: target, props: { block: block } });
  return { destroy: () => unmount(instance) };
}
