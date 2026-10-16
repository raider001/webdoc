<!--
  The document-relationship "Map": the canvas scene, and every control around it.

  MOUNTED INTO THE HOST'S STAGE. #graphOverlay and its stage div are created at
  boot by app/js/overlays.js so that the module which FILLS them can stay lazy;
  this component is what fills the stage, and app/js/map-view.js mounts it on
  open and unmounts it on close. Unmounting rather than hiding is not tidiness -
  the graph runs a requestAnimationFrame loop and installs window.__graph, and
  tests/test_map_ui.py has a test whose entire point is that two canvas views are
  never live at once.

  WHAT IS REACTIVE HERE, AND WHAT IS NOT. Two objects, and they answer different
  questions:

    `change`   - the controller's own report (edit mode, armed connector, pending
                 source, selected edge, per-category visibility, hidden groups).
                 Replaced WHOLESALE by every event, which is what makes a Set
                 inside it safe to render from: the component re-renders because
                 the object identity changed, never because something mutated a
                 collection Svelte cannot see into. Every control paints itself
                 from this and from nothing else.
    `mapState` - what survives a rebuild and a reopen (the model, the layout
                 token, the "Map by" mode, focus). See stores/map.svelte.ts.

  USER LAYOUT REQUESTS CREATE A NEW CONTROLLER. A different "Map by" mode, entering or leaving
  focus - bumps mapState.version, and the {#key} around GraphCanvas replaces the
  canvas and its controller. Background model changes patch the live controller.
  Putting docs or the layout in an $effect would relayout on unrelated changes
  and lose the tween between layouts, which is the difference between a smooth
  rearrange and a jump.

  THE HARVEST HAPPENS AT BUILD TIME, in graphOptions(), and that ordering is not
  interchangeable with a teardown: Svelte's {#key} creates the new branch BEFORE
  it destroys the old one, so a teardown would save the outgoing pan/zoom AFTER
  the incoming controller had already asked for it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { state as appState, app } from '/js/app-shell.js';
  import {
    mapState, mapBuildSeeds, rememberMapView, nextLayout,
  } from './stores/map.svelte.js';
  import GraphCanvas from './GraphCanvas.svelte';
  import MapToolbar from './MapToolbar.svelte';
  import MapSearch from './MapSearch.svelte';
  import MapModeSelect from './MapModeSelect.svelte';
  import EdgeLegend from './EdgeLegend.svelte';
  import GroupLegend from './GroupLegend.svelte';
  import EditControls from './EditControls.svelte';
  import MapEmpty from './MapEmpty.svelte';
  import type { GraphViewSnapshot } from './actions/graph.js';
  import type { GraphController, GraphChangeEvent, GraphOptions } from '/js/graph.js';
  import type { GraphModel } from '/js/graph-model.js';
  import { selectedTreeModelAsync, selectedTreePreferenceKey, readSelectedTreePreference, writeSelectedTreePreference, compactLayoutPreferenceKey, readCompactLayoutPreference } from '/js/graph/selected-tree.js';
  import type { MapTransform } from './stores/map.svelte.js';

  /**
   * `onRebuild` is map-view.js's buildDocGraph. Edit-connections writes change
   * the SERVER's index, so the model has to be refetched, and the module that
   * fetches it is the vanilla shell's - handing that job back rather than
   * importing /js/map-view.js from here keeps one fetcher and no import cycle
   * through the bundle.
   */
  interface Props {
    onClose: () => void;
    onRebuild: (animate?: boolean) => Promise<void>;
  }

  let { onClose, onRebuild }: Props = $props();

  /**
   * The "Map by" options. Their `swatch` names an edge category, so each option
   * is drawn in the same colour and dash as the connections it lays out along.
   */
  const MAP_MODES = [
    { value: 'all', label: 'All connections', swatch: 'all' },
    { value: 'recnext', label: 'Recommended next', swatch: 'recnext' },
    { value: 'prereq', label: 'Prerequisite', swatch: 'prereq' },
  ];

  /**
   * The minimap SURFACE, built here and given away twice: adopted into the frame
   * below, and handed to every controller as opts.minimapCanvas.
   *
   * Created imperatively rather than with bind:this because the controller needs
   * it at construction time and a bound reference is only guaranteed by the time
   * effects run - an ordering that would work in a quick test and then not. A
   * plain element built in the component's setup exists before any effect does.
   * One canvas outlives every rebuild; only the frame around it is markup.
   */
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.className = 'graph-minimap-svg';   // reuses the 100% x 100% sizing rule

  /**
   * Put an element the component made, but does not render, inside a node it
   * does. The same seam actions/icon.ts opens for icons.js's DOM factories.
   */
  function adopt(node: HTMLElement, child: HTMLElement): { destroy: () => void } {
    node.appendChild(child);
    return { destroy: () => child.remove() };
  }

  /**
   * The live controller. A PLAIN variable, not $state: nothing in the markup
   * renders from it - every handler below reaches for it from inside an event,
   * which is not a tracking context - and making it reactive would re-run the
   * params expression that builds the next controller every time one arrives.
   */
  let api: GraphController | null = null;
  /**
   * Which GraphCanvas instance `api` belongs to. The {#key} swap creates the new
   * canvas before destroying the old one, so the outgoing instance's "gone"
   * report lands AFTER the incoming one's - without this check it would blank a
   * controller that is on screen.
   */
  let apiOwner: object | null = null;
  let opening = true;
  onMount(() => {
    const follow = () => {
      const id = appState.current?.id || null;
      mapState.selectedId = id;
      api?.setCurrent(id);
      if (mapState.focusMode) { mapState.focusId = id; nextLayout(false, true); }
      else if (id) api?.focus(id);
    };
    document.addEventListener('webdoc:current', follow);
    return () => document.removeEventListener('webdoc:current', follow);
  });
  const treePreferenceKey = selectedTreePreferenceKey(appState.site, location.origin);
  mapState.selectedTreeOnly = readSelectedTreePreference(treePreferenceKey);
  const compactPreferenceKey = compactLayoutPreferenceKey(appState.site, location.origin);
  mapState.compactLayout = readCompactLayoutPreference(compactPreferenceKey);
  mapState.selectedId = appState.current?.id || null;
  let shownModel = $state.raw<GraphModel | null>(mapState.model);
  let treeBusy = $state(false);
  let subsetInScene = false;
  let sceneSelection: string | null = null;
  let sceneSource = mapState.model;
  let fullTransform: MapTransform | null = null;
  let restoreTransform: MapTransform | null = null;
  const hasSelection = $derived(!!mapState.selectedId && !!mapState.model?.docs.some(doc => doc.id === mapState.selectedId));

  // Track only the source model and filter inputs. Layout/version and controller
  // reports are deliberately not dependencies, avoiding rebuild/fetch cycles.
  $effect(() => {
    const model = mapState.model;
    const selected = mapState.selectedTreeOnly && hasSelection ? mapState.selectedId : null;
    const abort = new AbortController();
    if (!model) return;
    treeBusy = !!selected;
    selectedTreeModelAsync(model, selected, abort.signal).then(subset => {
      if (abort.signal.aborted) return;
      treeBusy = false;
      if (!selected && !subsetInScene && shownModel === model) return;
      const filterChanged = selected !== sceneSelection;
      const backgroundChange = model !== sceneSource;
      sceneSource = model;
      if (selected && !subsetInScene) fullTransform = api?.getTransform() || null;
      if (!selected && subsetInScene) restoreTransform = fullTransform;
      subsetInScene = !!selected;
      sceneSelection = selected;
      shownModel = subset;
      if (filterChanged && !backgroundChange) nextLayout(true, !!selected);
      else api?.updateData(subset.docs, subset);
      if (mapState.selectedId && !model.docs.some(doc => doc.id === mapState.selectedId)) {
        mapState.selectedId = null; mapState.focusId = null;
        api?.setCurrent(null);
      }
    }).catch(error => {
      if (!abort.signal.aborted) { treeBusy = false; console.error('Selected tree could not be built', error); }
    });
    return () => abort.abort();
  });

  /**
   * The controller's last report. Seeded with the state a freshly built graph
   * has, so the chrome's first frame is right during the tick before the engine
   * module has finished loading - an unknown visibility key reads as "shown",
   * which is what an empty map means.
   */
  let change: GraphChangeEvent = $state({
    editMode: false,
    connector: 'recnext',
    pendingSourceTitle: null,
    selectedEdge: null,
    visibility: {},
    hiddenGroups: new Set(),
  });

  /** The documents to lay out; empty until map-view.js has pushed a model in. */
  const docs = $derived(shownModel ? shownModel.docs : []);

  /**
   * Which categories the legend offers. Trace and page-link entries appear only
   * when the corpus actually has such edges - a toggle for something that cannot
   * be drawn is a control that does nothing.
   */
  const legendKinds = $derived.by((): [string, string][] => {
    const m = mapState.model;
    const out: [string, string][] = [['prereq', 'Prerequisite'], ['recnext', 'Recommended next']];
    if (m && m.traceEdges.length) out.push(['trace', 'Requirement trace']);
    if (m && m.pageLinks.length) out.push(['pagelink', 'Page link']);
    out.push(['missing', 'Missing']);
    return out;
  });

  /** Every access group named anywhere in the payload; empty on an open site. */
  const accessGroups = $derived(mapState.model ? mapState.model.groups : []);

  /** A model that arrived and had nothing in it - as opposed to one that has not arrived. */
  const isEmpty = $derived(!!mapState.model && mapState.model.docs.length === 0);

  /**
   * Everything the engine is built with.
   *
   * CALLED FROM THE MARKUP, INSIDE THE {#key} BLOCK, so every rebuild recomputes
   * it - and it opens by harvesting the OUTGOING controller, which is still
   * alive at this moment and is the only thing that knows where the reader was
   * looking, where each node sat, and what the legend was showing.
   */
  function graphOptions(): GraphOptions {
    if (api) rememberMapView(api.getTransform(), api.getNodePositions(), api.getEditState());
    const seeds = mapBuildSeeds();
    const focused = !!(mapState.focusMode && mapState.focusId && !mapState.selectedTreeOnly);
    const initialTransform = restoreTransform || seeds.initialTransform;
    restoreTransform = null;
    return {
      currentId: focused ? mapState.focusId : mapState.selectedId,
      traceEdges: shownModel ? shownModel.traceEdges : [],
      pageLinks: shownModel ? shownModel.pageLinks : [],
      externalNodes: shownModel ? shownModel.externalNodes : [],
      initialTransform,
      animateFrom: seeds.animateFrom,
      minimapCanvas: minimapCanvas,
      // "Map by" picks which connection TYPE shapes the tree layout. It never
      // hides edges - every connection is still drawn; the legend owns visibility.
      mapMode: mapState.mapMode,
      compactLayout: mapState.compactLayout,
      onMapMode: (m) => { mapState.mapMode = m; nextLayout(true); },   // relayout + animate the rearrange
      // Access groups: the map is where a reader is meant to SEE the shape of
      // what is restricted, so every node carries its read groups and the map
      // draws a colour band per group plus a lock on the pages this account
      // cannot open.
      hiddenGroups: new Set(seeds.hiddenGroups),
      focusId: focused ? mapState.focusId : null,
      onSelect: (id) => {
        mapState.selectedId = id;
        if (mapState.focusMode && !mapState.selectedTreeOnly) {
          // Re-clicking the centre returns to the hierarchy.
          mapState.focusId = (mapState.focusId === id) ? null : id;
          nextLayout(true, true);                 // re-fit to the new frame
        } else if (app.navigate) {
          app.navigate(id);                       // normal mode: select it, stay on the map
        }
      },
      onClearSelection: clearSelection,
      onActivate: (id) => { onClose(); if (app.navigate) app.navigate(id); },   // dbl-click: open + leave
      onConnect: (sourceId, targetId, type) => {  // A then B: prereq edge A->B means B assumes A
        void relate(
          type === 'prereq'
            ? [targetId, sourceId, 'assumes']     // owned by the dependent doc (B)
            : [sourceId, targetId, 'next'],       // recnext owned by the source doc (A)
          'add');
      },
      onDisconnect: (fromId, toId, type) => {     // remove the drawn edge
        void relate(
          type === 'prereq'
            ? [toId, fromId, 'assumes']           // prereq edge P->D means D assumes P
            : [fromId, toId, 'next'],             // recnext edge D->S means D.next has S
          'remove');
      },
      onDelete: (id) => { if (app.deleteDocFlow) app.deleteDocFlow(id, { rebuildMap: true }); },   // Delete key on a selected node
      // No in-map "New document" button: the header's ＋ (title "New document")
      // is always available, so a second create button on the map was redundant.
    };
  }

  /**
   * Write one relationship edit through the app, then rebuild from the server.
   * The refetch is the point: the edit changed the on-disk header, and the map's
   * model comes from the server index, not from anything this component holds.
   * @param edit - [fromId, toId, field]
   */
  async function relate(
    edit: [string, string, ('assumes' | 'next')],
    action: ('add' | 'remove'),
  ): Promise<void> {
    if (!app.editDocRelation) return;
    const ok = await app.editDocRelation(edit[0], edit[1], edit[2], action);
    if (ok) await onRebuild(true);
  }

  /**
   * GraphCanvas reporting in - a controller on create, null on teardown.
   * @param owner - the reporting instance's identity
   */
  function onReady(next: GraphController | null, owner: object): void {
    if (next) {
      api = next;
      apiOwner = owner;
      // A refresh can arrive while the lazy engine import is still in flight.
      if (shownModel) next.updateData(shownModel.docs, shownModel);
      // Edit mode is re-armed AFTER the build, exactly as the vanilla map did:
      // it is a mode the reader turned on, not a property of the layout, so it
      // is restored rather than passed in.
      const seeds = mapBuildSeeds();
      for (const [kind, visible] of Object.entries(seeds.visibility)) next.setVisibility(kind, visible);
      if (seeds.editMode) { next.setEditMode(true); next.setConnector(seeds.connector); }
      if (opening && appState.current?.id) {
        opening = false;
        if (mapState.focusMode) { mapState.focusId = appState.current.id; nextLayout(false, true); }
        else next.focus(appState.current.id);
      }
    } else if (owner === apiOwner) {
      api = null;
      apiOwner = null;
    }
  }

  function onChange(ev: GraphChangeEvent): void { change = ev; }

  /**
   * The outgoing controller's state, on the one path the build-time harvest
   * cannot cover: the overlay closing. Nothing builds after this, so this is the
   * only chance to remember where the reader was.
   */
  function onTeardown(view: GraphViewSnapshot): void {
    rememberMapView(view.transform, view.positions, view.editState);
  }

  /** @param kind - edge category */
  function toggleKind(kind: string): void {
    if (!api) return;
    if (change.editMode && (kind === 'prereq' || kind === 'recnext')) { api.setConnector(kind); return; }
    api.setVisibility(kind, change.visibility[kind] === false);
  }

  /** @param name - access group */
  function toggleGroup(name: string): void {
    if (!api) return;
    // Built as a NEW LIST, not by editing a Set. The controller takes any
    // iterable and copies it, and the Set in `change` is the controller's own
    // copy - adding to or deleting from either would give two writers one
    // collection, which is exactly how a group toggle used to repaint only
    // sometimes. Nothing in the map's code mutates a Set anywhere.
    const shown = Array.from(change.hiddenGroups);
    api.setHiddenGroups(shown.includes(name) ? shown.filter(g => g !== name) : shown.concat(name));
  }

  /** Toggle radial focus mode; leaving it returns to the hierarchy. */
  function toggleFocus(): void {
    if (mapState.selectedTreeOnly) return;
    mapState.focusMode = !mapState.focusMode;
    mapState.focusId = mapState.focusMode ? mapState.selectedId : null;
    nextLayout(true, true);
  }

  function toggleSelectedTree(): void {
    mapState.selectedTreeOnly = !mapState.selectedTreeOnly;
    writeSelectedTreePreference(treePreferenceKey, mapState.selectedTreeOnly);
    if (mapState.selectedTreeOnly) {
      const wasFocused = mapState.focusMode;
      mapState.focusMode = false; mapState.focusId = null;
      if (wasFocused && !hasSelection) nextLayout(true, true);
    }
  }
  function clearSelection(): void {
    mapState.selectedId = null;
    if (api) api.setCurrent(null);
  }

  // Escape: leave the focused node first, and only close the map once there is
  // nothing left to back out of. This lives here rather than in map-view.js
  // because the component only exists while the overlay is open - which is the
  // guard the old permanent `document` listener had to write by hand, expressed
  // as a lifetime instead.
  $effect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (mapState.selectedTreeOnly && mapState.selectedId && !change.editMode) {
        ev.preventDefault(); clearSelection(); return;
      }
      if (mapState.focusMode && mapState.focusId) {
        mapState.focusId = null;
        nextLayout(true, true);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="graph-root" class:is-editing={change.editMode}>
  <!--
    The scene. {#key} is the rebuild: a new model or a new layout replaces the
    element, so the action tears the old controller down and builds a new one.
    Patching a canvas scene in place is not a thing the engine offers, and
    pretending otherwise is how a stale edge survives an edit.
  -->
  {#key mapState.version}
    <GraphCanvas {docs} options={graphOptions()} {onReady} {onChange} {onTeardown} />
  {/key}

  <!-- The frame is chrome; the surface inside it is the engine's to paint. -->
  <div class="graph-minimap" use:adopt={minimapCanvas}></div>

  <MapToolbar
    focusMode={mapState.focusMode}
    focusDisabled={mapState.selectedTreeOnly}
    onZoom={(factor) => { if (api) api.zoomBy(factor); }}
    onFit={() => { if (api) api.fit(); }}
    onFocusToggle={toggleFocus}
  />

  <MapSearch onSearch={(query) => { if (api) api.search(query); }} />

  <div class="graph-legend">
    <button type="button" class="graph-legend-item graph-relayout" title="Rearrange the displayed nodes" onclick={() => nextLayout(true, false)}>Re-layout</button>
    <button type="button" class="graph-legend-item graph-compact-layout"
      class:is-on={mapState.compactLayout} aria-pressed={mapState.compactLayout}
      disabled={mapState.focusMode && !mapState.selectedTreeOnly}
      title="Wrap long leaf runs into free columns in the layered map; use Fit to reframe"
      onclick={() => { mapState.compactLayout = !mapState.compactLayout; writeSelectedTreePreference(compactPreferenceKey, mapState.compactLayout); nextLayout(true, false); }}>Compact layout</button>
    <MapModeSelect
      modes={MAP_MODES}
      current={mapState.mapMode}
      onPick={(mode) => { if (api) api.setMapMode(mode); }}
    />
    <EdgeLegend
      kinds={legendKinds}
      visibility={change.visibility}
      editMode={change.editMode}
      connector={change.connector}
      onToggle={toggleKind}
    />
    <button type="button" class="graph-legend-item graph-selected-tree"
      class:is-on={mapState.selectedTreeOnly} aria-pressed={mapState.selectedTreeOnly}
      onclick={toggleSelectedTree}>Display selected tree only</button>
    {#if treeBusy}
      <span class="graph-tree-hint" role="status">Building selected tree…</span>
    {:else if mapState.selectedTreeOnly && !hasSelection}
      <span class="graph-tree-hint" role="status">Select a page to show its tree</span>
    {/if}
  </div>

  {#if accessGroups.length}
    <GroupLegend groups={accessGroups} hidden={change.hiddenGroups} onToggle={toggleGroup} />
  {/if}

  <EditControls state={change} onToggle={() => { if (api) api.setEditMode(!change.editMode); }} />

  {#if isEmpty}<MapEmpty />{/if}
</div>
