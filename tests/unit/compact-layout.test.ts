import { afterEach, expect, it, vi } from 'vitest';
import { buildModel, layoutGraph } from '/js/graph/layout.js';
import { compactLeafRuns } from '/js/graph/compact.js';
import { LO } from '/js/graph/util.js';
import { createGraphController, type GraphTestApi, type GraphInputDoc } from '/js/graph.js';
import { compactLayoutPreferenceKey, readCompactLayoutPreference, writeSelectedTreePreference } from '/js/graph/selected-tree.js';

const fan = (n = 40): GraphInputDoc[] => [{ id: 'parent', next: Array.from({ length: n }, (_, i) => 'leaf-' + String(i).padStart(2, '0')) }, ...Array.from({ length: n }, (_, i) => ({ id: 'leaf-' + String(i).padStart(2, '0') }))];
const layouts = (n = 40) => { const model = buildModel(fan(n)), list = [...model.nodes.values()]; return { model, normal: layoutGraph(list, model.edges), compact: layoutGraph(list, model.edges, { compact: true, aspectRatio: 1.4 }) }; };
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('wraps 40 leaves into several columns, reduces height and preserves column-major reading order', () => {
  const { normal, compact } = layouts();
  const original = [...normal.nodes.values()].filter(n => n.id !== 'parent').sort((a, b) => a.y - b.y);
  const ordered = [...compact.nodes.values()].filter(n => n.id !== 'parent').sort((a, b) => a.x - b.x || a.y - b.y);
  expect(new Set(ordered.map(n => n.x)).size).toBeGreaterThan(2); expect(compact.height).toBeLessThan(normal.height / 2);
  expect(ordered.map(n => n.id)).toEqual(original.map(n => n.id)); expect(compact.nodes.get('parent')!.x).toBe(normal.nodes.get('parent')!.x);
  for (const a of compact.nodes.values()) for (const b of compact.nodes.values()) if (a.id !== b.id) expect(overlap(a, b)).toBe(false);
});

it('uses existing node sizes/gaps and routes each leaf edge around all other leaf boxes', () => {
  const { compact } = layouts();
  for (const n of compact.nodes.values()) { expect(n.w).toBe(LO.nodeW); expect(n.h).toBe(LO.nodeH); }
  // Routes are orthogonal gutter segments, with the last segment entering its own leaf.
  for (const e of compact.edges) {
    expect(e.points.at(-1)).toEqual({ x: compact.nodes.get(e.to)!.x, y: compact.nodes.get(e.to)!.cy });
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], b = e.points[i]; expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const n of compact.nodes.values()) if (n.id !== e.from && n.id !== e.to) {
        const hits = a.x === b.x ? a.x > n.x && a.x < n.x + n.w && Math.min(a.y, b.y) < n.y + n.h && Math.max(a.y, b.y) > n.y
          : a.y > n.y && a.y < n.y + n.h && Math.min(a.x, b.x) < n.x + n.w && Math.max(a.x, b.x) > n.x;
        expect(hits).toBe(false);
      }
    }
  }
});

it('closes the gap below a fan and never moves non-leaves sideways, including ancestors', () => {
  const docs = [{ id: 'ancestor', next: ['parent'] }, ...fan(), { id: 'z-below', next: ['z-last'] }, { id: 'z-last' }];
  const model = buildModel(docs), normal = layoutGraph([...model.nodes.values()], model.edges), compact = layoutGraph([...model.nodes.values()], model.edges, { compact: true });
  expect(compact.nodes.get('z-below')!.y).toBeLessThan(normal.nodes.get('z-below')!.y);
  for (const id of ['ancestor', 'parent', 'z-below']) expect(compact.nodes.get(id)!.x).toBe(normal.nodes.get(id)!.x);
  expect(compact.height).toBeLessThan(normal.height);
});

it('uses vertical contour packing when a shallow sibling occupies the parents column', () => {
  const docs = [{ id: 'root', next: ['parent', 'shallow-sibling'] }, ...fan(), { id: 'shallow-sibling' }];
  const model = buildModel(docs), normal = layoutGraph([...model.nodes.values()], model.edges), compact = layoutGraph([...model.nodes.values()], model.edges, { compact: true });
  expect(compact.height).toBeLessThan(normal.height / 2);
  for (const id of ['root', 'parent', 'shallow-sibling']) expect(compact.nodes.get(id)!.x).toBe(normal.nodes.get(id)!.x);
  const parent = compact.nodes.get('parent')!, sibling = compact.nodes.get('shallow-sibling')!;
  expect(Math.abs(parent.cy - sibling.cy)).toBeGreaterThanOrEqual(LO.nodeH + LO.vGap);
  for (const a of compact.nodes.values()) for (const b of compact.nodes.values()) if (a.id !== b.id) expect(overlap(a, b)).toBe(false);
  const original = [...normal.nodes.values()].filter(n => n.id.startsWith('leaf-')).sort((a, b) => a.y - b.y);
  expect([...compact.nodes.values()].filter(n => n.id.startsWith('leaf-')).sort((a, b) => a.x - b.x || a.y - b.y).map(n => n.id)).toEqual(original.map(n => n.id));
});

