import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGraphController, type GraphController, type GraphTestApi } from '/js/graph.js';
import { ensureGraphModel, invalidateGraphModel } from '/js/graph-model.js';
import { buildModel, layoutGraph } from '/js/graph/layout.js';
import { reconcileLayout } from '/js/graph/update.js';

let controller: GraphController | undefined;
const hook = () => (window as unknown as { __graph: GraphTestApi }).__graph;
const docs = () => [{ id: 's', title: 'Selected', assumes: ['a'], next: ['b'] }, { id: 'a' }, { id: 'b' }];
const data = { traceEdges: [], pageLinks: [], externalNodes: [] };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return new Proxy({ canvas: this, measureText: (text: string) => ({ width: text.length * 7 }), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} }) as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1120, bottom: 800, width: 1120, height: 800, toJSON() {} });
  document.body.innerHTML = '<div id="graph"></div>';
  invalidateGraphModel();
});
afterEach(() => { controller?.destroy(); controller = undefined; invalidateGraphModel(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it.each(['metadata', 'addition', 'rewrite'])('keeps the real canvas, camera, selection, filters and positions on a %s update', kind => {
  controller = createGraphController(document.getElementById('graph')!, docs(), { currentId: 's', initialTransform: { tx: 315, ty: -120, k: 1.75 } });
  controller.setVisibility('trace', false); controller.setHiddenGroups(['private']); controller.setEditMode(true); controller.setConnector('prereq');
  const previous = hook(), canvas = document.querySelector('canvas')!, positions = previous.nodePositions(), state = controller.getEditState();
  canvas.tabIndex = 0; canvas.focus();
  const updated = docs(); if (kind === 'metadata') updated[0].title = 'Updated title';
  if (kind === 'addition') { updated.push({ id: 'new' }); updated[0].next!.push('new'); }
  expect(controller.updateData(updated, data)).toBe(kind === 'addition');
  expect(hook()).toBe(previous); expect(document.querySelector('canvas')).toBe(canvas); expect(document.activeElement).toBe(canvas);
  expect(controller.getTransform()).toEqual({ tx: 315, ty: -120, k: 1.75 }); expect(controller.getEditState()).toEqual(state);
  for (const [id, position] of Object.entries(positions)) expect(hook().nodePositions()[id]).toEqual(position);
  if (kind === 'addition') expect(hook().nodePositions().new).toBeTruthy();
  expect(hook().state().currentId).toBe('s');
});

it('draws fresh titles without a new layout and preserves the selected highlight and hover', () => {
  // A persistent context lets this assertion inspect the real renderer's draw calls.
  const fillText = vi.fn(), stroke = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({ fillText, stroke, measureText: (t: string) => ({ width: t.length * 7 }) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} }) as unknown as CanvasRenderingContext2D);
  controller = createGraphController(document.getElementById('graph')!, docs(), { currentId: 's', initialTransform: { tx: 10, ty: 20, k: 1 } });
  const positions = hook().nodePositions(), updated = docs(); updated[0].title = 'Fresh label';
  const centre = hook().center('s')!;
  document.querySelector('canvas')!.dispatchEvent(new MouseEvent('pointermove', { clientX: centre.x, clientY: centre.y, bubbles: true }));
  expect(hook().state().hoverId).toBe('s');
  expect(controller.updateData(updated, data)).toBe(false); hook().redraw();
  expect(fillText.mock.calls.some(call => call[0] === 'Fresh label')).toBe(true); expect(hook().nodePositions()).toEqual(positions);
  expect(hook().state().hoverId).toBe('s'); expect(hook().state().currentId).toBe('s');
});

it('retains routes and boxes through cycles, missing targets, removals and a connected new chain', () => {
  const oldModel = buildModel(docs()), old = layoutGraph([...oldModel.nodes.values()], oldModel.edges);
  const model = buildModel([{ id: 's', next: ['new'] }, { id: 'new', next: ['last'] }, { id: 'last', next: ['new', 'missing'] }]);
  const result = reconcileLayout(old, model, new Map(), []);
  expect(result.nodes.get('s')).toBe(old.nodes.get('s')); expect(old.nodes.has('a')).toBe(true); expect(result.nodes.has('a')).toBe(false);
  expect([...result.nodes.keys()].sort()).toEqual(['last', 'missing', 'new', 's']);
  expect(new Set([...result.nodes.values()].map(n => `${n.x},${n.y}`)).size).toBe(4);
  expect(result.edges).toHaveLength(4);
  const expanded = reconcileLayout(old, buildModel([...docs(), { id: 'new', assumes: ['b'] }]), new Map(), []);
  for (const edge of old.edges) expect(expanded.edges.find(e => e.from === edge.from && e.to === edge.to && e.type === edge.type)).toBe(edge);
});

it('does not schedule a repaint for an identical graph after a document body rewrite', () => {
  const fillText = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({ globalAlpha: 1, fillText, measureText: (t: string) => ({ width: t.length * 7 }) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} }) as unknown as CanvasRenderingContext2D);
  controller = createGraphController(document.getElementById('graph')!, docs(), { initialTransform: { tx: 0, ty: 0, k: 1 } });
  const frames = vi.spyOn(window, 'requestAnimationFrame'); frames.mockClear();
  expect(controller.updateData(docs(), data)).toBe(false); expect(frames).not.toHaveBeenCalled();
});

