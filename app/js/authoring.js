// authoring.js - in-app CRUD: create / edit / delete documents, and the small
// helpers that edit a document's own metadata (assumes / next relationships and a
// test's verifies list). Extracted from main.js. It imports the map's graph-model
// helpers directly (buildDocGraph / ensureGraphModel / invalidateGraphModel) and
// reaches the shell through the `app` registry (app.navigate / app.showError /
// app.closeDrawer, wired by main at boot); it registers its own map- and coverage-
// facing handles (editDocRelation, deleteDocFlow, link/unlinkTestToRequirement).
import { state, el, app, titleFromId, defaultId, getDoc } from './app-shell.js';
import { openEditor, openNewDocModal, parseDoc, confirmDialog } from './editor.js';
import { buildDocGraph, ensureGraphModel, invalidateGraphModel } from './map-view.js';
import { renderTree } from './tree.js';
import { loadDoc } from './catalog.js';
import { buildRequirementIndex, requirementList, testList, resolveRequirementRef } from './requirements.js';

/** @typedef {import('./catalog.js').Doc} Doc */
/** @typedef {import('./catalog.js').SourceConfig} SourceConfig */
/** @typedef {import('./editor.js').Block} Block */
/** @typedef {import('./editor/serialize.js').DocMeta} DocMeta */
/** @typedef {import('./map-view.js').GraphDocNode} GraphDocNode */
/** @typedef {import('./requirements.js').TestCaseEntry} TestCaseEntry */

/**
 * The options object handed to editor/panels.js's openNewDocModal: the source
 * list, an id-existence-check callback, and a creation callback invoked on submit.
 * @typedef {Object} NewDocModalOpts
 * @property {SourceConfig[]} sources
 * @property {(id: string) => boolean} exists
 * @property {(id: string) => void} onCreate
 */

let editorEl = null;

/**
 * Re-render the tree after a create/delete (structure changed), wiring each entry to
 * navigate + close the drawer.
 * @returns {Promise<HTMLElement>}
 */
function rerenderTree() {
  return renderTree(el('treeList'), tid => { app.navigate(tid); app.closeDrawer(); });
}

/** Wire the header's new-document / edit / delete buttons. */
export function setupEditButtons() {
  el('newDocBtn').addEventListener('click', () => openNewDocFlow());
  el('editBtn').addEventListener('click', () => { if (state.current) editExisting(state.current); });
  el('deleteBtn').addEventListener('click', () => { if (state.current) deleteDocFlow(state.current.id, { rebuildMap: false }); });
}

/**
 * Open the "new document" modal, from the header ＋. The modal opens OVER the
 * current view (the map stays put) so nothing shifts while you name the doc; the
 * map is only dismissed once you confirm and enterEdit opens the editor (which
 * would otherwise sit behind the map overlay).
 * @returns {Promise<void>}
 */
async function openNewDocFlow() {
  // The "already exists" guard must see EVERY doc, not just visited ones - boot is
  // lazy so state.byId is sparse, and checking it would let a new doc silently
  // overwrite an existing (unvisited) file. Use the server graph model's full id set.
  const known = new Set((await ensureGraphModel()).docs.map(d => d.id));
  // From the map, "New document" just creates the file (and the node appears) - it
  // does NOT drop you into the editor. From the reader, it opens the editor as usual.
  const fromMap = !el('graphOverlay').hidden;
  openNewDocModal({
    sources: (state.site && state.site.sources) || [],
    exists: (id) => known.has(id) || state.byId.has(id),
    onCreate: (id) => fromMap ? createDocInPlace(id) : startNewDoc(id)
  });
}

async function startNewDoc(id) {
  const title = titleFromId(id);
  await enterEdit(id, { title, description: '', assumes: [], next: [] },
    [{ type: 'heading', level: 1, html: title }, { type: 'paragraph', html: '' }], true);
}

// Create a minimal document on disk WITHOUT opening the editor (used from the map:
// the file is written + indexed and its node appears; the user stays on the map).
// The body is just the meta header + an H1 - the same shape serializeDoc emits.
async function createDocInPlace(id) {
  const title = titleFromId(id);
  const md = '<!--meta\n' + JSON.stringify({ title: title, description: '', assumes: [], next: [] }, null, 2) +
    '\n-->\n\n# ' + title + '\n';
  const slash = id.indexOf('/');
  const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
  let res;
  try {
    res = await fetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'),
      { method: 'PUT', body: md });
  } catch (e) { el('live').textContent = 'Create failed: ' + e.message; return; }
  if (!res.ok) { el('live').textContent = 'Create failed (' + res.status + ')'; return; }
  await refreshCatalog();                    // server re-indexed on PUT; invalidate the client graph model
  await rerenderTree();                      // new file -> tree changed
  el('live').textContent = 'Created “' + title + '”.';
  if (!el('graphOverlay').hidden) buildDocGraph(true, true);   // rebuild the open map so the new node shows (keep view + animate)
}

