// editor/panels.js - the editor's document-metadata side panel and the
// standalone "new document" modal (choose source + web path).
import { labelEl, labeledInput, labeledTextarea } from './ui.js';

/* ---- metadata panel (right side of the editor) ---- */
export function metadataPanel(meta, allDocs, selfId) {
  const panel = document.createElement('aside'); panel.className = 'editor-meta';
  panel.appendChild(hd('Document metadata'));
  panel.appendChild(labeledInput('Title', meta.title || '', v => meta.title = v));
  panel.appendChild(labeledTextarea('Description', meta.description || '', v => meta.description = v));
  panel.appendChild(docPicker('Assumed knowledge', meta.assumes, allDocs, selfId));
  panel.appendChild(docPicker('Recommended next', meta.next, allDocs, selfId));
  return panel;
  function hd(t) { const h = document.createElement('h2'); h.className = 'editor-meta-h'; h.textContent = t; return h; }
}
function docPicker(label, arr, allDocs, selfId) {
  const wrap = document.createElement('div'); wrap.className = 'meta-field';
  const lab = document.createElement('label'); lab.textContent = label; wrap.appendChild(lab);
  const chips = document.createElement('div'); chips.className = 'meta-chips'; wrap.appendChild(chips);
  const sel = document.createElement('select'); sel.className = 'meta-select';
  const ph = document.createElement('option'); ph.value = ''; ph.textContent = '+ add…'; sel.appendChild(ph);
  (allDocs || []).filter(d => d.id !== selfId).forEach(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = d.title + '  (' + d.id + ')'; sel.appendChild(o); });
  sel.addEventListener('change', () => { if (sel.value && !arr.includes(sel.value)) { arr.push(sel.value); redraw(); } sel.value = ''; });
  wrap.appendChild(sel);
  function redraw() {
    chips.textContent = '';
    arr.forEach((id, i) => {
      const c = document.createElement('span'); c.className = 'meta-chip';
      c.textContent = id;
      const x = document.createElement('button'); x.textContent = '✕'; x.addEventListener('click', () => { arr.splice(i, 1); redraw(); });
      c.appendChild(x); chips.appendChild(c);
    });
  }
  redraw();
  return wrap;
}

/* ---- new-document modal ----
   opts: { sources:[{name,component}], exists(id)->bool, onCreate(id) } ---- */
export function openNewDocModal(opts) {
  const scrim = document.createElement('div'); scrim.className = 'modal-scrim';
  const modal = document.createElement('div'); modal.className = 'modal';
  modal.innerHTML = '<h2>New document</h2>';
  const srcRow = document.createElement('div'); srcRow.className = 'modal-field';
  srcRow.appendChild(labelEl('Component / source'));
  const sel = document.createElement('select');
  opts.sources.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.name + '  (' + s.component + ')'; sel.appendChild(o); });
  srcRow.appendChild(sel); modal.appendChild(srcRow);

  const pathRow = document.createElement('div'); pathRow.className = 'modal-field';
  pathRow.appendChild(labelEl('Path (folders you choose)'));
  const path = document.createElement('input'); path.placeholder = 'guides/setup/installation'; pathRow.appendChild(path);
  modal.appendChild(pathRow);

  const preview = document.createElement('div'); preview.className = 'modal-preview'; modal.appendChild(preview);
  const err = document.createElement('div'); err.className = 'modal-err'; modal.appendChild(err);

  function id() { const p = path.value.trim().replace(/^\/+|\/+$/g, '').replace(/\.md$/i, ''); return p ? sel.value + '/' + p : ''; }
  function upd() { const i = id(); preview.textContent = i ? 'Will create:  ' + i : ''; err.textContent = ''; }
  sel.addEventListener('change', upd); path.addEventListener('input', upd); upd();

  const bar = document.createElement('div'); bar.className = 'modal-bar';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
  const create = document.createElement('button'); create.className = 'btn btn-primary'; create.textContent = 'Create';
  bar.append(cancel, create); modal.appendChild(bar);

  function close() { scrim.remove(); }
  cancel.addEventListener('click', close);
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  create.addEventListener('click', () => {
    const i = id();
    if (!i || !path.value.trim()) { err.textContent = 'Enter a path.'; return; }
    if (!/^[\w/-]+$/.test(path.value.trim().replace(/\.md$/i, ''))) { err.textContent = 'Path may contain letters, numbers, - _ / only.'; return; }
    if (opts.exists(i)) { err.textContent = 'A document with that path already exists.'; return; }
    close(); opts.onCreate(i);
  });

  scrim.appendChild(modal);
  document.body.appendChild(scrim);
  setTimeout(() => path.focus(), 30);
}

/* ---- confirm dialog (reusable yes/no modal) ----
   opts: { title, message, confirmLabel, cancelLabel, danger }
   Returns a Promise that resolves true (confirmed) or false (cancelled).
   Pass cancelLabel:null for a single-button acknowledgement (alert). */
export function confirmDialog(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const scrim = document.createElement('div'); scrim.className = 'modal-scrim';
    const modal = document.createElement('div'); modal.className = 'modal modal-confirm';
    const h = document.createElement('h2'); h.textContent = opts.title || 'Are you sure?'; modal.appendChild(h);
    if (opts.message) { const p = document.createElement('p'); p.className = 'modal-msg'; p.textContent = opts.message; modal.appendChild(p); }

    const bar = document.createElement('div'); bar.className = 'modal-bar';
    const alertOnly = opts.cancelLabel === null;
    let cancel = null;
    if (!alertOnly) { cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = opts.cancelLabel || 'Cancel'; }
    const ok = document.createElement('button'); ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'); ok.textContent = opts.confirmLabel || 'OK';
    if (cancel) bar.appendChild(cancel);
    bar.appendChild(ok); modal.appendChild(bar);

    let done = false;
    function finish(val) {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      resolve(val);
    }
    if (cancel) cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    scrim.addEventListener('click', e => { if (e.target === scrim) finish(false); });
    // Capture phase so Enter/Escape here don't also trigger the map/coverage
    // overlay's own key handlers underneath (which would e.g. close the map).
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    }
    document.addEventListener('keydown', onKey, true);

    scrim.appendChild(modal);
    document.body.appendChild(scrim);
    setTimeout(() => ok.focus(), 30);
  });
}
