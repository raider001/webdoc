// editor/panels.js - the editor's document-metadata side panel and the
// standalone "new document" modal (choose source + web path).
import { elem, append } from '../dom.js';
import { labelEl, labeledInput, labeledTextarea } from './ui.js';

/* ---- metadata panel (right side of the editor) ---- */
export function metadataPanel(meta, allDocs, selfId) {
  return elem('aside', 'editor-meta',
    elem('h2', 'editor-meta-h', 'Document metadata'),
    labeledInput('Title', meta.title || '', v => meta.title = v),
    labeledTextarea('Description', meta.description || '', v => meta.description = v),
    docPicker('Assumed knowledge', meta.assumes, allDocs, selfId),
    docPicker('Recommended next', meta.next, allDocs, selfId)
  );
}

// A field that edits a list of document ids as removable chips, with a dropdown to
// add another (every doc except this one). `arr` is edited in place.
function docPicker(label, arr, allDocs, selfId) {
  const chips = elem('div', 'meta-chips');

  const select = elem('select', 'meta-select', elem('option', { value: '' }, '+ add…'));
  for (const doc of allDocs || []) {
    if (doc.id === selfId) continue;
    append(select, elem('option', { value: doc.id }, doc.title + '  (' + doc.id + ')'));
  }
  select.addEventListener('change', () => {
    if (select.value && !arr.includes(select.value)) { arr.push(select.value); redraw(); }
    select.value = '';
  });

  function redraw() {
    chips.textContent = '';
    arr.forEach((id, i) => {
      const remove = elem('button', { onClick: () => { arr.splice(i, 1); redraw(); } }, '✕');
      append(chips, elem('span', 'meta-chip', id, remove));
    });
  }
  redraw();

  return elem('div', 'meta-field', elem('label', null, label), chips, select);
}

/* ---- new-document modal ----
   opts: { sources:[{name,component}], exists(id)->bool, onCreate(id) } ---- */
export function openNewDocModal(opts) {
  const sourceSelect = elem('select');
  for (const s of opts.sources) append(sourceSelect, elem('option', { value: s.name }, s.name + '  (' + s.component + ')'));

  const pathInput = elem('input', { placeholder: 'guides/setup/installation' });
  const preview = elem('div', 'modal-preview');
  const error = elem('div', 'modal-err');

  const modal = elem('div', 'modal',
    elem('h2', null, 'New document'),
    elem('div', 'modal-field', labelEl('Component / source'), sourceSelect),
    elem('div', 'modal-field', labelEl('Path (folders you choose)'), pathInput),
    preview,
    error,
    elem('div', 'modal-bar',
      elem('button', { class: 'btn', onClick: close }, 'Cancel'),
      elem('button', { class: 'btn btn-primary', onClick: submit }, 'Create'))
  );
  const scrim = elem('div', 'modal-scrim', modal);

  // The composed id: <source>/<path>, with any leading/trailing slashes and the
  // .md extension stripped. Empty when no path has been typed yet.
  function docId() {
    const path = pathInput.value.trim().replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '');
    return path ? sourceSelect.value + '/' + path : '';
  }
  function updatePreview() {
    const id = docId();
    preview.textContent = id ? 'Will create:  ' + id : '';
    error.textContent = '';
  }
  function close() { scrim.remove(); }
  function submit() {
    const id = docId();
    if (!id || !pathInput.value.trim()) { error.textContent = 'Enter a path.'; return; }
    if (!/^[\w/-]+$/.test(pathInput.value.trim().replace(/\.md$/i, ''))) { error.textContent = 'Path may contain letters, numbers, - _ / only.'; return; }
    if (opts.exists(id)) { error.textContent = 'A document with that path already exists.'; return; }
    close();
    opts.onCreate(id);
  }

  sourceSelect.addEventListener('change', updatePreview);
  pathInput.addEventListener('input', updatePreview);
  updatePreview();

  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  document.body.appendChild(scrim);
  setTimeout(() => pathInput.focus(), 30);
}

/* ---- confirm dialog (reusable yes/no modal) ----
   opts: { title, message, confirmLabel, cancelLabel, danger }
   Returns a Promise that resolves true (confirmed) or false (cancelled).
   Pass cancelLabel:null for a single-button acknowledgement (alert). */
export function confirmDialog(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const alertOnly = opts.cancelLabel === null;
    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      resolve(value);
    }
    // Capture phase so Enter / Escape here don't also trigger the map / coverage
    // overlay's own key handlers underneath (which would e.g. close the map).
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    }

    const cancel = alertOnly ? null
      : elem('button', { class: 'btn', onClick: () => finish(false) }, opts.cancelLabel || 'Cancel');
    const ok = elem('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), onClick: () => finish(true) },
      opts.confirmLabel || 'OK');

    const modal = elem('div', 'modal modal-confirm',
      elem('h2', null, opts.title || 'Are you sure?'),
      opts.message && elem('p', 'modal-msg', opts.message),
      elem('div', 'modal-bar', cancel, ok)
    );
    const scrim = elem('div', 'modal-scrim', modal);

    scrim.addEventListener('click', e => { if (e.target === scrim) finish(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);
    setTimeout(() => ok.focus(), 30);
  });
}