/**
 * @param {Doc} doc
 * @returns {Promise<void>}
 */
async function editExisting(doc) {
  await loadDoc(doc);
  const parsed = parseDoc(doc.body || '', doc.meta || {});
  parsed.meta.title = doc.title || parsed.meta.title;
  parsed.meta.description = doc.description || parsed.meta.description;
  parsed.meta.assumes = (doc.assumes || []).slice();
  parsed.meta.next = (doc.next || []).slice();
  await enterEdit(doc.id, parsed.meta, parsed.blocks, false);
}

/**
 * @param {string} id
 * @param {DocMeta} meta
 * @param {Block[]} blocks
 * @param {boolean} isNew
 * @returns {Promise<void>}
 */
async function enterEdit(id, meta, blocks, isNew) {
  exitEdit();
  if (app.closeMapView) app.closeMapView();   // opening the editor: dismiss the map so it isn't left behind the editor
  document.body.classList.add('is-editing');
  // The metadata pickers (Assumed knowledge / Recommended next) need the full doc
  // list. Boot no longer holds one (lazy/server-backed), so pull it from the same
  // server graph model the map uses (cached; invalidated after a create/delete/edit).
  /** @type {GraphDocNode[]} */
  const allDocs = (await ensureGraphModel()).docs;
  editorEl = openEditor({
    docId: id, meta, blocks, isNew,
    sources: (state.site && state.site.sources) || [],
    allDocs: allDocs,
    requirements: requirementList(),
    component: componentFor(id),
    onSave: (md, newMeta, status) => saveDoc(id, md, isNew, status),
    onClose: () => { exitEdit(); app.navigate(state.byId.has(id) ? id : defaultId()); }
  });
  document.querySelector('.app-body').appendChild(editorEl);
}
/** Remove the open editor from the DOM, if any, and leave editing mode. */
function exitEdit() {
  document.body.classList.remove('is-editing');
  if (editorEl) { editorEl.remove(); editorEl = null; }
}
function componentFor(id) {
  const src = id.split('/')[0];
  const s = ((state.site && state.site.sources) || []).find(x => x.name === src);
  return s ? s.component : '';
}

/**
 * @param {string} id
 * @param {string} md - the fully serialized document to write
 * @param {boolean} wasNew
 * @param {HTMLElement} status - element to report save progress/errors into
 * @returns {Promise<void>}
 */
async function saveDoc(id, md, wasNew, status) {
  const slash = id.indexOf('/');
  const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
  let res;
  try {
    res = await fetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'),
      { method: 'PUT', body: md });
  } catch (e) { status.textContent = 'Save failed: ' + e.message; return; }
  if (!res.ok) { status.textContent = 'Save failed (' + res.status + ')'; return; }
  status.textContent = 'Saved.';
  const cached = state.byId.get(id); if (cached) cached._loaded = false;   // force a fresh reload of the new body
  await refreshCatalog();
  if (wasNew) await rerenderTree();   // new file -> tree structure changed
  exitEdit();
  app.navigate(id);
}

/**
 * After a write the SERVER index updates itself (serve.py do_PUT/do_DELETE hooks),
 * so the client only INVALIDATES caches and reloads what's affected - never re-walks
 * or re-loads the corpus (the old O(N)-on-every-save trap). Tree re-rendering happens
 * only at the specific create/delete sites, since a plain edit changes no structure.
 * `extraIds` covers documents whose content just changed on disk but that aren't
 * state.current (e.g. either end of a relationship edited from the map's
 * connect/disconnect mode) - without this they'd stay cached with stale
 * assumes/next until something else happens to invalidate them.
 * @param {string[]} [extraIds]
 * @returns {Promise<void>}
 */
