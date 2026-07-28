// graph/chrome.js - the overlay chrome (zoom controls, search box, legend /
// connector pickers, edit-connections toggle + hint, minimap container, empty
// state) plus the edit-mode state machine (arming a connector, marking a source
// node, selecting an edge, toggling edit mode). Everything hangs off context `g`.
import { elem, append } from '../dom.js';
import { plusIcon, minusIcon, fitIcon, editIcon, focusIcon, chevronDownIcon } from '../icons.js';

/** @typedef {import('../graph.js').GraphContext} GraphContext */

/**
 * Build the overlay chrome (zoom controls, search box, legend / map-mode /
 * connector pickers, edit-connections toggle + hint, new-document / focus
 * buttons, minimap container, empty state) and install the edit-mode state
 * machine (g.setConnector / g.markSource / g.clearPending /
 * g.clearSelectedEdge / g.selectEdge / g.updateHint / g.setEditMode) onto the
 * shared context.
 * @param {GraphContext} g
 * @returns {void}
 */
export function buildChrome(g) {
  const container = g.container;

  const ctrlBtn = (icon, aria) => elem('button', { type: 'button', class: 'graph-ctrl-btn', 'aria-label': aria, title: aria }, icon);

  // ---- Zoom controls ----
  g.btnIn = ctrlBtn(plusIcon(), 'Zoom in');
  g.btnOut = ctrlBtn(minusIcon(), 'Zoom out');
  g.btnFit = ctrlBtn(fitIcon(), 'Fit to view');
  container.appendChild(elem('div', 'graph-controls', g.btnIn, g.btnOut, g.btnFit));

  // ---- Search ----
  const searchInput = elem('input', { type: 'search', placeholder: 'Find a document…', 'aria-label': 'Find a document in the map', autocomplete: 'off' });
  container.appendChild(elem('div', 'graph-search', searchInput));
  g.searchInput = searchInput;

  // ---- Legend (each entry toggles a category; in edit mode prereq/recnext act
  //      as connector pickers instead) ----
  const legendBtns = {};
  g.legendBtns = legendBtns;
  /**
   * One legend entry: toggles category `swatchCls`'s visibility, unless edit
   * mode is on and it's prereq/recnext, in which case it picks the active
   * connector instead.
   * @param {string} swatchCls - edge category ('prereq'|'recnext'|'trace'|'pagelink'|'missing')
   * @param {string} label
   * @returns {HTMLElement}
   */
  function legendToggle(swatchCls, label) {
    const b = elem('button', { type: 'button', class: 'graph-legend-item', 'data-kind': swatchCls, 'aria-pressed': 'true', title: 'Toggle ' + label },
      elem('span', 'graph-legend-swatch ' + swatchCls), label);
    b.addEventListener('click', function () {
      if (g.editMode && (swatchCls === 'prereq' || swatchCls === 'recnext')) { g.setConnector(swatchCls); return; }
      g.vis[swatchCls] = !g.vis[swatchCls];      // canvas draw-state (was a viewport CSS class)
      const hidden = !g.vis[swatchCls];
      b.setAttribute('aria-pressed', hidden ? 'false' : 'true');
      b.classList.toggle('is-off', hidden);
      g.requestDraw();
    });
    legendBtns[swatchCls] = b;
    return b;
  }
  if (!g.opts.hideLegend) {
    const legend = elem('div', 'graph-legend');
    // "Map by" dropdown: choose which connection type drives the tree layout. A
    // custom dropdown (not native <select>) so each option can carry its swatch.
    if (Array.isArray(g.mapModes) && g.mapModes.length > 1) append(legend, buildMapModeDropdown(g));
    append(legend,
      legendToggle('prereq', 'Prerequisite'),
      legendToggle('recnext', 'Recommended next'),
      g.traceEdges.length && legendToggle('trace', 'Requirement trace'),
      g.pageLinks.length && legendToggle('pagelink', 'Page link'),
      legendToggle('missing', 'Missing'));
    container.appendChild(legend);
  }

  // ---- Edit-connections toggle + hint (only when editable) ----
  g.editBtn = null; g.hintEl = null;
  if (g.editable && !g.opts.hideLegend) {
    g.editBtn = elem('button', { type: 'button', class: 'graph-edit-toggle', 'aria-pressed': 'false', title: 'Draw or delete connections between documents', onClick: () => g.setEditMode(!g.editMode) }, editIcon(), ' Edit connections');
    g.hintEl = elem('div', { class: 'graph-edit-hint', hidden: true });
    append(container, g.editBtn, g.hintEl);
  }

  // ---- New-document button (doc map only; the app wires g.onCreate) ----
  if (g.onCreate) {
    g.newBtn = elem('button', { type: 'button', class: 'graph-new-btn', title: 'Create a new document', onClick: () => g.onCreate() }, plusIcon(), ' New document');
    container.appendChild(g.newBtn);
  }

  // ---- Focus-mode toggle (doc map only; the app wires g.onFocusToggle) ----
  if (g.onFocusToggle) {
    g.focusBtn = elem('button', { type: 'button', class: 'graph-focus-toggle' + (g.focusMode ? ' is-on' : ''), 'aria-pressed': g.focusMode ? 'true' : 'false', title: 'Focus mode: click a node to centre the map on it and its links (Esc resets)', onClick: () => g.onFocusToggle() }, focusIcon(), ' Focus');
    container.appendChild(g.focusBtn);
  }

  // ---- Edit-mode state machine ----
  /**
   * @param {string} type - 'prereq' | 'recnext'
   * @returns {void}
   */
  g.setConnector = function (type) {
    g.activeConnector = type;
    ['prereq', 'recnext'].forEach(k => {
      const b = legendBtns[k];
      if (b) b.classList.toggle('is-connector-active', g.editMode && k === type);
    });
    g.updateHint();
  };
  // Edit-mode selection is canvas draw-state now (no per-node/-edge DOM to class).
  g.markSource = function (id) { g.pendingSource = id; g.requestDraw(); };
  g.clearPending = function () { g.pendingSource = null; g.requestDraw(); };
  g.clearSelectedEdge = function () { g.selectedEdge = null; g.requestDraw(); };
  /**
   * @param {string} from
   * @param {string} to
   * @param {string} type
   * @returns {void}
   */
  g.selectEdge = function (from, to, type) {
    g.clearPending();
    g.selectedEdge = { from: from, to: to, type: type };
    g.updateHint(); g.requestDraw();
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
  /**
   * @param {boolean} on
   * @returns {void}
   */
  g.setEditMode = function (on) {
    g.editMode = !!on;
    g.clearPending(); g.clearSelectedEdge();
    container.classList.toggle('is-editing', g.editMode);
    if (g.editBtn) { g.editBtn.classList.toggle('is-on', g.editMode); g.editBtn.setAttribute('aria-pressed', g.editMode ? 'true' : 'false'); }
    ['prereq', 'recnext'].forEach(k => { const b = legendBtns[k]; if (b) b.classList.toggle('is-connector', g.editMode); });
    if (g.editMode) {
      g.vis.pagelink = false;   // page links are inert while editing (was viewport.hide-pagelink)
      if (legendBtns.pagelink) { legendBtns.pagelink.setAttribute('aria-pressed', 'false'); legendBtns.pagelink.classList.add('is-off'); }
      g.setConnector(g.activeConnector);
    } else {
      g.vis.pagelink = true;
      if (legendBtns.pagelink) { legendBtns.pagelink.setAttribute('aria-pressed', 'true'); legendBtns.pagelink.classList.remove('is-off'); }
      ['prereq', 'recnext'].forEach(k => { const b = legendBtns[k]; if (b) b.classList.remove('is-connector-active'); });
    }
    g.requestDraw();
    g.updateHint();
  };

  // ---- Minimap (small, best-effort; never allowed to break the main view) ----
  const miniCanvas = elem('canvas', 'graph-minimap-svg');   // reuse the 100% x 100% sizing rule
  container.appendChild(elem('div', 'graph-minimap', miniCanvas));
  g.miniCanvas = miniCanvas; g.miniCtx = miniCanvas.getContext('2d');

  // ---- Empty state ----
  if (g.model.nodes.size === 0) container.appendChild(elem('div', 'graph-empty', 'No documents to map.'));
}

// Custom "Map by" dropdown: a button showing the current type's swatch + label, and
// a popup list where each option carries its own coloured swatch (a native <select>
// can't). Selecting a different type calls g.onMapMode to relayout.
/**
 * @param {GraphContext} g
 * @returns {HTMLElement}
 */
function buildMapModeDropdown(g) {
  const swatch = (cls) => elem('span', 'graph-legend-swatch ' + (cls || 'all'));
  const cur = () => g.mapModes.find(m => m.value === g.mapMode) || g.mapModes[0];

  // Stack every label in one cell (only the current shown) so the button is always
  // as wide as the widest option - the legend never resizes on selection.
  const btnLabel = elem('span', 'graph-mapmode-label',
    g.mapModes.map(m => elem('span', { class: m.value === g.mapMode ? 'is-cur' : null }, m.label)));
  const btn = elem('button', { type: 'button', class: 'graph-mapmode-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
    'Map: ', swatch(cur().swatch), btnLabel, elem('span', 'graph-mapmode-caret', chevronDownIcon()));

  const menu = elem('div', { class: 'graph-mapmode-menu', role: 'listbox', hidden: true },
    g.mapModes.map(m => elem('button', {
      type: 'button', class: 'graph-mapmode-item' + (m.value === g.mapMode ? ' is-sel' : ''), role: 'option',
      onClick: () => { close(); if (m.value !== g.mapMode && g.onMapMode) g.onMapMode(m.value); }
    }, swatch(m.swatch), elem('span', null, m.label))));

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

  const wrap = elem('div', 'graph-mapmode', btn, menu);
  return wrap;
}
