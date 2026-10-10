import type { GraphModel, GraphDocNode } from '../graph-model.js';

/** Only walked hierarchy edges and traces touching the centre belong in the subset. */
function* selectedTreeSteps(model: GraphModel, selectedId: string | null): Generator<void, GraphModel, void> {
  if (!selectedId) return model;
  let work = 0;
  const byId = new Map<string, GraphDocNode>();
  for (const doc of model.docs) {
    if (!byId.has(doc.id)) byId.set(doc.id, doc);
    if (++work % 1024 === 0) yield;
  }
  if (!byId.has(selectedId)) return model;
  const included = new Set([selectedId]);
  const hierarchy = { assumes: new Map<string, Set<string>>(), next: new Map<string, Set<string>>() };
  for (const field of ['assumes', 'next'] as const) {
    const visited = new Set([selectedId]), queue = [selectedId];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor], doc = byId.get(id);
      const targets = new Set<string>();
      for (const target of doc?.[field] || []) {
        if (typeof target === 'string' && target) {
          targets.add(target); included.add(target);
          if (!visited.has(target)) { visited.add(target); queue.push(target); }
        }
        if (++work % 1024 === 0) yield;
      }
      hierarchy[field].set(id, targets);
      if (++work % 1024 === 0) yield;
    }
  }
  const externals = new Map(model.externalNodes.map(node => [node.id, node]));
  const traces: GraphModel['traceEdges'] = [], links: GraphModel['pageLinks'] = [];
  for (const [input, output] of [[model.traceEdges, traces], [model.pageLinks, links]]) {
    const seen = new Set<string>();
    for (const edge of input) {
      if ((edge.from === selectedId || edge.to === selectedId) &&
          (byId.has(edge.from) || externals.has(edge.from)) && (byId.has(edge.to) || externals.has(edge.to))) {
        const key = JSON.stringify([edge.from, edge.to]);
        if (!seen.has(key)) { seen.add(key); output.push(edge); included.add(edge.from); included.add(edge.to); }
      }
      if (++work % 1024 === 0) yield;
    }
  }
  const docs: GraphDocNode[] = [];
  for (const doc of byId.values()) {
    if (included.has(doc.id)) docs.push({ ...doc,
      assumes: [...(hierarchy.assumes.get(doc.id) || [])], next: [...(hierarchy.next.get(doc.id) || [])],
    });
    if (++work % 1024 === 0) yield;
  }
  return { ...model, docs, traceEdges: traces, pageLinks: links,
    externalNodes: [...externals.values()].filter(node => included.has(node.id)),
  };
}

/** Deterministic, nonrecursive O(nodes + edges) computation, also useful in unit tests. */
export function selectedTreeModel(model: GraphModel, selectedId: string | null): GraphModel {
  const steps = selectedTreeSteps(model, selectedId);
  let result = steps.next(); while (!result.done) result = steps.next(); return result.value;
}

/** Yield between batches; a newer selection can abort without painting a stale subset. */
export async function selectedTreeModelAsync(model: GraphModel, selectedId: string | null, signal: AbortSignal): Promise<GraphModel> {
  const steps = selectedTreeSteps(model, selectedId);
  while (true) {
    signal.throwIfAborted();
    const result = steps.next(); if (result.done) return result.value;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

/** A site has its own preference even when another corpus uses the same origin. */
export function selectedTreePreferenceKey(site: { siteTitle?: string; sources?: { name: string; url?: string }[] } | null, origin: string): string {
  const sources = (site?.sources || []).map(source => [source.name, source.url || '']).sort((a, b) => a[0].localeCompare(b[0]));
  return 'wd-map-selected-tree:' + JSON.stringify([origin, site?.siteTitle || '', sources]);
}
export function readSelectedTreePreference(key: string): boolean {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}
export function writeSelectedTreePreference(key: string, enabled: boolean): void {
  try { localStorage.setItem(key, String(enabled)); } catch { /* optional persistence */ }
}
