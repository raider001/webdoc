// authoring.ts - in-app CRUD: create / edit / delete documents, and the small
// helpers that edit a document's own metadata (assumes / next relationships and a
// test's verifies list). Extracted from main.ts. It imports the map's graph-model
// helpers directly (buildDocGraph / ensureGraphModel / invalidateGraphModel) and
// reaches the shell through the `app` registry (app.navigate / app.showError /
// app.closeDrawer, wired by main at boot); it registers its own map- and coverage-
// facing handles (editDocRelation, deleteDocFlow, link/unlinkTestToRequirement).
import { errorMessage } from './errors.js';
import { state, mustEl, app, titleFromId, defaultId, getDoc } from './app-shell.js';
// editor.js is NOT imported statically. It is the largest module graph in the app
// (editor.js plus editor/{serialize,richtext,widgets,panels,ui}.js, ~1,800 lines),
// and a reader who only ever reads never opens it. Every entry point below awaits
// editorModule() first, so the editor is fetched on the first authoring action and
// cached by the module loader from then on.
//
// setLinkSearch is still configured by main.ts at boot, but against
// editor/richtext.js directly - that module imports only dom.ts, so wiring link
// autocomplete early costs nothing and does not drag the editor in.
let editorMod = null;
function editorModule() {
    if (!editorMod)
        editorMod = import('./editor.js');
    return editorMod;
}
import { ensureGraphModel, invalidateGraphModel } from './graph-model.js';
import { announce } from './announce.js';
import { mapOpen, requestMapRebuild } from './overlays.js';
import { loadDoc } from './catalog.js';
import { buildRequirementIndex, requirementList, testList, resolveRequirementRef } from './requirements.js';
import { apiFetch, describeFailure, auth, docAccess, invalidateAccess } from './auth.js';
/** The open editor's root element, so exitEdit can take it back out. */
let editorEl = null;
/**
 * Re-render the tree after a create/delete (structure changed), wiring each entry to
 * navigate + close the drawer.
 */
/**
 * Refresh the drawer tree after a structural change (create / delete / move).
 *
 * This used to REBUILD the tree from scratch, which threw away every folder the
 * reader had expanded. It is now a data refresh: the components refetch the
 * levels that are open and keep the expansion, because that state lives in a
 * store rather than on the DOM nodes.
 */
function rerenderTree() {
    if (app.invalidateTree)
        app.invalidateTree();
}
/** Wire the header's new-document / edit / delete buttons. */
export function setupEditButtons() {
    const newDocBtn = mustEl('newDocBtn');
    newDocBtn.addEventListener('click', () => openNewDocFlow());
    mustEl('editBtn').addEventListener('click', () => { if (state.current)
        editExisting(state.current); });
    mustEl('deleteBtn').addEventListener('click', () => { if (state.current)
        deleteDocFlow(state.current.id, { rebuildMap: false }); });
    newDocBtn.hidden = !auth.canWrite;
}
/**
 * Show or hide the edit / delete controls for the document now on screen.
 *
 * Presentation only: the server re-checks every write regardless, so this is
 * about not offering an action that will be refused - not about enforcing
 * anything. Called by the reader through the `app` registry on each render.
 */
async function updateDocActions(docId) {
    const edit = mustEl('editBtn'), del = mustEl('deleteBtn');
    if (!auth.enabled) {
        edit.hidden = false;
        del.hidden = false;
        return;
    }
    // Hide immediately, reveal once the server has answered - so the buttons never
    // flash on for a document this account cannot touch.
    edit.hidden = true;
    del.hidden = true;
    const info = await docAccess(docId);
    if (!info || !state.current || state.current.id !== docId)
        return; // navigated away
    // A page with sections withheld from this reader is read-only for them: saving
    // it back would overwrite what they were never shown.
    const partial = (info.redactedSections || 0) > 0;
    edit.hidden = !info.canWrite || partial;
    // Deleting a restricted page also needs access-management rights, because
    // removing the page removes its ACL with it.
    const restricted = !!(info.effective && (info.effective.read || info.effective.hidden));
    del.hidden = !info.canWrite || partial || (restricted && !info.canEditAccess);
}
app.updateDocActions = updateDocActions;
/**
 * Open the "new document" modal, from the header ＋. The modal opens OVER the
 * current view (the map stays put) so nothing shifts while you name the doc; the
 * map is only dismissed once you confirm and enterEdit opens the editor (which
 * would otherwise sit behind the map overlay).
 */
