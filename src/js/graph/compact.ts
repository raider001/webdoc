// Wrap isolated, ordered leaf runs; keep non-leaf columns and use the existing
// vertical contour packing when other branches prevent a simple vertical warp.
import type { GraphLayoutResult, LayoutNode, ModelGraphEdge } from './layout.js';
import type { LayoutOptions } from './util.js';

const EPS = 0.5;
type Point = { x: number; y: number };

/** Reuse contour packing vertically when unrelated columns prevent a global warp. */
function packVertical(nodes: Map<string, LayoutNode>, hierarchy: ModelGraphEdge[], o: LayoutOptions, wrapped: Map<string, string[]>): Map<string, LayoutNode> {
  const parent = new Map<string, string>(), kids = new Map([...nodes.keys()].map(id => [id, [] as string[]]));
  for (const e of hierarchy) {
    if (o.layoutMode && o.layoutMode !== 'all' && e.type !== o.layoutMode) continue;
    const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
    if (a.x >= b.x) continue; // Same/backward layers cannot introduce a forest cycle.
    const old = parent.get(e.to);
    if (!old || a.x > nodes.get(old)!.x) parent.set(e.to, e.from);
  }
  for (const [child, p] of parent) kids.get(p)!.push(child);
  for (const [p, list] of kids) {
    const rank = new Map((wrapped.get(p) || []).map((id, i) => [id, i]));
    list.sort((a, b) => rank.has(a) && rank.has(b) ? rank.get(a)! - rank.get(b)! : nodes.get(a)!.cy - nodes.get(b)!.cy || a.localeCompare(b));
  }
  const roots = [...nodes.keys()].filter(id => !parent.has(id)).sort((a, b) => nodes.get(a)!.cy - nodes.get(b)!.cy || a.localeCompare(b));
  const order = roots.slice(); for (let i = 0; i < order.length; i++) for (const child of kids.get(order[i])!) order.push(child);
  const ys = new Map<string, number>(), contours = new Map<string, { low: Map<number, number>; high: Map<number, number> }>();
  const shift = (id: string, delta: number) => { if (!delta) return; const queue = [id]; for (let i = 0; i < queue.length; i++) { ys.set(queue[i], ys.get(queue[i])! + delta); for (const child of kids.get(queue[i])!) queue.push(child); } };
  const merge = (acc: { low: Map<number, number>; high: Map<number, number> }, child: string) => {
    const c = contours.get(child)!; let dy = -Infinity;
    for (const [x, y] of c.high) if (acc.low.has(x)) dy = Math.max(dy, acc.low.get(x)! + o.nodeH + o.vGap - y);
    if (!Number.isFinite(dy)) dy = 0; shift(child, dy);
    for (const [x, y] of c.low) acc.low.set(x, y + dy);
    for (const [x, y] of c.high) if (!acc.high.has(x)) acc.high.set(x, y + dy);
    contours.delete(child);
  };
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], children = kids.get(id)!, x = nodes.get(id)!.x;
    let contour = { low: new Map<number, number>(), high: new Map<number, number>() }, y = 0;
    if (children.length) {
      contour = contours.get(children[0])!; contours.delete(children[0]);
      for (const child of children.slice(1)) merge(contour, child);
      let low = Infinity, high = -Infinity;
      for (const child of children) { low = Math.min(low, ys.get(child)!); high = Math.max(high, ys.get(child)!); }
      y = (low + high) / 2;
    }
    ys.set(id, y); contour.low.set(x, Math.max(contour.low.get(x) ?? y, y)); contour.high.set(x, Math.min(contour.high.get(x) ?? y, y)); contours.set(id, contour);
  }
  if (roots.length) { const acc = contours.get(roots[0])!; for (const root of roots.slice(1)) merge(acc, root); }
  return new Map([...nodes].map(([id, n]) => { const cy = ys.get(id)!; return [id, { ...n, cy, y: cy - n.h / 2 }]; }));
}

/** Insert warp boundaries before mapping segments, preserving their geometry. */
function warpPoints(points: Point[], top: number, bottom: number, warp: (y: number) => number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    if (i) {
      const b = points[i - 1];
      const cuts = [top, bottom].filter(y => y > Math.min(a.y, b.y) && y < Math.max(a.y, b.y)).sort((x, y) => a.y > b.y ? x - y : y - x);
      for (const y of cuts) out.push({ x: b.x + (a.x - b.x) * (y - b.y) / (a.y - b.y), y: warp(y) });
    }
    out.push({ x: a.x, y: warp(a.y) });
  }
  return out;
}

