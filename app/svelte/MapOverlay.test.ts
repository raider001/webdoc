import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapOverlay from './MapOverlay.svelte';
import { mapState, nextLayout, rememberMapView, setMapModel } from './stores/map.svelte.js';
import { app, state } from '/js/app-shell.js';
import type { GraphChangeEvent, GraphController, GraphInputDoc, GraphOptions } from '/js/graph.js';
import { selectedTreePreferenceKey, compactLayoutPreferenceKey } from '/js/graph/selected-tree.js';
import { createIndexWatcher } from '/js/index-watch.js';

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
      updateData: vi.fn((updated: GraphInputDoc[]) => { const record = records.find(r => r.controller === controller); if (record) record.docs = updated; return false; }),
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
  it('defaults compact layout on, preserves the camera on toggle, and remembers the opt-out', async () => {
    const view = open(); await waitFor(() => expect(records).toHaveLength(1));
    const toggle = view.getByRole('button', { name: 'Compact layout' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true'); expect(last().options.compactLayout).toBe(true);
    const transform = { tx: 25, ty: 50, k: 0.65 }; Object.assign(last().transform, transform);
    await fireEvent.click(toggle); await waitFor(() => expect(last().options.compactLayout).toBe(false));
    expect(last().transform).toEqual(transform); expect(localStorage.getItem(compactLayoutPreferenceKey(null, location.origin))).toBe('false');
    cleanup(); const reopened = open(); expect(reopened.getByRole('button', { name: 'Compact layout' }).getAttribute('aria-pressed')).toBe('false');
  });
  it.each(['metadata', 'addition', 'rewrite'])('preserves the active controller and selected tree during a background %s update', async kind => {
    const view = open(); await waitFor(() => expect(records).toHaveLength(1)); last().options.onSelect?.('s');
    await fireEvent.click(view.getByRole('button', { name: 'Display selected tree only' })); await waitFor(() => expect(ids()).toHaveLength(3));
    const record = last(), count = records.length; Object.assign(record.transform, { tx: 315, ty: -120, k: 1.75 });
    const model = JSON.parse(JSON.stringify(mapState.model));
    if (kind === 'metadata') model.docs[0].title = 'Updated title';
    if (kind === 'addition') { model.docs.push(node('new')); model.docs[0].next.push('new'); }
    const version = mapState.version;
    const watcher = createIndexWatcher(async () => { setMapModel(model, { animate: true }); });
    await watcher.observe({ state: 'ready', generation: 1 });
    await Promise.all(Array.from({ length: 30 }, () => watcher.observe({ state: 'ready', generation: 2 })));
    expect(mapState.version).toBe(version);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(records).toHaveLength(count); expect(last().transform).toEqual({ tx: 315, ty: -120, k: 1.75 });
    expect(mapState.selectedId).toBe('s'); expect(view.getByRole('button', { name: 'Display selected tree only' }).getAttribute('aria-pressed')).toBe('true');
    expect(ids()).toEqual(kind === 'addition' ? ['s', 'a', 'b', 'new'] : ['s', 'a', 'b']);
  });
  it('defaults off, shows the full-view hint without a selection, and remembers the toggle on reopen', async () => {
    const view = open(); await waitFor(() => expect(records).toHaveLength(1));
    const toggle = view.getByRole('button', { name: 'Display selected tree only' }); expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(toggle); expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(view.getByText('Select a page to show its tree')).toBeTruthy(); expect(ids()).toEqual(['s', 'a', 'b', 'other']);
    expect(localStorage.getItem(selectedTreePreferenceKey(null, location.origin))).toBe('true');
    cleanup(); const reopened = open(); expect(reopened.getByRole('button', { name: 'Display selected tree only' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('updates the full view in place and only relayouts when explicitly requested', async () => {
    const view = open(); await waitFor(() => expect(records).toHaveLength(1));
    const record = last(), version = mapState.version;
    Object.assign(record.transform, { tx: 110, ty: 220, k: 0.65 });
    const model = JSON.parse(JSON.stringify(mapState.model)); model.docs[0].title = 'Renamed';
    setMapModel(model); await waitFor(() => expect(last().docs[0].title).toBe('Renamed'));
    expect(last()).toBe(record); expect(mapState.version).toBe(version);
    await fireEvent.click(view.getByRole('button', { name: 'Re-layout' }));
    await waitFor(() => expect(records).toHaveLength(2)); expect(last().transform).toEqual(record.transform);
  });
  it('clears a removed selection without rebuilding the controller or switching off its toggle', async () => {
    const view = open(); await waitFor(() => expect(records).toHaveLength(1)); last().options.onSelect?.('s');
    await fireEvent.click(view.getByRole('button', { name: 'Display selected tree only' })); await waitFor(() => expect(ids()).toHaveLength(3));
    const record = last(), count = records.length;
    const model = JSON.parse(JSON.stringify(mapState.model)); model.docs = model.docs.filter((doc: GraphInputDoc) => doc.id !== 's');
    setMapModel(model); await waitFor(() => expect(mapState.selectedId).toBeNull());
    expect(records).toHaveLength(count); expect(last()).toBe(record);
    expect(view.getByRole('button', { name: 'Display selected tree only' }).getAttribute('aria-pressed')).toBe('true');
    expect(view.getByText('Select a page to show its tree')).toBeTruthy(); expect(ids()).toEqual(['a', 'b', 'other']);
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