async function openNewDocFlow() {
    // The "already exists" guard must see EVERY doc, not just visited ones - boot is
    // lazy so state.byId is sparse, and checking it would let a new doc silently
    // overwrite an existing (unvisited) file. Use the server graph model's full id set.
    const known = new Set((await ensureGraphModel()).docs.map(d => d.id));
    // From the map, "New document" just creates the file (and the node appears) - it
    // does NOT drop you into the editor. From the reader, it opens the editor as usual.
    const fromMap = mapOpen();
    const { openNewDocModal } = await editorModule();
    openNewDocModal({
        sources: (state.site && state.site.sources) || [],
        exists: (id) => known.has(id) || state.byId.has(id),
        onCreate: (id) => fromMap ? createDocInPlace(id) : startNewDoc(id)
    });
}
async function startNewDoc(id) {
    const title = titleFromId(id);
    await enterEdit(id, { title, description: '', assumes: [], next: [] }, [{ type: 'heading', level: 1, html: title }, { type: 'paragraph', html: '' }], true);
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
        res = await apiFetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', body: md });
    }
    catch (e) {
        announce('Create failed: ' + errorMessage(e));
        return;
    }
    if (!res.ok) {
        announce('Create failed: ' + await describeFailure(res));
        return;
    }
    await refreshCatalog(); // server re-indexed on PUT; invalidate the client graph model
    await rerenderTree(); // new file -> tree changed
    announce('Created “' + title + '”.');
    await requestMapRebuild(); // no-op unless the map is open; loads map-view.js only if it is
}
async function editExisting(doc) {
    await loadDoc(doc);
    // A reader who was served a REDACTED copy must not edit it: saving would write
    // the placeholders over the real sections. The server refuses this too - this
    // is just a better place to say so than a failed save.
    const info = await docAccess(doc.id);
    if (info && info.redactedSections) {
        await (await editorModule()).confirmDialog({
            title: 'This page cannot be edited here',
            message: 'Parts of this page are restricted to groups your account is not in. '
                + 'Editing it would overwrite the sections you cannot see, so it is read-only for you.',
            confirmLabel: 'OK', cancelLabel: null
        });
        return;
    }
    const { parseDoc } = await editorModule();
    const parsed = parseDoc(doc.body || '', doc.meta || {});
    if (parsed.lostMarkers) {
        // A restricted-section marker could not be represented as a block, so saving
        // would delete a permission boundary. Refuse rather than lose it.
        await (await editorModule()).confirmDialog({
            title: 'This page cannot be edited here',
            message: 'It contains a restricted-section marker in a position the visual editor cannot '
                + 'represent, and saving would remove it. Edit the Markdown file directly instead.',
            confirmLabel: 'OK', cancelLabel: null
        });
        return;
    }
    parsed.meta.title = doc.title || parsed.meta.title;
    parsed.meta.description = doc.description || parsed.meta.description;
    parsed.meta.assumes = (doc.assumes || []).slice();
    parsed.meta.next = (doc.next || []).slice();
    await enterEdit(doc.id, parsed.meta, parsed.blocks, false);
}
async function enterEdit(id, meta, blocks, isNew) {
    exitEdit();
    if (app.closeMapView)
        app.closeMapView(); // opening the editor: dismiss the map so it isn't left behind the editor
    document.body.classList.add('is-editing');
    // The metadata pickers (Assumed knowledge / Recommended next) need the full doc
    // list. Boot no longer holds one (lazy/server-backed), so pull it from the same
    // server graph model the map uses (cached; invalidated after a create/delete/edit).
    const allDocs = (await ensureGraphModel()).docs;
    const access = await docAccess(id);
    const { openEditor } = await editorModule();
    editorEl = openEditor({
        docId: id, meta, blocks, isNew,
        sources: (state.site && state.site.sources) || [],
        allDocs: allDocs,
        knownGroups: (access && access.knownGroups) || [],
        docAccess: access,
        requirements: requirementList(),
        component: componentFor(id),
        // serializeDoc has already folded the edited metadata into `md`, so the
        // second argument is redundant here - only `status` is wanted after it.
        onSave: (md, _newMeta, status) => saveDoc(id, md, isNew, status),
        onClose: () => {
            exitEdit();
            // Back to the document just edited if it is known, else the site default.
            // With neither there is nowhere to route to, so stay put rather than push a
            // "#/undefined" the router could only turn into an error screen.
            const back = state.byId.has(id) ? id : defaultId();
            if (back && app.navigate)
                app.navigate(back);
        }
    });
    // The editor mounts into the app-body shell. index.html always has it, and the
    // whole editing flow is meaningless without it, so a missing host is a broken
    // template rather than a state worth degrading through.
    const appBody = document.querySelector('.app-body');
    if (!appBody)
        throw new Error('Cannot open the editor: .app-body is missing from the page.');
    appBody.appendChild(editorEl);
}
/** Remove the open editor from the DOM, if any, and leave editing mode. */
function exitEdit() {
    document.body.classList.remove('is-editing');
    if (editorEl) {
        editorEl.remove();
        editorEl = null;
    }
}
/**
 * The requirement-id prefix declared for whichever source `id` lives in.
 */
