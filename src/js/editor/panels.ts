// editor/panels.ts - the editor's document-metadata side panel and the
// standalone "new document" modal (choose source + web path).
import { elem, append } from '../dom.js';
import { labelEl, labeledInput, labeledTextarea } from './ui.js';
import { closeIcon } from '../icons.js';
import { auth } from '../auth.js';
import { groupChip, destroyGroupChip } from '../auth-ui.js';

import type { DocMeta } from './serialize.js';
import type { NewDocModalOpts } from '../authoring.js';
import type { DocAccess } from '../auth.js';

/**
 * One entry of the "Assumed knowledge" / "Recommended next" doc-picker lists;
 * only `id` and `title` are read here, out of the fuller GraphDocNode shape
 * (map-view.js) that callers actually pass in.
 */
export interface DocPickerEntry {
  id: string;
  title: string;
}

/* ---- metadata panel (right side of the editor) ---- */
/**
 * @param meta edited in place: title/description directly, assumes/next via docPicker
 * @param selfId the document being edited, excluded from both pickers
 * @param access GET /api/index/access for this document; absent when accounts are
 *   switched off, in which case no access field is drawn
 */
export function metadataPanel(meta: Partial<DocMeta>, allDocs: DocPickerEntry[], selfId: string, access?: DocAccess | null): HTMLElement {
  // docPicker edits its list IN PLACE, so it has to be handed a real array to
  // write into; a header that omits assumes/next gets an empty one here. That
  // adds nothing to what gets saved - serializeDoc already writes `[]` for a
  // missing list.
  meta.assumes = meta.assumes || [];
  meta.next = meta.next || [];
  return elem('aside', 'editor-meta',
    elem('h2', 'editor-meta-h', 'Document metadata'),
    labeledInput('Title', meta.title || '', v => meta.title = v),
    labeledTextarea('Description', meta.description || '', v => meta.description = v),
    docPicker('Assumed knowledge', meta.assumes, allDocs, selfId),
    docPicker('Recommended next', meta.next, allDocs, selfId),
    auth.enabled ? accessField(meta, access || null) : null
  );
}

/**
 * The document-level access rule, edited as a set of group checkboxes.
 *
 * Three states are shown distinctly, because conflating them is what makes ACL
 * UIs confusing: a page with its OWN rule, a page that INHERITED one from an
 * upstream `Recommended next` chain, and a page with no rule at all. Only the
 * first is editable here - to change an inherited lock you edit the page it came
 * from, which is also the only edit that is meaningful.
 *
 * @param meta edited in place; `access` is written back into the header
 * @param access GET /api/index/access for this document
 */
function accessField(meta: Partial<DocMeta>, access: DocAccess | null): HTMLElement {
  const known = (access && access.knownGroups) || [];
  const mayEdit = !!(access && access.canEditAccess);
  const eff: Partial<DocAccess['effective']> = (access && access.effective) || {};
  const inherited = (eff.inheritedFrom || []);

  /** The groups this page's OWN rule names right now. */
  const current = (): string[] => (meta.access && Array.isArray(meta.access.read)) ? meta.access.read.slice() : [];
  const chips = elem('div', 'group-chips');
  const note = elem('p', 'access-note');

  function redraw() {
    const read = current();
    chips.querySelectorAll('.wd-mounted').forEach(destroyGroupChip);   // chips are islands now; clearing alone would not stop them
    chips.textContent = '';
    append(chips, read.length
      ? read.map(g => groupChip(g, { small: true }))
      : elem('span', 'auth-muted', 'Not restricted by this page'));
    note.className = 'access-note' + (read.length || inherited.length ? ' is-locked' : '');
    if (read.length) {
      note.textContent = 'This page and everything reachable from it through '
        + '"Recommended next" is readable only by these groups.';
    } else if (inherited.length) {
      note.textContent = 'Inherited from ' + inherited.join(', ')
        + '. Edit that page to change it, or set a rule here to override it.';
    } else {
      note.textContent = 'Anyone signed in can read this page.';
    }
  }

  const picker = elem('div', 'access-row');
  for (const name of known) {
    const box = elem('input', { type: 'checkbox', checked: current().indexOf(name) !== -1, disabled: !mayEdit });
    box.addEventListener('change', () => {
      const set = new Set(current());
      if (box.checked) set.add(name); else set.delete(name);
      const read = [...set].sort();
      // Drop the whole block when nothing is selected, so an unrestricted page's
      // header stays exactly as it was rather than gaining an empty rule.
      if (!read.length) {
        if (meta.access) { delete meta.access.read; if (!Object.keys(meta.access).length) meta.access = null; }
      } else {
        meta.access = Object.assign({}, meta.access || {}, { read: read });
      }
      redraw();
    });
    append(picker, elem('label', 'access-pick', box, groupChip(name, { small: true })));
  }

  const hidden = elem('input', {
    type: 'checkbox', disabled: !mayEdit,
    checked: !!(meta.access && meta.access.hidden),
  });
  hidden.addEventListener('change', () => {
    if (hidden.checked) meta.access = Object.assign({}, meta.access || {}, { hidden: true });
    else if (meta.access) { delete meta.access.hidden; if (!Object.keys(meta.access).length) meta.access = null; }
    redraw();
  });

  redraw();
  return elem('div', 'meta-field access-panel' + (mayEdit ? '' : ' access-readonly'),
    elem('label', undefined, 'Who can read this'),
    chips, picker,
    elem('label', 'access-pick', hidden,
      'Hide completely (not shown on the map or in search)'),
    note,
    !mayEdit && known.length ? elem('p', 'auth-muted',
      'Only an account with access-management rights can change this.') : null);
}

