// graph/chrome.js - the overlay chrome (zoom controls, search box, legend /
// connector pickers, edit-connections toggle + hint, minimap container, empty
// state) plus the edit-mode state machine (arming a connector, marking a source
// node, selecting an edge, toggling edit mode). Everything hangs off context `g`.
import { svg, cssEscape } from './util.js';

export function buildChrome(g) {
  const container = g.container;

  function ctrlBtn(label, aria) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'graph-ctrl-btn';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.title = aria;
    return b;
  }

  // ---- Zoom controls ----
  const controls = document.createElement('div');
  controls.className = 'graph-controls';
  g.btnIn  = ctrlBtn('+', 'Zoom in');
  g.btnOut = ctrlBtn('−', 'Zoom out'); // minus sign
  g.btnFit = ctrlBtn('⤢', 'Fit to view');
  controls.appendChild(g.btnIn); controls.appendChild(g.btnOut); controls.appendChild(g.btnFit);
  container.appendChild(controls);

  // ---- Search ----
  const searchWrap = document.createElement('div');
  searchWrap.className = 'graph-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Find a document…';
  searchInput.setAttribute('aria-label', 'Find a document in the map');
  searchInput.autocomplete = 'off';
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);
  g.searchInput = searchInput;

  // ---- Legend (each entry toggles a category; in edit mode prereq/recnext act
  //      as connector pickers instead) ----
  const legend = document.createElement('div');
  legend.className = 'graph-legend';
  const legendBtns = {};
  g.legendBtns = legendBtns;
  function legendToggle(swatchCls, label, hideCls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'graph-legend-item';
    b.dataset.kind = swatchCls;
    b.setAttribute('aria-pressed', 'true');
    b.title = 'Toggle ' + label;
    const sw = document.createElement('span');
    sw.className = 'graph-legend-swatch ' + swatchCls;
    b.appendChild(sw);
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', function () {
      if (g.editMode && (swatchCls === 'prereq' || swatchCls === 'recnext')) { g.setConnector(swatchCls); return; }
      const hidden = g.viewport.classList.toggle(hideCls);
      b.setAttribute('aria-pressed', hidden ? 'false' : 'true');
      b.classList.toggle('is-off', hidden);
    });
    legendBtns[swatchCls] = b;
    return b;
  }
  if (!g.opts.hideLegend) {
    // "Map by" dropdown: choose which connection type drives the tree layout. A
    // custom dropdown (not native <select>) so each option can carry its swatch.
    if (Array.isArray(g.mapModes) && g.mapModes.length > 1) legend.appendChild(buildMapModeDropdown(g));
    legend.appendChild(legendToggle('prereq', 'Prerequisite', 'hide-prereq'));
    legend.appendChild(legendToggle('recnext', 'Recommended next', 'hide-recnext'));
    if (g.traceEdges.length) legend.appendChild(legendToggle('trace', 'Requirement trace', 'hide-trace'));
    if (g.pageLinks.length) legend.appendChild(legendToggle('pagelink', 'Page link', 'hide-pagelink'));
    legend.appendChild(legendToggle('missing', 'Missing', 'hide-missing'));
    container.appendChild(legend);
  }

  // ---- Edit-connections toggle + hint (only when editable) ----
  g.editBtn = null; g.hintEl = null;
  if (g.editable && !g.opts.hideLegend) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'graph-edit-toggle';
    editBtn.textContent = '✎ Edit connections';
    editBtn.setAttribute('aria-pressed', 'false');
    editBtn.title = 'Draw or delete connections between documents';
    editBtn.addEventListener('click', () => g.setEditMode(!g.editMode));
    container.appendChild(editBtn);
    const hintEl = document.createElement('div');
    hintEl.className = 'graph-edit-hint';
    hintEl.hidden = true;
    container.appendChild(hintEl);
    g.editBtn = editBtn; g.hintEl = hintEl;
  }

  // ---- New-document button (doc map only; the app wires g.onCreate) ----
  if (g.onCreate) {
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'graph-new-btn';
    newBtn.textContent = '＋ New document';
    newBtn.title = 'Create a new document';
    newBtn.addEventListener('click', () => g.onCreate());
    container.appendChild(newBtn);
    g.newBtn = newBtn;
  }

  // ---- Focus-mode toggle (doc map only; the app wires g.onFocusToggle) ----
  if (g.onFocusToggle) {
    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'graph-focus-toggle' + (g.focusMode ? ' is-on' : '');
    focusBtn.textContent = '◎ Focus';
    focusBtn.setAttribute('aria-pressed', g.focusMode ? 'true' : 'false');
    focusBtn.title = 'Focus mode: click a node to centre the map on it and its links (Esc resets)';
    focusBtn.addEventListener('click', () => g.onFocusToggle());
    container.appendChild(focusBtn);
    g.focusBtn = focusBtn;
  }

  // ---- Edit-mode state machine ----
  g.setConnector = function (type) {
    g.activeConnector = type;
    ['prereq', 'recnext'].forEach(k => {
      const b = legendBtns[k];
      if (b) b.classList.toggle('is-connector-active', g.editMode && k === type);
    });
    g.updateHint();
  };
  g.markSource = function (id) {
    g.nodesG.querySelectorAll('.is-connect-source').forEach(x => x.classList.remove('is-connect-source'));
    const gEl = g.nodesG.querySelector('[data-node-id="' + cssEscape(id) + '"]');
    if (gEl) gEl.classList.add('is-connect-source');
    g.pendingSource = id;
  };
  g.clearPending = function () {
    g.pendingSource = null;
    g.nodesG.querySelectorAll('.is-connect-source').forEach(x => x.classList.remove('is-connect-source'));
  };
  g.clearSelectedEdge = function () {
    if (g.selectedEdge && g.selectedEdge.el) g.selectedEdge.el.classList.remove('is-selected');
    g.selectedEdge = null;
  };
  g.selectEdge = function (from, to, type) {
    g.clearSelectedEdge(); g.clearPending();
    const el = g.editEdgeEls.get(from + '|' + type + '|' + to);
    if (!el) return;
    el.classList.add('is-selected');
    g.selectedEdge = { from: from, to: to, type: type, el: el };
    g.updateHint();
  };
  g.updateHint = function () {
    if (!g.hintEl) return;
    g.hintEl.hidden = !g.editMode;
    if (!g.editMode) { g.hintEl.textContent = ''; return; }
    if (g.selectedEdge) { g.hintEl.textContent = 'Connection selected — press Delete to remove it.'; return; }
    if (g.pendingSource) {
      const s = g.model.nodes.get(g.pendingSource);
      const sn = s ? s.title : g.pendingSource;
      g.hintEl.textContent = g.activeConnector === 'prereq'
        ? 'Now click the document “' + sn + '” should assume (its prerequisite).'
        : 'Now click the document to read next after “' + sn + '”.';
      return;
    }
    g.hintEl.textContent = g.activeConnector === 'prereq'
      ? 'Prerequisite: click a document, then the one it assumes. (Or click a line + Delete.)'
      : 'Recommended next: click a document, then the one to read next. (Or click a line + Delete.)';
  };
  g.setEditMode = function (on) {
    g.editMode = !!on;
    g.clearPending(); g.clearSelectedEdge();
    container.classList.toggle('is-editing', g.editMode);
    if (g.editBtn) { g.editBtn.classList.toggle('is-on', g.editMode); g.editBtn.setAttribute('aria-pressed', g.editMode ? 'true' : 'false'); }
    ['prereq', 'recnext'].forEach(k => { const b = legendBtns[k]; if (b) b.classList.toggle('is-connector', g.editMode); });
    if (g.editMode) { g.viewport.classList.add('hide-pagelink'); g.setConnector(g.activeConnector); }
    else { ['prereq', 'recnext'].forEach(k => { const b = legendBtns[k]; if (b) b.classList.remove('is-connector-active'); }); }
    g.updateHint();
  };

  // ---- Minimap (small, best-effort; never allowed to break the main view) ----
  const mini = document.createElement('div');
  mini.className = 'graph-minimap';
  const miniSvg = svg('svg', { class: 'graph-minimap-svg' });
  const miniNodes = svg('g');
  const miniView = svg('rect', { class: 'graph-minimap-view' });
  miniSvg.appendChild(miniNodes);
  miniSvg.appendChild(miniView);
  mini.appendChild(miniSvg);
  container.appendChild(mini);
  g.miniSvg = miniSvg; g.miniNodes = miniNodes; g.miniView = miniView;

  // ---- Empty state ----
  if (g.model.nodes.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'graph-empty';
    empty.textContent = 'No documents to map.';
    container.appendChild(empty);
  }
}

