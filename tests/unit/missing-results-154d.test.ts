import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { loadResults, combinedStatus } from '/js/coverage.js';
import { setReadOnly } from '/js/policy.js';
import { index, testIndex, setCoverageStatus } from '/js/requirements/store.js';
import { covStatus, startCoverageSync } from '../../app/svelte/stores/coverage.svelte.js';
import CoverageOverlay from '../../app/svelte/CoverageOverlay.svelte';
import TestCase from '../../app/svelte/TestCase.svelte';
import type { RequirementEntry, TestCaseEntry } from '/js/requirements.js';

const graph = vi.hoisted(() => vi.fn((_node: HTMLElement, _docs: { id: string }[]) => ({
  setStatus: vi.fn(), setStatusFilter: vi.fn(), destroy: vi.fn(),
  getTransform: () => ({ tx: 0, ty: 0, k: 1 }),
})));
vi.mock('/js/graph.js', () => ({ createGraph: graph }));

const source = { name: 'Open', url: '/docs/Open/', component: 'D', testResults: '/api/results/Open' };
const test = { id: 'T_D_one', name: 'One', docId: 'Open/overview', component: 'D', key: 'one', steps: [], verifies: [] } as unknown as TestCaseEntry;
const empty = { auto: {}, manual: {}, autoCatalog: [], autoLinks: {} };

afterEach(() => {
  cleanup(); index.clear(); testIndex.clear(); setReadOnly(false);
  setCoverageStatus(null); graph.mockClear(); vi.unstubAllGlobals();
});

describe.each([true, false])('no results with readOnly=%s', readOnly => {
  it.each(['404', 'empty', 'network failure'])('loads neutral coverage for an optional %s feed', async kind => {
    setReadOnly(readOnly);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === source.testResults) {
        if (kind === 'network failure') throw new TypeError('unavailable');
        return new Response(kind === '404' ? '{}' : '<testsuite/>', { status: kind === '404' ? 404 : 200 });
      }
      return new Response(url.startsWith('/api/xml/') ? '[]' : '{}');
    }));
    const results = await loadResults([source]);
    expect(results).toEqual(empty);
    expect(combinedStatus([], [test], results).get(test.id)?.status).toBe('untested');
  });

  it.each([true, false])('opens coverage without a reactive loop (has requirements=%s)', async hasRequirements => {
    setReadOnly(readOnly);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    testIndex.set(test.id, test);
    if (hasRequirements) index.set('R_D_one', {
      id: 'R_D_one', docId: test.docId, description: 'One requirement', traceFrom: [], verifiedBy: [test.id],
    } as unknown as RequirementEntry);
    // Reading-view islands subscribe before the coverage overlay opens.
    startCoverageSync();
    const badge = render(TestCase, { block: { kind: 'test', rec: test, error: null } });
    const before = covStatus.version;
    render(CoverageOverlay, { results: empty, onResults: vi.fn(), onExport: vi.fn(), onClose: vi.fn() });
    flushSync();
    await waitFor(() => expect(graph).toHaveBeenCalledOnce());
    flushSync();
    expect(covStatus.version - before).toBe(1);
    expect(graph.mock.calls[0][1].map((node: { id: string }) => node.id)).toContain(test.id);
    expect(graph.mock.results[0].value.setStatus).toHaveBeenCalled();
    expect(badge.container.querySelector('.tc-result')?.textContent).toBe('Untested');
    // Results arriving after reader boot still update its existing badge.
    setCoverageStatus(combinedStatus([], [test], {
      ...empty, auto: { [test.id]: [{ name: 'test_one', pass: true, message: '' }] },
    }));
    flushSync();
    expect(badge.container.querySelector('.tc-result')?.textContent).toBe('Pass');
    expect(covStatus.version - before).toBe(2);
  });
});
