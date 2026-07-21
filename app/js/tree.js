// tree.js - the "All documents" hierarchy in the drawer.
// Built from the configured source folders -> subfolders -> documents.
// Uses native <details>/<summary> so folders are keyboard-operable for free;
// the full WAI-ARIA tree keyboard pattern is a later a11y pass.

// Group the flat doc list into a nested tree keyed by path segments.
function buildNested(docs) {
  const root = { name: '', dirs: new Map(), docs: [] };
  for (const doc of docs) {
    const parts = doc.id.split('/');
    const fileName = parts.pop();
    let node = root;
    for (const seg of parts) {
      if (!node.dirs.has(seg)) node.dirs.set(seg, { name: seg, dirs: new Map(), docs: [] });
      node = node.dirs.get(seg);
    }
    node.docs.push(doc);
  }
  return root;
}

export function renderTree(container, docs, onSelect) {
  container.textContent = '';
  const nested = buildNested(docs);
  // Top level: each source folder (and any loose docs) rendered open.
  for (const [, dir] of nested.dirs) container.appendChild(renderDir(dir, true, onSelect));
  for (const doc of nested.docs) container.appendChild(renderDocLink(doc, onSelect));
  return container;
}

function renderDir(dir, open, onSelect) {
  const details = document.createElement('details');
  if (open) details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = dir.name;
  details.appendChild(summary);
  const kids = document.createElement('div');
  kids.className = 'group-children';
  for (const [, sub] of dir.dirs) kids.appendChild(renderDir(sub, false, onSelect));
  for (const doc of dir.docs) kids.appendChild(renderDocLink(doc, onSelect));
  details.appendChild(kids);
  return details;
}

function renderDocLink(doc, onSelect) {
  const a = document.createElement('a');
  a.className = 'doc-link';
  a.href = '#/' + doc.id;
  a.dataset.id = doc.id;
  a.textContent = doc.title || doc.name;
  a.addEventListener('click', ev => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; // allow open-in-new-tab
    ev.preventDefault();
    onSelect(doc.id);
  });
  return a;
}

// Mark the active document in the tree, expanding its ancestor folders.
export function markActive(container, id) {
  container.querySelectorAll('a.doc-link[aria-current]').forEach(a => a.removeAttribute('aria-current'));
  const link = container.querySelector('a.doc-link[data-id="' + cssEscape(id) + '"]');
  if (!link) return;
  link.setAttribute('aria-current', 'page');
  let el = link.parentElement;
  while (el && el !== container) {
    if (el.tagName === 'DETAILS') el.open = true;
    el = el.parentElement;
  }
  link.scrollIntoView({ block: 'nearest' });
}

// Filter the tree by a query over titles + ids (content search comes with the
// search index in a later pass).
export function filterTree(container, docs, query) {
  const q = query.trim().toLowerCase();
  const links = container.querySelectorAll('a.doc-link');
  if (!q) {
    container.classList.remove('filtering');
    links.forEach(a => { a.classList.remove('hit'); a.style.display = ''; });
    container.querySelectorAll('details').forEach(d => { d.style.display = ''; });
    return;
  }
  container.classList.add('filtering');
  container.querySelectorAll('details').forEach(d => { d.open = true; d.style.display = ''; });
  links.forEach(a => {
    const doc = docs.find(x => x.id === a.dataset.id);
    const hay = ((doc && doc.title) || '') + ' ' + a.dataset.id;
    const match = hay.toLowerCase().includes(q);
    a.classList.toggle('hit', match);
    a.style.display = match ? '' : 'none';
  });
}

function cssEscape(id) {
  return (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/([^\w-])/g, '\\$1');
}