it('fades removed visible nodes, excludes them from hit testing, then drops the ghosts', () => {
  let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  const drawn: { title: string; alpha: number }[] = [];
  const context = { globalAlpha: 1, measureText: (t: string) => ({ width: t.length * 7 }), fillText: (title: string) => drawn.push({ title, alpha: context.globalAlpha }), save() {}, restore() { context.globalAlpha = 1; } };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy(context, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} }) as unknown as CanvasRenderingContext2D);
  controller = createGraphController(document.getElementById('graph')!, [{ id: 's' }, { id: 'removed', title: 'Removed' }], { initialTransform: { tx: 0, ty: 0, k: 1 } });
  const centre = hook().center('removed')!; controller.updateData([{ id: 's' }], data); now += 120;
  drawn.length = 0; hook().redraw(); expect(drawn.find(n => n.title === 'Removed')?.alpha).toBeCloseTo(0.5);
  expect(hook().hitTest(centre.x, centre.y)).toBeNull(); now += 200; hook().redraw(); drawn.length = 0; hook().redraw();
  expect(drawn.some(n => n.title === 'Removed')).toBe(false);
});

it('places a large new chain iteratively without moving its existing neighbour', () => {
  const oldModel = buildModel([{ id: 's' }]), old = layoutGraph([...oldModel.nodes.values()], []);
  const chain = Array.from({ length: 2000 }, (_, i) => ({ id: 'n' + i, assumes: [i ? 'n' + (i - 1) : 's'] }));
  const result = reconcileLayout(old, buildModel([{ id: 's' }, ...chain]), new Map(), []);
  expect(result.nodes.size).toBe(2001); expect(result.nodes.get('s')).toBe(old.nodes.get('s'));
});

it('keeps existing external boxes, removes obsolete nodes and keeps a single controller', () => {
  const external = { traceEdges: [], pageLinks: [{ from: 's', to: 'ext:https://example.test' }], externalNodes: [{ id: 'ext:https://example.test', url: 'https://example.test' }] };
  controller = createGraphController(document.getElementById('graph')!, docs(), { ...external, initialTransform: { tx: 0, ty: 0, k: 1 } });
  const previous = hook(), centre = hook().center(external.externalNodes[0].id);
  controller.updateData([{ id: 's' }, { id: 'new', next: ['s'] }], external);
  expect(hook()).toBe(previous); expect(hook().center(external.externalNodes[0].id)).toEqual(centre); expect(hook().nodePositions().a).toBeUndefined();
});

it('shares concurrent graph requests and caches once per invalidation', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ nodes: [['s', 'Selected', '']] })));
  vi.stubGlobal('fetch', fetcher);
  const result = await Promise.all(Array.from({ length: 30 }, () => ensureGraphModel()));
  expect(fetcher).toHaveBeenCalledTimes(1); expect(result.every(model => model === result[0])).toBe(true);
  await ensureGraphModel(); expect(fetcher).toHaveBeenCalledTimes(1);
  invalidateGraphModel(); await Promise.all([ensureGraphModel(), ensureGraphModel()]); expect(fetcher).toHaveBeenCalledTimes(2);
});

it('cancels on teardown while keeping a request needed by another consumer', async () => {
  let finish!: () => void, requestSignal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url, options) => { requestSignal = options.signal; return new Promise(resolve => { finish = () => resolve(new Response('{"nodes":[]}')); }); }));
  const owner = new AbortController(), first = ensureGraphModel(owner.signal), other = ensureGraphModel();
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' }); owner.abort(); await rejected;
  expect(requestSignal.aborted).toBe(false); finish(); await other;
  invalidateGraphModel(); const last = new AbortController(), waiting = ensureGraphModel(last.signal), assertion = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  last.abort(); await assertion; expect(requestSignal.aborted).toBe(true); finish();
});

it('does not publish a stale in-flight index after a newer version arrives', async () => {
  const requests: (() => void)[] = [];
  const fetcher = vi.fn(() => new Promise(resolve => { const n = requests.length; requests.push(() => resolve(new Response(JSON.stringify({ nodes: [[String(n), 'Title', '']] })))); }));
  vi.stubGlobal('fetch', fetcher);
  const first = ensureGraphModel(); invalidateGraphModel(); const second = ensureGraphModel();
  requests[0](); await new Promise(resolve => setTimeout(resolve, 0)); requests[1]();
  expect((await first).docs[0].id).toBe('1'); expect((await second).docs[0].id).toBe('1'); expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects failed refreshes rather than replacing the map with an empty graph', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
  await expect(ensureGraphModel()).rejects.toThrow('503');
});
