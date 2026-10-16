import { describe, expect, it, vi } from 'vitest';
import { attachView } from '../../src/js/graph/view.js';
import type { GraphContext, GraphBox } from '../../src/js/graph.js';

function context(): GraphContext {
  const boxes = new Map<string, GraphBox>([
    ['open', { x: 800, y: 800, w: 240, h: 80, cx: 920, cy: 840 }],
    ['near', { x: 1400, y: 800, w: 240, h: 80, cx: 1520, cy: 840 }],
    ['trace', { x: 800, y: 1400, w: 240, h: 80, cx: 920, cy: 1440 }],
    ['page', { x: 500, y: 800, w: 240, h: 80, cx: 620, cy: 840 }],
    ['remote', { x: 90000, y: 90000, w: 240, h: 80, cx: 90120, cy: 90040 }],
  ]);
  const g = {
    svgEl: { getBoundingClientRect: () => ({ width: 1000, height: 700 }) },
    layout: { width: 100000, height: 100000, nodes: boxes },
    model: { edges: [{ from: 'near', to: 'open' }] },
    traceEdges: [{ from: 'open', to: 'trace' }], pageLinks: [{ from: 'page', to: 'open' }, { from: 'open', to: 'ext:remote' }],
    nodePos: (id: string) => boxes.get(id), k: 0.01, tx: 0, ty: 0,
    requestDraw: vi.fn(), focusId: null,
  } as unknown as GraphContext;
  attachView(g);
  return g;
}

describe('map viewport', () => {
  it('centres and zooms an open page even after fitting a very large map', () => {
    const g = context(); g.fit(); expect(g.k).toBeLessThan(0.1);
    g.focus('open'); expect(g.k).toBeGreaterThanOrEqual(1);
    expect(920 * g.k + g.tx).toBeCloseTo(500);
    expect(840 * g.k + g.ty).toBeCloseTo(350);
  });
  it('fits every directly connected document, ignoring remote external-expanded bounds', () => {
    const g = context(); g.focusId = 'open'; g.fit();
    expect(g.k).toBeGreaterThan(0.5);
    for (const id of ['open', 'near', 'trace', 'page']) {
      const b = g.nodePos(id)!;
      expect(b.x * g.k + g.tx).toBeGreaterThan(0);
      expect((b.x + b.w) * g.k + g.tx).toBeLessThan(1000);
      expect(b.y * g.k + g.ty).toBeGreaterThan(0);
      expect((b.y + b.h) * g.k + g.ty).toBeLessThan(700);
    }
    expect(g.nodePos('remote')!.x * g.k + g.tx).toBeGreaterThan(1000);
  });
});