/**
 * A field that edits a list of document ids as removable chips, with a
 * dropdown to add another (every doc except this one).
 * @param arr edited in place
 */
function docPicker(label: string, arr: string[], allDocs: DocPickerEntry[], selfId: string): HTMLElement {
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
      const remove = elem('button', { onClick: () => { arr.splice(i, 1); redraw(); } }, closeIcon());
      append(chips, elem('span', 'meta-chip', id, remove));
    });
  }
  redraw();

  return elem('div', 'meta-field', elem('label', undefined, label), chips, select);
}

/* ---- new-document modal ---- */
export function openNewDocModal(opts: NewDocModalOpts): void {
  const sourceSelect = elem('select');
  for (const s of opts.sources) append(sourceSelect, elem('option', { value: s.name }, s.name + '  (' + s.component + ')'));

  const pathInput = elem('input', { placeholder: 'guides/setup/installation' });
  const preview = elem('div', 'modal-preview');
  const error = elem('div', 'modal-err');

  const modal = elem('div', 'modal',
    elem('h2', undefined, 'New document'),
    elem('div', 'modal-field', labelEl('Component / source'), sourceSelect),
    elem('div', 'modal-field', labelEl('Path (folders you choose)'), pathInput),
    preview,
    error,
    elem('div', 'modal-bar',
      elem('button', { class: 'btn', onClick: close }, 'Cancel'),
      elem('button', { class: 'btn btn-primary', onClick: submit }, 'Create'))
  );
  const scrim = elem('div', 'modal-scrim', modal);

  /**
   * The composed id: <source>/<path>, with any leading/trailing slashes and
   * the .md extension stripped. Empty when no path has been typed yet.
   */
  function docId(): string {
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

/* ---- confirm dialog (reusable yes/no modal) ---- */
/**
 * Options for confirmDialog's reusable yes/no modal; built at every
 * delete/confirm callsite (authoring.js), including a cancelLabel:null
 * single-button "alert" variant.
 */
export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  /** null for a single-button acknowledgement (alert) */
  cancelLabel?: string | null;
  danger?: boolean;
}

/**
 * @returns resolves true if confirmed, false if cancelled
 */
export function confirmDialog(opts?: ConfirmDialogOptions): Promise<boolean> {
  opts = opts || {};
  return new Promise(resolve => {
    const alertOnly = opts.cancelLabel === null;
    let done = false;
    function finish(value: boolean) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      resolve(value);
    }
    // Capture phase so Enter / Escape here don't also trigger the map / coverage
    // overlay's own key handlers underneath (which would e.g. close the map).
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    }

    const cancel = alertOnly ? null
      : elem('button', { class: 'btn', onClick: () => finish(false) }, opts.cancelLabel || 'Cancel');
    const ok = elem('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), onClick: () => finish(true) },
      opts.confirmLabel || 'OK');

    const modal = elem('div', 'modal modal-confirm',
      elem('h2', undefined, opts.title || 'Are you sure?'),
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
