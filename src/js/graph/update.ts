// Background reconciliation never calls a layout engine or changes the camera.
import { buildModel } from './layout.js';
import type { GraphBuildModel, GraphLayoutResult, LayoutNode } from './layout.js';
import type { GraphBox, GraphContext, GraphInputDoc, GraphOptions } from '../graph.js';
import { borderPoint, refreshScene } from './render.js';
import { LO } from './util.js';

const edgeKey = (e: { from: string; to: string; type?: string }) => JSON.stringify([e.from, e.to, e.type]);
const sameSet = (a: string[], b: string[]) => { const set = new Set(a); return set.size === new Set(b).size && b.every(x => set.has(x)); };

/** Retain all surviving boxes and routes; only place new boxes. Bounded spatial searches. */
export function reconcileLayout(old: GraphLayoutResult, model: GraphBuildModel, external: Map<string, GraphBox>, links: { from: string; to: string }[]): GraphLayoutResult {
  const nodes = new Map<string, LayoutNode>();
  for (const [id, box] of old.nodes) if (model.nodes.has(id)) nodes.set(id, box);
  const boxes = new Map<string, GraphBox>([...nodes, ...external]);
  const cell = LO.nodeW + LO.hGap, grid = new Map<string, GraphBox[]>();
  let bottom = 0;
  const cells = (box: GraphBox) => {
    const keys: string[] = [];
    for (let x = Math.floor((box.x - 16) / cell); x <= Math.floor((box.x + box.w + 16) / cell); x++)
      for (let y = Math.floor((box.y - 16) / cell); y <= Math.floor((box.y + box.h + 16) / cell); y++) keys.push(x + ',' + y);
    return keys;
  };
  const occupy = (box: GraphBox) => { bottom = Math.max(bottom, box.y + box.h); for (const key of cells(box)) { const list = grid.get(key) || []; list.push(box); grid.set(key, list); } };
  boxes.forEach(occupy);
  const neighbours = new Map<string, string[]>();
  for (const e of [...model.edges, ...links]) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) { const list = neighbours.get(a) || []; list.push(b); neighbours.set(a, list); }
  const pending = new Set([...model.nodes.keys()].filter(id => !nodes.has(id)));
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (id: string) => { if (pending.has(id) && !queued.has(id)) { queued.add(id); queue.push(id); } };
  for (const id of boxes.keys()) for (const n of neighbours.get(id) || []) enqueue(n);
  const size = old.nodes.values().next().value || { w: LO.nodeW, h: LO.nodeH };
  const place = (id: string) => {
    const neighbour = (neighbours.get(id) || []).map(n => boxes.get(n)).find(Boolean);
    const baseX = neighbour ? neighbour.x + neighbour.w + LO.hGap : 0;
    const baseY = neighbour ? neighbour.y : bottom + LO.compGap;
    let box: LayoutNode | null = null;
    for (let attempt = 0; attempt < 65; attempt++) {
      const x = Math.max(0, baseX + (attempt % 5) * (size.w + LO.hGap));
      const y = Math.max(0, baseY + Math.floor(attempt / 5) * (size.h + LO.vGap));
      const candidate = { id, x, y, w: size.w, h: size.h, cx: x + size.w / 2, cy: y + size.h / 2 };
      if (!cells(candidate).some(key => (grid.get(key) || []).some(b => x < b.x + b.w + 16 && x + size.w + 16 > b.x && y < b.y + b.h + 16 && y + size.h + 16 > b.y))) { box = candidate; break; }
    }
    if (!box) { const x = baseX, y = bottom + LO.compGap; box = { id, x, y, w: size.w, h: size.h, cx: x + size.w / 2, cy: y + size.h / 2 }; }
    nodes.set(id, box); boxes.set(id, box); occupy(box); pending.delete(id);
    for (const n of neighbours.get(id) || []) enqueue(n);
  };
  let cursor = 0;
  while (pending.size) {
    if (cursor === queue.length) enqueue(pending.values().next().value!);
    place(queue[cursor++]);
  }
  const routes = new Map(old.edges.map(e => [edgeKey(e), e]));
  const edges = model.edges.map(e => {
    const existing = routes.get(edgeKey(e)); if (existing) return existing;
    const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
    return { ...e, reversed: false, head: 'end', points: [borderPoint(a, b.cx, b.cy), borderPoint(b, a.cx, a.cy)] };
  });
  let width = 0, height = 0;
  boxes.forEach(b => { width = Math.max(width, b.x + b.w + 24); height = Math.max(height, b.y + b.h + 24); });
  return { nodes, edges, width, height };
}

