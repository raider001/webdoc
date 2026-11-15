import { mount, unmount } from 'svelte';
import RunnerOverlay from '../RunnerOverlay.svelte';
import type { CoverageResults } from '/js/coverage.js';
import type { TestCaseEntry } from '/js/requirements.js';
import type { SourceConfig } from '/js/catalog.js';
export interface RunnerOpts {
  tests: TestCaseEntry[];
  results: CoverageResults;
  sources: SourceConfig[];
  onSaved: () => void;
  onClose: () => void;
}

/**
 * The full-screen test runner.
 * @param target - <body>; the overlay is fixed-position, so this is
 *   only about where the host node lives
 */
export function mountRunner(target: Element, opts: RunnerOpts): { destroy: () => void } {
  const node = document.createElement('div');
  node.className = 'wd-mounted';
  target.appendChild(node);
  const instance = mount(RunnerOverlay, {
    target: node,
    props: {
      tests: opts.tests,
      results: opts.results,
      sources: opts.sources,
      onSaved: opts.onSaved,
      onClose: opts.onClose,
    },
  });
  // The code that created the node is the code that removes it - the discipline
  // app/js/islands.js exists to impose.
  return { destroy: () => { unmount(instance); node.remove(); } };
}