it('handles a large fan without per-edge scans of all siblings', () => {
  const { normal, compact } = layouts(2000);
  expect(compact.nodes.size).toBe(2001); expect(compact.edges).toHaveLength(2000); expect(compact.height).toBeLessThan(normal.height / 8);
});

it('leaves short runs and shared or non-leaf children unchanged', () => {
  const short = layouts(5); expect(short.compact.nodes).toEqual(short.normal.nodes);
  const docs = fan(); docs.push({ id: 'other', next: ['leaf-00'] }, { id: 'descendant' }); docs[1].next = ['descendant'];
  const model = buildModel(docs), normal = layoutGraph([...model.nodes.values()], model.edges), compact = layoutGraph([...model.nodes.values()], model.edges, { compact: true });
  expect(compact.nodes.get('leaf-00')!.x).toBe(normal.nodes.get('leaf-00')!.x);
});

it('a subtree to the right blocks wrapping even when some individual grid slots would fit', () => {
  const { model, normal } = layouts();
  const nodes = new Map(normal.nodes), leaf = nodes.get('leaf-00')!;
  nodes.set('blocker', { ...leaf, id: 'blocker', x: leaf.x + LO.nodeW + LO.hGap, cx: leaf.cx + LO.nodeW + LO.hGap, y: leaf.y + 200, cy: leaf.cy + 200 });
  const input = { ...normal, nodes, width: leaf.x + 2 * LO.nodeW + LO.hGap };
  expect(compactLeafRuns(input, model.edges, { ...LO, compact: true })).toBe(input);
});

it('foreign traces/edges in the wrapping corridor block the run', () => {
  const { model, normal } = layouts();
  const nodes = new Map(normal.nodes), leaf = nodes.get('leaf-00')!;
  nodes.set('outside-a', { ...leaf, id: 'outside-a', x: 0, cx: LO.nodeW / 2, y: leaf.y + 100, cy: leaf.cy + 100 });
  nodes.set('outside-b', { ...leaf, id: 'outside-b', x: 1800, cx: 1800 + LO.nodeW / 2, y: leaf.y + 100, cy: leaf.cy + 100 });
  const input = { ...normal, nodes, width: 2010 };
  expect(compactLeafRuns(input, model.edges, { ...LO, obstacleEdges: [{ from: 'outside-a', to: 'outside-b' }] })).toBe(input);
});

it('chooses fewer columns in a narrow viewport and memoizes compact/off layouts separately', () => {
  const { model, normal, compact } = layouts();
  const narrow = layoutGraph([...model.nodes.values()], model.edges, { compact: true, aspectRatio: 0.475 });
  expect(narrow.width).toBeLessThan(compact.width); expect(narrow.height).toBeGreaterThan(compact.height);
  expect(layoutGraph([...model.nodes.values()], model.edges).nodes).toEqual(normal.nodes);
  expect(normal.nodes.get('leaf-39')!.x).toBe(normal.nodes.get('leaf-00')!.x);
});

it('defaults on, persists the opt-out per site and tolerates unavailable storage', () => {
  const one = compactLayoutPreferenceKey({ siteTitle: 'One' }, location.origin), two = compactLayoutPreferenceKey({ siteTitle: 'Two' }, location.origin);
  expect(readCompactLayoutPreference(one)).toBe(true); writeSelectedTreePreference(one, false);
  expect(readCompactLayoutPreference(one)).toBe(false); expect(readCompactLayoutPreference(two)).toBe(true);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); }); expect(readCompactLayoutPreference(one)).toBe(true);
});

it('keeps the compacted positions and camera unchanged on background data updates', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return new Proxy({ canvas: this, globalAlpha: 1, measureText: (s: string) => ({ width: s.length * 7 }) }, { get: (t, key) => key in t ? t[key as keyof typeof t] : () => {} }) as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1120, bottom: 800, width: 1120, height: 800, toJSON() {} });
  const host = document.createElement('div'); document.body.appendChild(host);
  const controller = createGraphController(host, fan(), { compactLayout: true, currentId: 'parent', initialTransform: { tx: 30, ty: 40, k: 0.7 } });
  try {
    const graph = (window as unknown as { __graph: GraphTestApi }).__graph, before = graph.nodePositions();
    expect(new Set(Object.values(before).map(n => n.x)).size).toBeGreaterThan(3);
    const docs = fan(); docs[0].title = 'Changed'; controller.updateData(docs, {});
    expect(graph.nodePositions()).toEqual(before); expect(controller.getTransform()).toEqual({ tx: 30, ty: 40, k: 0.7 });
    docs.push({ id: 'new-leaf' }); docs[0].next!.push('new-leaf'); controller.updateData(docs, {});
    for (const [id, position] of Object.entries(before)) expect(graph.nodePositions()[id]).toEqual(position);
  } finally { controller.destroy(); host.remove(); }
});