function componentFor(id) {
    const src = id.split('/')[0];
    // state.site is the parsed site.json, so `sources` is already the declared
    // SourceConfig list (catalog.ts) and can be searched directly.
    const s = ((state.site && state.site.sources) || []).find(x => x.name === src);
    return (s && s.component) || ''; // `component` is an optional per-source key
}
/**
 * Write a document back to disk. `md` is the fully serialized document; `status`
 * is the element to report save progress/errors into.
 */
async function saveDoc(id, md, wasNew, status) {
    const slash = id.indexOf('/');
    const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
    let res;
    try {
        res = await apiFetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', body: md });
    }
    catch (e) {
        status.textContent = 'Save failed: ' + errorMessage(e);
        return;
    }
    if (!res.ok) {
        status.textContent = 'Save failed: ' + await describeFailure(res);
        return;
    }
    status.textContent = 'Saved.';
    const cached = state.byId.get(id);
    if (cached)
        cached._loaded = false; // force a fresh reload of the new body
    await refreshCatalog();
    if (wasNew)
        await rerenderTree(); // new file -> tree structure changed
    exitEdit();
    if (app.navigate)
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
 */
async function refreshCatalog(extraIds) {
    invalidateGraphModel();
    invalidateAccess(); // a write can change the effective ACL of everything downstream
    await buildRequirementIndex(null, (state.site && state.site.sources) || []); // refresh the global req index (cheap, server-side)
    (extraIds || []).forEach(id => { const cached = state.byId.get(id); if (cached)
        cached._loaded = false; });
    if (state.current) {
        state.current._loaded = false; // its body may have changed on disk
        try {
            await loadDoc(state.current);
        }
        catch (e) { /* deleted; caller navigates away */ }
    }
}
// ---- Delete a document (CRUD) ---------------------------------------------
/**
 * `error` carries a describeFailure() sentence whenever ok is false.
 */
async function deleteDocRequest(id) {
    const slash = id.indexOf('/');
    const source = id.slice(0, slash), rel = id.slice(slash + 1) + '.md';
    const url = '/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/');
    try {
        const res = await apiFetch(url, { method: 'DELETE' });
        if (res.ok)
            return { ok: true };
        return { ok: false, error: await describeFailure(res) };
    }
    catch (e) {
        return { ok: false, error: errorMessage(e) };
    }
}
/**
 * Confirm, delete, refresh the catalog, then move off the deleted document.
 * `rebuildMap` re-renders an open map so the deleted node disappears in place.
 */
