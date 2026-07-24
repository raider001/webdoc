// tree.js - the lazy "All documents" hierarchy in the drawer. Built one folder
// level at a time from the server index (GET /api/index/tree?path=), so only the
// paths the user has actually expanded are ever in the DOM. The old version built
// a nested DOM of EVERY document at boot (and needed every doc preloaded); this
// costs nothing at 50k docs until you drill in. Native <details>/<summary> keep it
// keyboard-operable for free.

let onSelectCb = null;

async function fetchChildren(path) {
  try {
    const res = await fetch('/api/index/tree?path=' + encodeURIComponent(path || ''), { cache: 'no-cache' });
    if (!res.ok) return { folders: [], docs: [] };
    return await res.json();
  } catch (e) { return { folders: [], docs: [] }; }
}

function docLink(doc) {
  const a = document.createElement('a');
  a.className = 'doc-link';
  a.href = '#/' + doc.id;
  a.dataset.id = doc.id;
  a.textContent = doc.title || doc.id.split('/').pop();
  a.addEventListener('click', ev => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; // allow open-in-new-tab
    ev.preventDefault();
    if (onSelectCb) onSelectCb(doc.id);
  });
  return a;
}

function folderNode(name, path) {
  const details = document.createElement('details');
  details.dataset.path = path;
  const summary = document.createElement('summary');
  summary.textContent = name;
  details.appendChild(summary);
  const kids = document.createElement('div');
  kids.className = 'group-children';
  details.appendChild(kids);
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

export async function renderTree(container, onSelect) {
  onSelectCb = onSelect;
  container.textContent = '';
  const root = await fetchChildren('');
  for (const f of root.folders) container.appendChild(folderNode(f, f));
  for (const d of root.docs) container.appendChild(docLink(d));
  const first = container.querySelector('details');   // open the first source by default
  if (first) { first.open = true; if (first._load) await first._load(); }
  return container;
}

// Expand the id's ancestor folders (loading each level from the server), then mark
// and scroll to its link. Async because the target link usually isn't in the DOM yet.
export async function markActive(container, id) {
  container.querySelectorAll('a.doc-link[aria-current]').forEach(a => a.removeAttribute('aria-current'));
  const parts = id.split('/');
  let path = '';
  for (let i = 0; i < parts.length - 1; i++) {
    path = path ? path + '/' + parts[i] : parts[i];
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