async function refreshCatalog(extraIds) {
  invalidateGraphModel();
  await buildRequirementIndex(null, state.site.sources);   // refresh the global req index (cheap, server-side)
  (extraIds || []).forEach(id => { const cached = state.byId.get(id); if (cached) cached._loaded = false; });
  if (state.current) {
    state.current._loaded = false;                         // its body may have changed on disk
    try { await loadDoc(state.current); } catch (e) { /* deleted; caller navigates away */ }
  }
}

// ---- Delete a document (CRUD) ---------------------------------------------
/**
 * @param {string} id
 * @returns {Promise<{ok: true}|{ok: false, error: string}>}
 */
async function deleteDocRequest(id) {
  const slash = id.indexOf('/');
  const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
  const url = '/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/');
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) return { ok: true };
    let msg = 'server returned ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
    return { ok: false, error: msg };
  } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * Confirm, delete, refresh the catalog, then move off the deleted document.
 * `rebuildMap` re-renders an open map so the deleted node disappears in place.
 * @param {string} id
 * @param {{rebuildMap: boolean}} opts
 * @returns {Promise<void>}
 */
async function deleteDocFlow(id, opts) {
  if (!id) return;
  const doc = getDoc(id);
  const title = (doc && doc.title) || titleFromId(id);
  const confirmed = await confirmDialog({
    title: 'Delete this document?',
    message: '“' + title + '” (' + id + '.md) will be permanently deleted from disk. This can’t be undone.',
    confirmLabel: 'Delete', danger: true
  });
  if (!confirmed) return;
  const wasCurrent = !!(state.current && state.current.id === id);
  const r = await deleteDocRequest(id);
  if (!r.ok) {
    el('live').textContent = 'Delete failed: ' + r.error;
    await confirmDialog({ title: 'Delete failed', message: r.error, confirmLabel: 'OK', cancelLabel: null });
    return;
  }
  state.byId.delete(id);
  await refreshCatalog();
  await rerenderTree();   // structure changed
  el('live').textContent = 'Deleted “' + title + '”.';
  // If the reading view was showing the deleted doc, move it to a surviving one.
  if (wasCurrent) {
    const next = defaultId();
    if (next && next !== id) app.navigate(next); else app.showError('No documents left.');
  }
  // Refresh an open map in place so the deleted node is gone (keep view + animate).
  if (opts && opts.rebuildMap && !el('graphOverlay').hidden) buildDocGraph(true, true);
}

// Link / unlink a test case and a requirement by editing the requirement id in
// that test's `verifies` (in the test's own document), then rebuilding the index.
/**
 * @param {string} body - raw markdown of the test's own document
 * @param {string} testKey - the test's meta `test`/`test-case` key (not its full T_ id)
 * @param {string} reqId - fully resolved requirement id to add
 * @returns {string} the rewritten body, unchanged if the test's meta block wasn't found or it was already linked
 */
function addVerifyToBody(body, testKey, reqId) {
  return String(body).replace(/<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->/gi, (m, json) => {
    let meta; try { meta = JSON.parse(json); } catch (e) { return m; }
    if ((meta.test || meta['test-case']) !== testKey) return m;
    const v = Array.isArray(meta.verifies) ? meta.verifies.map(String) : [];
    if (v.indexOf(reqId) !== -1) return m;                 // already linked
    v.push(reqId); meta.verifies = v;
    return '<!--meta start ' + JSON.stringify(meta) + '-->';
  });
}
/**
 * @param {string} body - raw markdown of the test's own document
 * @param {string} testKey - the test's meta `test`/`test-case` key (not its full T_ id)
 * @param {string} reqId - fully resolved requirement id to remove
 * @param {string} component - the test's component, used to resolve short-form `verifies` entries before comparing
 * @returns {string} the rewritten body, unchanged if the test's meta block wasn't found or it wasn't linked
 */
function removeVerifyFromBody(body, testKey, reqId, component) {
  return String(body).replace(/<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->/gi, (m, json) => {
    let meta; try { meta = JSON.parse(json); } catch (e) { return m; }
    if ((meta.test || meta['test-case']) !== testKey) return m;
    const v = Array.isArray(meta.verifies) ? meta.verifies.map(String) : [];
    // drop any ref that IS or RESOLVES to reqId (verifies may hold short forms).
    const kept = v.filter(ref => ref !== reqId && resolveRequirementRef(ref, component) !== reqId);
    if (kept.length === v.length) return m;                // wasn't linked
    meta.verifies = kept;
    return '<!--meta start ' + JSON.stringify(meta) + '-->';
  });
}
/**
 * @param {TestCaseEntry} t
 * @param {string} newBody
 * @param {string} oldBody
 * @returns {Promise<boolean>} true if nothing needed to change, or the write succeeded
 */
