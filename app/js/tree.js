// tree.js - the lazy "All documents" hierarchy in the drawer. Built one folder
// level at a time from the server index (GET /api/index/tree?path=), so only the
// paths the user has actually expanded are ever in the DOM. The old version built
// a nested DOM of EVERY document at boot (and needed every doc preloaded); this
// costs nothing at 50k docs until you drill in. Native <details>/<summary> keep it
// keyboard-operable for free.

import { elem } from './dom.js';

/**
 * One document reference as listed by a tree level - just enough to render a
 * link (id + display title). Distinct from the fuller `Doc` (catalog.js) and
 * `GraphDocNode` (map-view.js) shapes: the server's GET /api/index/tree only
 * ever sends these two fields.
 * @typedef {Object} TreeDoc
 * @property {string} id
 * @property {string} title
 */

/**
 * One folder level of the lazy tree, as returned by GET /api/index/tree: the
 * immediate child folder names plus the docs directly inside this folder.
 * @typedef {Object} TreeLevel
 * @property {string[]} folders
 * @property {TreeDoc[]} docs
 */

/**
 * A folder `<details>` element as built by folderNode, augmented with a
 * `_load` method that lazily fetches and appends this folder's children the
 * first time it runs (idempotent - later calls are no-ops); markActive calls
 * it directly to force-load a collapsed ancestor without a user toggle.
 * @typedef {HTMLDetailsElement & {_load: () => Promise<void>}} FolderDetails
 */

/** @type {((id: string) => void)|null} */
let onSelectCb = null;

/**
 * @param {string} path
 * @returns {Promise<TreeLevel>}
 */
async function fetchChildren(path) {
  try {
    const res = await fetch('/api/index/tree?path=' + encodeURIComponent(path || ''), { cache: 'no-cache' });
    if (!res.ok) return { folders: [], docs: [] };
    return await res.json();
  } catch (e) { return { folders: [], docs: [] }; }
}

/**
 * @param {TreeDoc} doc
 * @returns {HTMLAnchorElement}
 */
function docLink(doc) {
  return elem('a', {
    class: 'doc-link', href: '#/' + doc.id, 'data-id': doc.id,
    onClick: ev => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; // allow open-in-new-tab
      ev.preventDefault();
      if (onSelectCb) onSelectCb(doc.id);
    }
  }, doc.title || doc.id.split('/').pop());
}

/**
 * @param {string} name
 * @param {string} path
 * @returns {FolderDetails}
 */
function folderNode(name, path) {
  const kids = elem('div', 'group-children');
  /** @type {FolderDetails} */
  const details = elem('details', { 'data-path': path }, elem('summary', null, name), kids);
  let loaded = false;
  const load = async () => {
    if (loaded) return; loaded = true;
    const data = await fetchChildren(path);
    for (const f of data.folders) kids.appendChild(folderNode(f, path + '/' + f));
    for (const d of data.docs) kids.appendChild(docLink(d));
  };
  details.addEventListener('toggle', () => { if (details.open) load(); });
  details._load = load;   // markActive can force-load without a user toggle
  return details;
}

/**
 * @param {HTMLElement} container
 * @param {(id: string) => void} onSelect
 * @returns {Promise<HTMLElement>}
 */
export async function renderTree(container, onSelect) {
  onSelectCb = onSelect;
  container.textContent = '';
  const root = await fetchChildren('');
  for (const f of root.folders) container.appendChild(folderNode(f, f));
  for (const d of root.docs) container.appendChild(docLink(d));
  /** @type {FolderDetails|null} */
  const first = container.querySelector('details');   // open the first source by default
  if (first) { first.open = true; if (first._load) await first._load(); }
  return container;
}

/**
 * Expand the id's ancestor folders (loading each level from the server), then mark
 * and scroll to its link. Async because the target link usually isn't in the DOM yet.
 * @param {HTMLElement} container
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function markActive(container, id) {
  container.querySelectorAll('a.doc-link[aria-current]').forEach(a => a.removeAttribute('aria-current'));
  const parts = id.split('/');
  let path = '';
  for (let i = 0; i < parts.length - 1; i++) {
    path = path ? path + '/' + parts[i] : parts[i];
    /** @type {FolderDetails|null} */
    const details = container.querySelector('details[data-path="' + cssEscape(path) + '"]');
    if (!details) return;                 // ancestor not present (parent not loaded) - give up quietly
    details.open = true;
    if (details._load) await details._load();
  }
  const link = container.querySelector('a.doc-link[data-id="' + cssEscape(id) + '"]');
  if (!link) return;
  link.setAttribute('aria-current', 'page');
  link.scrollIntoView({ block: 'nearest' });
}

function cssEscape(id) {
  return (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/([^\w-])/g, '\\$1');
}