async function deleteDocFlow(id, opts) {
    if (!id)
        return;
    const doc = getDoc(id);
    const title = (doc && doc.title) || titleFromId(id);
    const confirmed = await (await editorModule()).confirmDialog({
        title: 'Delete this document?',
        message: '“' + title + '” (' + id + '.md) will be permanently deleted from disk. This can’t be undone.',
        confirmLabel: 'Delete', danger: true
    });
    if (!confirmed)
        return;
    const wasCurrent = !!(state.current && state.current.id === id);
    const r = await deleteDocRequest(id);
    if (!r.ok) {
        announce('Delete failed: ' + r.error);
        await (await editorModule()).confirmDialog({ title: 'Delete failed', message: r.error, confirmLabel: 'OK', cancelLabel: null });
        return;
    }
    state.byId.delete(id);
    await refreshCatalog();
    await rerenderTree(); // structure changed
    announce('Deleted “' + title + '”.');
    // If the reading view was showing the deleted doc, move it to a surviving one.
    if (wasCurrent) {
        const next = defaultId();
        // Both are wired by main.ts at boot, but the registry is optional by design -
        // every other call site guards, and so does this one.
        if (next && next !== id) {
            if (app.navigate)
                app.navigate(next);
        }
        else if (app.showError)
            app.showError('No documents left.');
    }
    // Refresh an open map in place so the deleted node is gone (keep view + animate).
    if (opts && opts.rebuildMap)
        await requestMapRebuild();
}
// Link / unlink a test case and a requirement by editing the requirement id in
// that test's `verifies` (in the test's own document), then rebuilding the index.
/**
 * Add `reqId` to a test's `verifies`. `body` is the raw markdown of the test's own
 * document and `testKey` is the test's meta `test`/`test-case` key (not its full
 * T_ id). Returns the rewritten body, unchanged if the test's meta block wasn't
 * found or it was already linked.
 */
function addVerifyToBody(body, testKey, reqId) {
    return String(body).replace(/<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->/gi, (m, json) => {
        let meta;
        try {
            meta = JSON.parse(json);
        }
        catch (e) {
            return m;
        }
        if ((meta.test || meta['test-case']) !== testKey)
            return m;
        const v = Array.isArray(meta.verifies) ? meta.verifies.map(String) : [];
        if (v.indexOf(reqId) !== -1)
            return m; // already linked
        v.push(reqId);
        meta.verifies = v;
        return '<!--meta start ' + JSON.stringify(meta) + '-->';
    });
}
/**
 * Remove `reqId` from a test's `verifies`. Same `body` / `testKey` as above;
 * `component` is the test's component, used to resolve short-form `verifies`
 * entries before comparing. Returns the rewritten body, unchanged if the test's
 * meta block wasn't found or it wasn't linked.
 */
function removeVerifyFromBody(body, testKey, reqId, component) {
    return String(body).replace(/<!--\s*meta\s+start\s*(\{[\s\S]*?\})\s*-->/gi, (m, json) => {
        let meta;
        try {
            meta = JSON.parse(json);
        }
        catch (e) {
            return m;
        }
        if ((meta.test || meta['test-case']) !== testKey)
            return m;
        const v = Array.isArray(meta.verifies) ? meta.verifies.map(String) : [];
        // drop any ref that IS or RESOLVES to reqId (verifies may hold short forms).
        const kept = v.filter(ref => ref !== reqId && resolveRequirementRef(ref, component) !== reqId);
        if (kept.length === v.length)
            return m; // wasn't linked
        meta.verifies = kept;
        return '<!--meta start ' + JSON.stringify(meta) + '-->';
    });
}
/**
 * Returns true if nothing needed to change, or the write succeeded.
 */
async function writeTestDocBody(t, newBody, oldBody) {
    if (newBody === oldBody)
        return true; // no change
    const slash = t.docId.indexOf('/');
    const source = t.docId.slice(0, slash), rel = t.docId.slice(slash + 1) + '.md';
    let res;
    try {
        res = await apiFetch('/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', body: newBody });
    }
    catch (e) {
        return false;
    }
    if (!res.ok)
        return false;
    await refreshCatalog();
    return true;
}
/**
 * Fetch a document's RAW markdown - the on-disk bytes, meta header included.
 *
 * `doc.body` is NOT this: catalog.loadDoc splits the <!--meta--> header off, so
 * writing doc.body back erases the header - the title, the assumes/next links,
 * and the access rule along with them.
 */