async function writeTestDocBody(t, newBody, oldBody) {
  if (newBody === oldBody) return true;                    // no change
  const slash = t.docId.indexOf('/');
  const source = t.docId.slice(0, slash), rel = t.docId.slice(slash + 1) + '.md';
  let res;
  try {
    res = await fetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'),
      { method: 'PUT', body: newBody });
  } catch (e) { return false; }
  if (!res.ok) return false;
  await refreshCatalog();
  return true;
}
/**
 * @param {string} testId
 * @param {string} reqId
 * @returns {Promise<boolean>} true on success
 */
async function linkTestToRequirement(testId, reqId) {
  const t = testList().find(x => x.id === testId);
  if (!t) return false;
  const doc = state.byId.get(t.docId); if (!doc) return false;
  try { await loadDoc(doc); } catch (e) {}
  const body = doc.body || '';
  return writeTestDocBody(t, addVerifyToBody(body, t.key, reqId), body);
}
/**
 * @param {string} testId
 * @param {string} reqId
 * @returns {Promise<boolean>} true on success
 */
async function unlinkTestFromRequirement(testId, reqId) {
  const t = testList().find(x => x.id === testId);
  if (!t) return false;
  const doc = state.byId.get(t.docId); if (!doc) return false;
  try { await loadDoc(doc); } catch (e) {}
  const body = doc.body || '';
  return writeTestDocBody(t, removeVerifyFromBody(body, t.key, reqId, t.component), body);
}

/**
 * Add/remove an id in a document's own `<!--meta-->` header list (assumes|next).
 * Used by the map's "Edit connections" mode to author relationships directly.
 * @param {string} body - raw on-disk markdown, including the doc-level meta header
 * @param {'assumes'|'next'} field
 * @param {string|null} addId
 * @param {string|null} removeId
 * @returns {string} the rewritten raw markdown, unchanged if there is no meta header to edit
 */
function editDocMetaBody(body, field, addId, removeId) {
  const s = String(body);
  const m = s.match(/^(﻿?)<!--meta\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) return s;                                  // no doc-level meta header to edit
  let meta; try { meta = JSON.parse(m[2]); } catch (e) { return s; }
  let arr = Array.isArray(meta[field]) ? meta[field].map(String) : [];
  if (addId && arr.indexOf(addId) === -1) arr.push(addId);
  if (removeId) arr = arr.filter(x => x !== removeId);
  meta[field] = arr;
  return (m[1] || '') + '<!--meta\n' + JSON.stringify(meta, null, 2) + '\n-->' + s.slice(m[0].length);
}
/**
 * @param {string} fromId
 * @param {string} toId
 * @param {'assumes'|'next'} field
 * @param {'add'|'remove'} action
 * @returns {Promise<boolean>} true on success (including an already-in-the-desired-state no-op)
 */
async function editDocRelation(fromId, toId, field, action) {
  if (!fromId || !toId || fromId === toId) return false;
  const slash = fromId.indexOf('/');
  const source = fromId.slice(0, slash), rel = fromId.slice(slash + 1) + '.md';
  const url = '/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/');
  // Edit the RAW file: discovery strips the doc-level <!--meta--> out of doc.body,
  // so we fetch the on-disk markdown (header intact), rewrite it, and PUT it back.
  let raw;
  try { const r = await fetch(url); if (!r.ok) return false; raw = await r.text(); }
  catch (e) { return false; }
  const newBody = editDocMetaBody(raw, field, action === 'add' ? toId : null, action === 'remove' ? toId : null);
  if (newBody === raw) return true;                  // already in the desired state
  let res;
  try { res = await fetch(url, { method: 'PUT', body: newBody }); }
  catch (e) { return false; }
  if (!res.ok) return false;
  await refreshCatalog([fromId, toId]);   // fromId's file changed; invalidate both ends of the relationship
  return true;
}

// Map + coverage reach these through the shared registry (map: edit-connections +
// Delete; coverage report panel: link / unlink a test from a requirement).
app.editDocRelation = editDocRelation;
app.deleteDocFlow = deleteDocFlow;
app.linkTestToRequirement = linkTestToRequirement;
app.unlinkTestFromRequirement = unlinkTestFromRequirement;