// Custom "Map by" dropdown: a button showing the current type's swatch + label, and
// a popup list where each option carries its own coloured swatch (a native <select>
// can't). Selecting a different type calls g.onMapMode to relayout.
function buildMapModeDropdown(g) {
  const swatch = (cls) => { const s = document.createElement('span'); s.className = 'graph-legend-swatch ' + (cls || 'all'); return s; };
  const cur = () => g.mapModes.find(m => m.value === g.mapMode) || g.mapModes[0];

  const wrap = document.createElement('div');
  wrap.className = 'graph-mapmode';

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'graph-mapmode-btn';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  // Stack every label in one cell (only the current shown) so the button is always
  // as wide as the widest option - the legend never resizes on selection.
  const btnLabel = document.createElement('span'); btnLabel.className = 'graph-mapmode-label';
  g.mapModes.forEach(m => { const s = document.createElement('span'); s.textContent = m.label; if (m.value === g.mapMode) s.className = 'is-cur'; btnLabel.appendChild(s); });
  const caret = document.createElement('span'); caret.className = 'graph-mapmode-caret'; caret.textContent = '▾';
  btn.append(document.createTextNode('Map: '), swatch(cur().swatch), btnLabel, caret);

  const menu = document.createElement('div');
  menu.className = 'graph-mapmode-menu'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
  g.mapModes.forEach(m => {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'graph-mapmode-item' + (m.value === g.mapMode ? ' is-sel' : '');
    item.setAttribute('role', 'option');
    const lab = document.createElement('span'); lab.textContent = m.label;
    item.append(swatch(m.swatch), lab);
    item.addEventListener('click', () => { close(); if (m.value !== g.mapMode && g.onMapMode) g.onMapMode(m.value); });
    menu.appendChild(item);
  });

  let offClick = null;
  function open() {
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    offClick = (e) => { if (!wrap.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', offClick), 0);
  }
  function close() {
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
    if (offClick) { document.removeEventListener('mousedown', offClick); offClick = null; }
  }
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));

  wrap.append(btn, menu);
  return wrap;
}