async function rawDoc(docId) {
    const slash = docId.indexOf('/');
    const url = '/docs/' + encodeURIComponent(docId.slice(0, slash)) + '/'
        + (docId.slice(slash + 1) + '.md').split('/').map(encodeURIComponent).join('/');
    try {
        const r = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
        return r.ok ? await r.text() : null;
    }
    catch (e) {
        return null;
    }
}
/** Returns true on success. */
async function linkTestToRequirement(testId, reqId) {
    const t = testList().find(x => x.id === testId);
    if (!t)
        return false;
    const raw = await rawDoc(t.docId);
    if (raw === null)
        return false;
    return writeTestDocBody(t, addVerifyToBody(raw, t.key, reqId), raw);
}
/** Returns true on success. */
async function unlinkTestFromRequirement(testId, reqId) {
    const t = testList().find(x => x.id === testId);
    if (!t)
        return false;
    const raw = await rawDoc(t.docId);
    if (raw === null)
        return false;
    return writeTestDocBody(t, removeVerifyFromBody(raw, t.key, reqId, t.component), raw);
}
/**
 * Add/remove an id in a document's own `<!--meta-->` header list (assumes|next).
 * Used by the map's "Edit connections" mode to author relationships directly.
 * `body` is the raw on-disk markdown, including the doc-level meta header;
 * returns the rewritten raw markdown, unchanged if there is no meta header to edit.
 */
function editDocMetaBody(body, field, addId, removeId) {
    const s = String(body);
    const m = s.match(/^(﻿?)<!--meta\s*(\{[\s\S]*?\})\s*-->/);
    if (!m)
        return s; // no doc-level meta header to edit
    let meta;
    try {
        meta = JSON.parse(m[2]);
    }
    catch (e) {
        return s;
    }
    const declared = meta[field];
    let arr = Array.isArray(declared) ? declared.map(String) : [];
    if (addId && arr.indexOf(addId) === -1)
        arr.push(addId);
    if (removeId)
        arr = arr.filter(x => x !== removeId);
    meta[field] = arr;
    return (m[1] || '') + '<!--meta\n' + JSON.stringify(meta, null, 2) + '\n-->' + s.slice(m[0].length);
}
/**
 * Returns true on success (including an already-in-the-desired-state no-op).
 */
async function editDocRelation(fromId, toId, field, action) {
    if (!fromId || !toId || fromId === toId)
        return false;
    const slash = fromId.indexOf('/');
    const source = fromId.slice(0, slash), rel = fromId.slice(slash + 1) + '.md';
    const url = '/docs/' + encodeURIComponent(source) + '/' + rel.split('/').map(encodeURIComponent).join('/');
    // Edit the RAW file: discovery strips the doc-level <!--meta--> out of doc.body,
    // so we fetch the on-disk markdown (header intact), rewrite it, and PUT it back.
    let raw;
    try {
        const r = await fetch(url);
        if (!r.ok)
            return false;
        raw = await r.text();
    }
    catch (e) {
        return false;
    }
    const newBody = editDocMetaBody(raw, field, action === 'add' ? toId : null, action === 'remove' ? toId : null);
    if (newBody === raw)
        return true; // already in the desired state
    let res;
    try {
        res = await apiFetch(url, { method: 'PUT', body: newBody });
    }
    catch (e) {
        return false;
    }
    if (!res.ok)
        return false;
    await refreshCatalog([fromId, toId]); // fromId's file changed; invalidate both ends of the relationship
    return true;
}
// Map + coverage reach these through the shared registry (map: edit-connections +
// Delete; coverage report panel: link / unlink a test from a requirement).
app.editDocRelation = editDocRelation;
app.deleteDocFlow = deleteDocFlow;
app.linkTestToRequirement = linkTestToRequirement;
app.unlinkTestFromRequirement = unlinkTestFromRequirement;