export function updateGraphData(g: GraphContext, docs: GraphInputDoc[], data: Pick<GraphOptions, 'traceEdges' | 'pageLinks' | 'externalNodes'>): boolean {
  if (!g.running) return false;
  const model = buildModel(docs), trace = data.traceEdges || [], page = data.pageLinks || [], external = data.externalNodes || [];
  const structural = !sameSet([...g.model.nodes.keys()], [...model.nodes.keys()])
    || !sameSet(g.model.edges.map(edgeKey), model.edges.map(edgeKey))
    || !sameSet(g.model.selfLoops.map(e => JSON.stringify(e)), model.selfLoops.map(e => JSON.stringify(e)))
    || !sameSet(g.traceEdges.map(edgeKey), trace.map(edgeKey)) || !sameSet(g.pageLinks.map(edgeKey), page.map(edgeKey))
    || !sameSet(g.externalNodes.map(e => e.id), external.map(e => e.id));
  const oldModel = g.model;
  const metadataChanged = structural || [...model.nodes].some(([id, n]) => {
    const old = oldModel.nodes.get(id);
    return !old || old.title !== n.title || old.desc !== n.desc || old.missing !== n.missing || old.locked !== n.locked
      || old.groups.length !== n.groups.length || old.groups.some((group, i) => group !== n.groups[i]);
  });
  g.model = model; g.nodeList = [...model.nodes.values()]; g.sortedIds = [...model.nodes.keys()].sort();
  g.traceEdges = trace; g.pageLinks = page; g.externalNodes = external;
  if (structural) {
    const extIds = new Set(external.map(e => e.id));
    const removed = [...g.layout.nodes, ...g.extPos].filter(([id]) => !model.nodes.has(id) && !extIds.has(id));
    g.removedNodes = removed.map(([id, box]) => ({ id, box, meta: oldModel.nodes.get(id) }));
    g.removalStart = performance.now();
    const ext = new Map([...g.extPos].filter(([id]) => extIds.has(id)));
    // Reuse placement for new external boxes too, then keep them out of the document node map.
    const placementModel = { ...model, nodes: new Map(model.nodes) };
    for (const e of external) if (!ext.has(e.id)) placementModel.nodes.set(e.id, { id: e.id, title: e.url, desc: '', missing: false, groups: [], locked: false });
    g.layout = reconcileLayout(g.layout, placementModel, ext, [...trace, ...page]);
    for (const id of extIds) { const box = g.layout.nodes.get(id); if (box) { ext.set(id, box); g.layout.nodes.delete(id); } }
    g.extPos = ext; g.nodePos = id => g.layout.nodes.get(id) || g.extPos.get(id) || null;
    if (g.hoverId && !g.nodePos(g.hoverId)) g.hoverId = null;
    if (g.currentId && !model.nodes.has(g.currentId)) g.currentId = null;
    if (g.focusId && !model.nodes.has(g.focusId)) g.focusId = null;
    if (g.pendingSource && !model.nodes.has(g.pendingSource)) g.pendingSource = null;
    refreshScene(g);
    if (g.selectedEdge && !g.edgeItems.some(e => e.from === g.selectedEdge!.from && e.to === g.selectedEdge!.to && e.type === g.selectedEdge!.type)) g.selectedEdge = null;
  }
  if (metadataChanged) { g.buildMinimap(); g.updateMinimap(); g.requestDraw(); g.emitChange(); }
  return structural;
}