export function compactLeafRuns(input: GraphLayoutResult, hierarchy: ModelGraphEdge[], o: LayoutOptions): GraphLayoutResult {
  const children = new Map<string, Set<string>>(), parents = new Map<string, Set<string>>();
  for (const e of hierarchy) {
    if (o.layoutMode && o.layoutMode !== 'all' && e.type !== o.layoutMode) continue;
    const kids = children.get(e.from) || new Set<string>(); kids.add(e.to); children.set(e.from, kids);
  }
  // Every hierarchy type counts for leaf/shared-parent safety, even in a filtered layout mode.
  const outgoing = new Set(hierarchy.map(e => e.from));
  for (const e of hierarchy) { const from = parents.get(e.to) || new Set<string>(); from.add(e.from); parents.set(e.to, from); }
  const attached = new Set((o.obstacleEdges || []).flatMap(e => [e.from, e.to]));
  const runs: { parent: string; ids: string[]; top: number }[] = [];
  const ROW = o.nodeH + o.vGap, COL = o.nodeW + o.hGap;
  for (const [parent, kids] of children) {
    const byColumn = new Map<number, LayoutNode[]>();
    for (const id of kids) {
      const n = input.nodes.get(id);
      if (!n || outgoing.has(id) || parents.get(id)?.size !== 1 || attached.has(id)) continue;
      const list = byColumn.get(n.x) || []; list.push(n); byColumn.set(n.x, list);
    }
    for (const list of byColumn.values()) {
      list.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
      let run: LayoutNode[] = [];
      const save = () => { if (run.length >= 6) runs.push({ parent, ids: run.map(n => n.id), top: run[0].y }); };
      for (const n of list) { if (run.length && Math.abs(n.y - run[run.length - 1].y - ROW) > EPS) { save(); run = []; } run.push(n); }
      save();
    }
  }
  runs.sort((a, b) => b.ids.length - a.ids.length || a.top - b.top || a.parent.localeCompare(b.parent));
  let result = input, work = 0;
  const wrapped = new Map<string, string[]>();
  const budget = 2000000;
  const aspect = Math.max(0.35, Math.min(3, o.aspectRatio || 1.4));
  for (const run of runs) {
    if (wrapped.has(run.parent)) continue;
    const leaves = run.ids.map(id => result.nodes.get(id)!);
    if (!leaves.every(n => n.x === leaves[0].x)) continue;
    const parent = result.nodes.get(run.parent)!;
    const first = leaves[0], last = leaves[leaves.length - 1];
    const ids = new Set(run.ids);
    const top = first.cy, bottom = last.cy;
    let preferred = 1, score = Infinity;
    for (let columns = 1; columns <= Math.min(16, Math.floor(leaves.length / 3)); columns++) {
      const height = (Math.ceil(leaves.length / columns) - 1) * ROW + o.nodeH;
      const width = (columns + 1) * COL - o.hGap;
      const fit = Math.abs(Math.log(width / height / aspect));
      if (fit < score) { score = fit; preferred = columns; }
    }
    const availableWidth = Math.max(result.width, first.x + (preferred - 1) * COL + o.nodeW);
    for (let columns = preferred; columns >= 2; columns--) {
      if ((work += result.nodes.size + result.edges.length + (o.obstacleEdges?.length || 0)) > budget) return result;
      const rows = Math.ceil(leaves.length / columns), right = first.x + (columns - 1) * COL + o.nodeW;
      if (right > availableWidth + EPS) continue;
      // Reserve the whole wrapping rectangle, including its upper routing gutter.
      // A subtree/node/foreign edge anywhere to the right blocks this candidate.
      const x0 = parent.x + parent.w, y0 = first.y - o.vGap / 2, y1 = last.y + last.h;
      const intersects = (x: number, y: number, w: number, h: number) => x < right - EPS && x + w > x0 + EPS && y < y1 + EPS && y + h > y0 - EPS;
      if ([...result.nodes.values()].some(n => !ids.has(n.id) && n.id !== run.parent && intersects(n.x, n.y, n.w, n.h))) continue;
      const foreign = result.edges.filter(e => !(e.from === run.parent && ids.has(e.to)));
      const paths = [...foreign.map(e => e.points), ...(o.obstacleEdges || []).flatMap(e => {
        const a = result.nodes.get(e.from), b = result.nodes.get(e.to); return a && b ? [[{ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }]] : [];
      })];
      if (paths.some(points => {
        const xs = points.map(p => p.x), ys = points.map(p => p.y);
        return intersects(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      })) continue;
      const newBottom = top + (rows - 1) * ROW, delta = bottom - newBottom;
      const warp = (y: number) => y < top ? y : y > bottom ? y - delta : top + (y - top) * (newBottom - top) / (bottom - top);
      let nodes = new Map<string, LayoutNode>();
      for (const [id, n] of result.nodes) { const cy = warp(n.cy); nodes.set(id, { ...n, cy, y: cy - n.h / 2 }); }
      leaves.forEach((n, i) => {
        const x = first.x + Math.floor(i / rows) * COL, cy = top + (i % rows) * ROW;
        nodes.set(n.id, { ...n, x, cx: x + n.w / 2, cy, y: cy - n.h / 2 });
      });
      // Fixed-size boxes must still have the original spacing after the vertical warp.
      const crowded = (positions: Map<string, LayoutNode>) => {
        const occupied = new Map<number, LayoutNode[]>();
        positions.forEach(n => { const list = occupied.get(n.x) || []; list.push(n); occupied.set(n.x, list); });
        return [...occupied.values()].some(list => { list.sort((a, b) => a.y - b.y); return list.some((n, i) => i > 0 && n.y < list[i - 1].y + list[i - 1].h + o.vGap - EPS); });
      };
      let packed = false;
      const candidateWrapped = new Map(wrapped); candidateWrapped.set(run.parent, run.ids);
      if (crowded(nodes)) {
        nodes.forEach((n, id) => { n.cy = result.nodes.get(id)!.cy; n.y = n.cy - n.h / 2; });
        nodes = packVertical(nodes, hierarchy, o, candidateWrapped); packed = true;
        if (crowded(nodes)) continue;
      }
      const origin = nodes.get(run.parent)!;
      const groups = new Map<string, { ids: Set<string>; trunkX: number; gutterY: number }>();
      for (const [p, ids] of candidateWrapped) {
        let x = Infinity, y = Infinity;
        for (const id of ids) { const n = nodes.get(id)!; x = Math.min(x, n.x); y = Math.min(y, n.y); }
        groups.set(p, { ids: new Set(ids), trunkX: x - o.hGap / 2, gutterY: y - o.vGap / 2 });
      }
      const edges = result.edges.map(e => {
        const group = groups.get(e.from);
        if (!group?.ids.has(e.to)) {
          if (!packed) return { ...e, points: warpPoints(e.points, top, bottom, warp) };
          const a = nodes.get(e.reversed ? e.to : e.from)!, b = nodes.get(e.reversed ? e.from : e.to)!;
          return { ...e, points: [{ x: a.x + a.w, y: a.cy }, { x: b.x, y: b.cy }] };
        }
        const n = nodes.get(e.to)!, columnX = n.x - o.hGap / 2;
        const origin = nodes.get(e.from)!, { trunkX, gutterY } = group;
        const points = columnX === trunkX
          ? [{ x: origin.x + origin.w, y: origin.cy }, { x: trunkX, y: origin.cy }, { x: trunkX, y: n.cy }, { x: n.x, y: n.cy }]
          : [{ x: origin.x + origin.w, y: origin.cy }, { x: trunkX, y: origin.cy }, { x: trunkX, y: gutterY }, { x: columnX, y: gutterY }, { x: columnX, y: n.cy }, { x: n.x, y: n.cy }];
        return { ...e, points };
      });
      // Contour packing may bring another subtree closer: recheck its new workspace.
      if (packed) {
        const members = run.ids.map(id => nodes.get(id)!), start = Math.min(...members.map(n => n.y)) - o.vGap / 2;
        const end = Math.max(...members.map(n => n.y + n.h));
        const hit = (x: number, y: number, w: number, h: number) => x < right - EPS && x + w > origin.x + origin.w + EPS && y < end + EPS && y + h > start - EPS;
        if ([...nodes.values()].some(n => !ids.has(n.id) && n.id !== run.parent && hit(n.x, n.y, n.w, n.h))) continue;
        if (edges.filter(e => !(e.from === run.parent && ids.has(e.to))).some(e => {
          const xs = e.points.map(p => p.x), ys = e.points.map(p => p.y);
          return hit(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        })) continue;
      }
      // Include the routing gutter in the frame and preserve all spacing tokens.
      let minY = Infinity, width = 0, height = 0;
      nodes.forEach(n => { minY = Math.min(minY, n.y); width = Math.max(width, n.x + n.w); });
      for (const e of edges) for (const p of e.points) minY = Math.min(minY, p.y);
      nodes.forEach(n => { n.y -= minY; n.cy -= minY; height = Math.max(height, n.y + n.h); });
      for (const e of edges) for (const p of e.points) p.y -= minY;
      if (height >= result.height - EPS) continue;
      wrapped.set(run.parent, run.ids);
      result = { nodes, edges, width, height }; break;
    }
  }
  return result;
}
