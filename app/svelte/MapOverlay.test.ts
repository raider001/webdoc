import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapOverlay from './MapOverlay.svelte';
import { mapState, nextLayout, rememberMapView } from './stores/map.svelte.js';
import { app, state } from '/js/app-shell.js';
import type { GraphChangeEvent, GraphController, GraphInputDoc, GraphOptions } from '/js/graph.js';
import { selectedTreePreferenceKey } from '/js/graph/selected-tree.js';

const factory = vi.hoisted(() => vi.fn());
vi.mock('/js/graph.js', () => ({ createGraphController: factory }));
const records: { docs: GraphInputDoc[]; options: GraphOptions; transform: { tx: number; ty: number; k: number }; controller: GraphController }[] = [];
const originalNavigate = app.navigate;
const initialState = (): GraphChangeEvent => ({ editMode: false, connector: 'recnext', pendingSourceTitle: null, selectedEdge: null, visibility: { trace: false }, hiddenGroups: new Set() });
const node = (id: string, assumes: string[] = [], next: string[] = []) => ({ id, title: id, description: '', assumes, next, groups: [], locked: false, ownsAccess: false });
beforeEach(() => {
  records.length = 0; localStorage.clear(); state.current = null; state.site = null;
  Object.assign(app, { navigate: vi.fn() });
  mapState.model = { docs: [node('s', ['a'], ['b']), node('a'), node('b'), node('other')], traceEdges: [], pageLinks: [], externalNodes: [], groups: [] };
  mapState.focusMode = false; mapState.focusId = null; mapState.mapMode = 'all';
  rememberMapView({ tx: 10, ty: 20, k: 1 }, new Map(), initialState()); nextLayout(false, false);
  factory.mockImplementation((_el: HTMLElement, docs: GraphInputDoc[], options: GraphOptions) => {
    let change = initialState(); const listeners = new Set<(event: GraphChangeEvent) => void>();
    const transform = { ...(options.initialTransform || { tx: 0, ty: 0, k: 1 }) };
    const controller = {
      getTransform: () => ({ ...transform }), getNodePositions: () => new Map(docs.map(d => [d.id, { x: 1, y: 2 }])), getEditState: () => change,
      on: (_name: string, fn: (event: GraphChangeEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
      setVisibility: (kind: string, visible: boolean) => { change = { ...change, visibility: { ...change.visibility, [kind]: visible } }; listeners.forEach(fn => fn(change)); },
      setCurrent: vi.fn(), destroy: vi.fn(), setEditMode: vi.fn(), setConnector: vi.fn(), zoomBy: vi.fn(), fit: vi.fn(), search: vi.fn(), setMapMode: vi.fn(), setHiddenGroups: vi.fn(),
    } as unknown as GraphController;
    records.push({ docs, options, transform, controller }); return controller;
  });
});
afterEach(() => { cleanup(); Object.assign(app, { navigate: originalNavigate }); vi.restoreAllMocks(); });
const last = () => records[records.length - 1];
const ids = () => last().docs.map(d => d.id);
const open = () => render(MapOverlay, { onClose: vi.fn(), onRebuild: vi.fn().mockResolvedValue(undefined) });
describe('selected tree display control', () => {
  it('defaults off, shows the full-view hint without a selection, and remembers the toggle on reopen', async () => {
    const view = open(); await waitFor(() => expect(records).toHaveLength(1));
    const toggle = view.getByRole('button', { name: 'Display selected tree only' }); expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(toggle); expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(view.getByText('Select a page to show its tree')).toBeTruthy(); expect(ids()).toEqual(['s', 'a', 'b', 'other']);
    expect(localStorage.getItem(selectedTreePreferenceKey(null, location.origin))).toBe('true');
    cleanup(); const reopened = open(); expect(reopened.getByRole('button', { name: 'Display selected tree only' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('recomputes for another node from the full model without requesting a server rebuild', async () => {
    const onRebuild = vi.fn().mockResolvedValue(undefined), view = render(MapOverlay, { onClose: vi.fn(), onRebuild });
    await waitFor(() => expect(records).toHaveLength(1)); await fireEvent.click(view.getByRole('button', { name: 'Display selected tree only' }));
    last().options.onSelect?.('s'); await waitFor(() => expect(ids()).toEqual(['s', 'a', 'b']));
    expect(last().options.currentId).toBe('s'); expect(last().options.animateFrom).toBeInstanceOf(Map);
    last().options.onSelect?.('b'); await waitFor(() => expect(ids()).toEqual(['b'])); expect(onRebuild).not.toHaveBeenCalled();
  });
  it('restores full pan/zoom and edge visibility when switched off', async () => {
    const view = open(); await waitFor(() => expect(records).toHaveLength(1));
    Object.assign(last().transform, { tx: 111, ty: 222, k: 0.75 }); last().options.onSelect?.('s');
    await fireEvent.click(view.getByRole('button', { name: 'Display selected tree only' })); await waitFor(() => expect(ids()).toHaveLength(3));
    expect(last().options.initialTransform).toBeNull(); expect(last().controller.getEditState().visibility.trace).toBe(false);
    await fireEvent.click(view.getByRole('button', { name: 'Display selected tree only' })); await waitFor(() => expect(ids()).toHaveLength(4));
    expect(last().options.initialTransform).toEqual({ tx: 111, ty: 222, k: 0.75 }); expect(last().controller.getEditState().visibility.trace).toBe(false);
  });
  it('clears via background selection or Escape, restores the full view and keeps the toggle enabled', async () => {
    const onClose = vi.fn(), view = render(MapOverlay, { onClose, onRebuild: vi.fn().mockResolvedValue(undefined) });
    await waitFor(() => expect(records).toHaveLength(1)); last().options.onSelect?.('s');
    await fireEvent.click(view.getByRole('button', { name: 'Display selected tree only' })); await waitFor(() => expect(ids()).toHaveLength(3));
    last().options.onClearSelection?.(); await waitFor(() => expect(ids()).toHaveLength(4)); expect(last().options.currentId).toBeNull();
    last().options.onSelect?.('s'); await waitFor(() => expect(ids()).toHaveLength(3));
    await fireEvent.keyDown(window, { key: 'Escape' }); await waitFor(() => expect(ids()).toHaveLength(4));
    expect(view.getByText('Select a page to show its tree')).toBeTruthy(); expect(onClose).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: 'Display selected tree only' }).getAttribute('aria-pressed')).toBe('true');
  });
});
