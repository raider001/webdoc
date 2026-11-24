import { describe, it, expect, afterEach, vi } from 'vitest';
import { selectedTreeModel, selectedTreeModelAsync, selectedTreePreferenceKey, readSelectedTreePreference, writeSelectedTreePreference } from '/js/graph/selected-tree.js';
import { buildModel } from '/js/graph.js';
import type { GraphModel, GraphDocNode } from '/js/graph-model.js';

const doc = (id: string, assumes: string[] = [], next: string[] = []): GraphDocNode => ({ id, title: id, description: '', assumes, next, groups: [], locked: false, ownsAccess: false });
const model = (): GraphModel => ({ docs: [doc('s', ['a', 'a'], ['b']), doc('a', ['p']), doc('p', [], ['b', 'extra']), doc('b', ['unrelated'], ['c']), doc('c'), doc('r', [], ['r2']), doc('r2'), doc('q', ['q2']), doc('q2'), doc('incoming'), doc('extra'), doc('unrelated')],
  traceEdges: [{ from: 's', to: 'r' }, { from: 'incoming', to: 's' }, { from: 'r', to: 'r2' }, { from: 'a', to: 'b' }],
  pageLinks: [{ from: 's', to: 'q' }, { from: 'q', to: 'q2' }, { from: 's', to: 'ext:one' }, { from: 'q', to: 'ext:two' }],
  externalNodes: [{ id: 'ext:one', url: 'https://example.invalid/one' }, { id: 'ext:two', url: 'https://example.invalid/two' }], groups: [],
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
describe('selected document tree', () => {
  it('walks the complete assumes upstream and next downstream without mixing directions', () => {
    const subset = selectedTreeModel(model(), 's');
    expect(subset.docs.map(d => d.id)).toEqual(['s', 'a', 'p', 'b', 'c', 'r', 'q', 'incoming']);
    expect(subset.docs.find(d => d.id === 'p')!.next).toEqual([]);
    expect(subset.docs.find(d => d.id === 'b')!.assumes).toEqual([]);
    expect(buildModel(subset.docs).edges).toEqual(expect.arrayContaining([{ from: 'p', to: 'a', type: 'prereq' }, { from: 'a', to: 's', type: 'prereq' }, { from: 's', to: 'b', type: 'recnext' }, { from: 'b', to: 'c', type: 'recnext' }]));
    expect(buildModel(subset.docs).edges).toHaveLength(4);
  });
  it('keeps only incoming/outgoing one-hop requirement and page traces', () => {
    const subset = selectedTreeModel(model(), 's');
    expect(subset.traceEdges).toEqual([{ from: 's', to: 'r' }, { from: 'incoming', to: 's' }]);
    expect(subset.pageLinks).toEqual([{ from: 's', to: 'q' }, { from: 's', to: 'ext:one' }]);
    expect(subset.externalNodes.map(n => n.id)).toEqual(['ext:one']);
    expect(subset.docs.find(d => d.id === 'r')!.next).toEqual([]);
    expect(subset.docs.find(d => d.id === 'q')!.assumes).toEqual([]);
  });
  it('retains incoming page links too, while excluding edges between other visible pages', () => {
    const input = model(); input.pageLinks.push({ from: 'incoming', to: 's' }, { from: 'a', to: 'b' });
    expect(selectedTreeModel(input, 's').pageLinks).toContainEqual({ from: 'incoming', to: 's' });
    expect(selectedTreeModel(input, 's').pageLinks).not.toContainEqual({ from: 'a', to: 'b' });
  });
  it('handles cycles, self references and missing hierarchy targets without recursion', () => {
    const input = model(); input.docs[1].assumes = ['s', 'missing']; input.docs[3].next = ['s', 'b'];
    input.traceEdges.push({ from: 's', to: 'absent' }); input.pageLinks.push({ from: 'absent', to: 's' });
    const subset = selectedTreeModel(input, 's'), built = buildModel(subset.docs);
    expect(built.nodes.get('missing')?.missing).toBe(true); expect(built.selfLoops).toEqual([{ id: 'b', type: 'recnext' }]);
    expect(subset.traceEdges.some(e => e.to === 'absent')).toBe(false); expect(subset.pageLinks.some(e => e.from === 'absent')).toBe(false);
  });
  it('deduplicates nodes, relationships and direct edges while preserving first order and the original model', () => {
    const input = model(); input.docs.push(doc('s', ['unrelated'])); input.traceEdges.push({ from: 's', to: 'r' }); input.pageLinks.push({ from: 's', to: 'q' });
    const before = JSON.stringify(input), subset = selectedTreeModel(input, 's');
    expect(subset.docs.filter(d => d.id === 's')).toHaveLength(1); expect(subset.docs[0].assumes).toEqual(['a']);
    expect(subset.traceEdges.filter(e => e.to === 'r')).toHaveLength(1); expect(subset.pageLinks.filter(e => e.to === 'q')).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('returns the full model for a cleared or unavailable selection', () => {
    const input = model(); expect(selectedTreeModel(input, null)).toBe(input); expect(selectedTreeModel(input, 'unknown')).toBe(input);
  });
  it('handles a 25,000-page chain with no recursion or repeated queue shifts', () => {
    const docs = Array.from({ length: 25000 }, (_, i) => doc(String(i), i ? [String(i - 1)] : [], i < 24999 ? [String(i + 1)] : []));
    const subset = selectedTreeModel({ ...model(), docs, traceEdges: [], pageLinks: [], externalNodes: [] }, '12500');
    expect(subset.docs).toHaveLength(25000); expect(subset.docs[0].id).toBe('0'); expect(subset.docs.at(-1)!.id).toBe('24999');
  });
  it('yields and cancels a stale large selection, and gives the same result asynchronously', async () => {
    const input = { ...model(), docs: Array.from({ length: 5000 }, (_, i) => doc(String(i), i ? [String(i - 1)] : [])) };
    const abort = new AbortController(), pending = selectedTreeModelAsync(input, '4999', abort.signal); abort.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
    await expect(selectedTreeModelAsync(model(), 's', new AbortController().signal)).resolves.toEqual(selectedTreeModel(model(), 's'));
  });
});
describe('per-site selected-tree preference', () => {
  it('defaults off, persists toggles and distinguishes sites sharing one origin', () => {
    const one = selectedTreePreferenceKey({ siteTitle: 'One', sources: [{ name: 'Docs', url: '/docs/Docs' }] }, 'http://localhost:8791');
    const two = selectedTreePreferenceKey({ siteTitle: 'Two', sources: [{ name: 'Docs', url: '/docs/Docs' }] }, 'http://localhost:8791');
    expect(readSelectedTreePreference(one)).toBe(false); writeSelectedTreePreference(one, true);
    expect(readSelectedTreePreference(one)).toBe(true); expect(readSelectedTreePreference(two)).toBe(false);
    writeSelectedTreePreference(one, false); expect(readSelectedTreePreference(one)).toBe(false);
  });
  it('ignores source ordering and safely handles unavailable storage', () => {
    const a = { name: 'A', url: '/docs/A' }, b = { name: 'B', url: '/docs/B' };
    expect(selectedTreePreferenceKey({ sources: [a, b] }, 'same')).toBe(selectedTreePreferenceKey({ sources: [b, a] }, 'same'));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); }); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
    expect(readSelectedTreePreference('any')).toBe(false); expect(() => writeSelectedTreePreference('any', true)).not.toThrow();
  });
});
