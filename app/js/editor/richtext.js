// editor/richtext.js - contenteditable text fields, the floating inline toolbar
// (Bold / Italic / Code / Link) shown on selection, and the link popover with
// internal-document URL autocomplete. Everything about editing inline rich text.

/* ---- editable inline field (contenteditable + inline toolbar) ---- */
export function editable(html, cls, onChange, placeholder) {
  const ed = document.createElement('div');
  ed.className = 'blk-edit blk-edit-' + cls;
  ed.setAttribute('contenteditable', 'true');
  ed.setAttribute('data-ph', placeholder || '');
  ed.innerHTML = html;
  ed.addEventListener('input', () => onChange(ed.innerHTML));
  attachInlineToolbar(ed);
  return ed;
}
export function listItem(html) { const li = document.createElement('li'); li.innerHTML = html || ''; return li; }

// A standalone rich-text field (contenteditable + the shared inline toolbar),
// for callers outside the block editor (e.g. the manual-test editor).
export function richText(html, onChange, placeholder) {
  const ed = document.createElement('div');
  ed.className = 'wysiwyg';
  ed.setAttribute('contenteditable', 'true');
  ed.setAttribute('data-ph', placeholder || '');
  ed.innerHTML = html || '';
  ed.addEventListener('input', () => onChange(ed.innerHTML));
  attachInlineToolbar(ed);
  return ed;
}

// A small floating toolbar (Bold / Italic / Code / Link) shown on selection.
let sharedBar = null;
export function attachInlineToolbar(ed) {
  ed.addEventListener('mouseup', showBar);
  ed.addEventListener('keyup', showBar);
  // Click an existing link to edit its text / URL or unlink it (no prompt()).
  ed.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a');
    if (!a || !ed.contains(a)) return;
    e.preventDefault();
    if (sharedBar) sharedBar.style.display = 'none';
    const plain = !a.querySelector('*');   // link wraps only text -> its text is editable
    openLinkPopover({
      rect: a.getBoundingClientRect(),
      text: a.textContent, url: a.getAttribute('href') || '', canText: plain,
      onApply: (text, url) => { a.setAttribute('href', url); if (plain && text !== a.textContent) a.textContent = text; fireInput(ed); },
      onRemove: () => { unwrapAnchor(a); fireInput(ed); }
    });
  });
  ed.addEventListener('blur', () => setTimeout(() => { if (sharedBar && !sharedBar.matches(':hover')) sharedBar.style.display = 'none'; }, 150));
  ed.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); document.execCommand('bold'); }
      else if (e.key === 'i') { e.preventDefault(); document.execCommand('italic'); }
    }
  });
  function showBar() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !ed.contains(sel.anchorNode)) { if (sharedBar) sharedBar.style.display = 'none'; return; }
    const bar = ensureBar();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    bar.style.display = 'flex';
    bar.style.top = (window.scrollY + r.top - 40) + 'px';
    bar.style.left = (window.scrollX + r.left) + 'px';
  }
}
function ensureBar() {
  if (sharedBar) return sharedBar;
  sharedBar = document.createElement('div');
  sharedBar.className = 'inline-bar';
  const mk = (label, fn, title) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.addEventListener('mousedown', e => { e.preventDefault(); fn(); }); return b; };
  sharedBar.append(
    mk('B', () => document.execCommand('bold'), 'Bold'),
    mk('I', () => document.execCommand('italic'), 'Italic'),
    mk('<>', wrapCode, 'Inline code'),
    mk('🔗', addLink, 'Link')
  );
  document.body.appendChild(sharedBar);
  return sharedBar;
}
function wrapCode() {
  const sel = window.getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const code = document.createElement('code');
  code.textContent = range.toString();
  range.deleteContents(); range.insertNode(code);
  sel.removeAllRanges();
  // fire input on the editable
  const host = code.closest('[contenteditable]'); if (host) host.dispatchEvent(new Event('input', { bubbles: true }));
}
// Link button on the inline toolbar. Selection preserved (buttons preventDefault
// on mousedown). Opens the popover to create a link, or to edit one the caret is
// inside. Text is editable when inserting fresh or editing an existing link; when
// wrapping a selection the selected text is kept.
function addLink() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0).cloneRange();
  const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const host = startEl && startEl.closest('[contenteditable]');
  if (!host) return;
  if (sharedBar) sharedBar.style.display = 'none';
  const a = existingAnchor(range);
  const aPlain = a ? !a.querySelector('*') : false;   // formatted link -> keep its markup, text not editable
  openLinkPopover({
    rect: a ? a.getBoundingClientRect() : range.getBoundingClientRect(),
    text: a ? a.textContent : sel.toString(),
    url: a ? (a.getAttribute('href') || '') : '',
    canText: a ? aPlain : range.collapsed,  // edit text for a plain link or a fresh insert; keep selected text when wrapping
    onApply: (text, url) => applyLink(host, range, a, text, url),
    onRemove: a ? () => { unwrapAnchor(a); fireInput(host); } : null
  });
}

function applyLink(host, range, a, text, url) {
  if (a) {
    a.setAttribute('href', url);
    if (!a.querySelector('*') && text != null && text !== a.textContent) a.textContent = text; // don't flatten inner markup
  } else if (!range.collapsed) {
    const link = document.createElement('a'); link.href = url;
    try { range.surroundContents(link); }
    catch (e) { const frag = range.extractContents(); link.appendChild(frag); range.insertNode(link); }
    link.querySelectorAll('a').forEach(unwrapAnchor); // no nested anchors (would be invalid Markdown)
    if (text && text !== link.textContent) link.textContent = text;
  } else {
    const link = document.createElement('a'); link.href = url; link.textContent = text || url;
    range.insertNode(link);
  }
  fireInput(host);
}

// The <a> the range starts inside (within an editable), if any.
function existingAnchor(range) {
  let n = range.startContainer;
  n = n.nodeType === 1 ? n : n.parentElement;
  const a = n && n.closest ? n.closest('a') : null;
  return (a && a.closest('[contenteditable]')) ? a : null;
}
function unwrapAnchor(a) {
  const parent = a.parentNode; if (!parent) return;
  while (a.firstChild) parent.insertBefore(a.firstChild, a);
  parent.removeChild(a);
}
function fireInput(host) { if (host) host.dispatchEvent(new Event('input', { bubbles: true })); }

// Accept the same URL shapes the sanitizer keeps; bare domains get https://.
// Returns '' for an unsafe/empty URL (caller flags the field).
function normalizeUrl(v) {
  v = (v || '').trim();
  if (!v) return '';
  if (/^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';                 // some other scheme (javascript:, data:) -> reject
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(v)) return 'https://' + v; // bare domain
  return v;                                                      // relative-ish path
}

/* ---- link popover (Text + URL, Apply / Unlink / Cancel) - replaces window.prompt.
   o: { rect, text, url, canText, onApply(text,url), onRemove|null } ---- */
let linkPop = null, linkOff = null;
let linkDocs = [];   // static fallback list for the URL autocomplete: [{ id, title }]
export function setLinkDocs(docs) { linkDocs = Array.isArray(docs) ? docs : []; }
let linkSearch = null;   // async (query) -> [{id,title}]: server-backed suggestions (scales past a client list)
export function setLinkSearch(fn) { linkSearch = (typeof fn === 'function') ? fn : null; }
function closeLinkPop() {
  if (linkOff) { document.removeEventListener('mousedown', linkOff); linkOff = null; } // no leaked global listener
  if (linkPop) { linkPop.remove(); linkPop = null; }
  document.querySelectorAll('.link-ac').forEach(n => n.remove());
}
function openLinkPopover(o) {
  closeLinkPop();
  const pop = document.createElement('div'); pop.className = 'link-pop';
  function mkRow(labelTxt, val, ph, disabled) {
    const row = document.createElement('label'); row.className = 'link-pop-row';
    const s = document.createElement('span'); s.textContent = labelTxt;
    const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; i.placeholder = ph || ''; i.disabled = !!disabled;
    row.append(s, i); return i;
  }
  const tIn = mkRow('Text', o.text, 'Link text', !o.canText);
  const uIn = mkRow('URL', o.url, 'https://…', false); uIn.classList.add('link-pop-url');
  const bar = document.createElement('div'); bar.className = 'link-pop-bar';
  const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'link-pop-remove'; rm.textContent = 'Unlink';
  const sp = document.createElement('span'); sp.style.flex = '1';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'link-pop-apply'; apply.textContent = 'Apply';
  bar.append(rm, sp, cancel, apply);
  if (!o.onRemove) rm.style.display = 'none';
  pop.append(tIn.parentElement, uIn.parentElement, bar);
  document.body.appendChild(pop);
  linkPop = pop;

  const r = o.rect || { bottom: 80, left: 80 };
  const w = 300;
  pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
  pop.style.left = (window.scrollX + Math.max(8, Math.min(r.left, window.innerWidth - w - 12))) + 'px';

  function commit() {
    const url = normalizeUrl(uIn.value);
    if (!url) { pop.classList.add('link-pop-err'); uIn.focus(); return; }
    o.onApply(o.canText ? tIn.value : o.text, url);
    closeLinkPop();
  }
  apply.addEventListener('click', commit);
  cancel.addEventListener('mousedown', e => { e.preventDefault(); closeLinkPop(); });
  rm.addEventListener('click', () => { if (o.onRemove) o.onRemove(); closeLinkPop(); });

  // URL autocomplete: suggest internal documents by title / id. Selecting one
  // inserts its doc id (the reading view resolves it to a route). Typing a real
  // URL (scheme, /, #) suppresses the list, so external links still work freely.
  let acItems = [], acActive = -1, acDrop = null, acSeq = 0, acTimer = null;
  function looksExternal(v) { return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(v); }
  function closeUrlAc() { if (acTimer) { clearTimeout(acTimer); acTimer = null; } if (acDrop) { acDrop.remove(); acDrop = null; } acItems = []; acActive = -1; }
  function pickDoc(d) { uIn.value = d.id; if (o.canText && !tIn.disabled && !tIn.value) tIn.value = d.title || d.id; pop.classList.remove('link-pop-err'); closeUrlAc(); uIn.focus(); }
  function renderUrlAc() {
    if (!acItems.length) { if (acDrop) { acDrop.remove(); acDrop = null; } return; }
    if (acActive >= acItems.length) acActive = acItems.length - 1;
    if (!acDrop) { acDrop = document.createElement('div'); acDrop.className = 'ac-drop link-ac'; document.body.appendChild(acDrop); }
    acDrop.textContent = '';
    acItems.forEach((d, idx) => {
      const opt = document.createElement('div'); opt.className = 'ac-opt' + (idx === acActive ? ' is-active' : '');
      const idEl = document.createElement('span'); idEl.className = 'ac-id'; idEl.textContent = d.title || d.id;
      const de = document.createElement('span'); de.className = 'ac-desc'; de.textContent = d.id;
      opt.append(idEl, de);
      opt.addEventListener('mousedown', e => { e.preventDefault(); pickDoc(d); });
      acDrop.appendChild(opt);
    });
    const rc = uIn.getBoundingClientRect();
    acDrop.style.left = (window.scrollX + rc.left) + 'px';
    acDrop.style.top = (window.scrollY + rc.bottom + 3) + 'px';
    acDrop.style.minWidth = Math.max(220, rc.width) + 'px';
  }
  function openUrlAc() {
    const raw = uIn.value.trim();
    if (looksExternal(raw)) { closeUrlAc(); return; }
    if (linkSearch) {
      // Server-backed: query the index as you type (debounced; a sequence guard drops
      // out-of-order responses). Scales past any client-held document list.
      if (acTimer) clearTimeout(acTimer);
      acTimer = setTimeout(async () => {
        const mySeq = ++acSeq;
        let items = [];
        try { items = await linkSearch(raw); } catch (e) { items = []; }
        if (mySeq !== acSeq) return;
        acItems = (items || []).slice(0, 8);
        renderUrlAc();
      }, 160);
    } else {
      const q = raw.toLowerCase();
      acItems = linkDocs.filter(d => !q || (d.id && d.id.toLowerCase().includes(q)) || (d.title && d.title.toLowerCase().includes(q))).slice(0, 8);
      renderUrlAc();
    }
  }
  uIn.addEventListener('input', () => { pop.classList.remove('link-pop-err'); acActive = -1; openUrlAc(); });
  uIn.addEventListener('focus', openUrlAc);
  uIn.addEventListener('keydown', e => {
    if (acDrop && acItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acItems.length - 1, acActive + 1); renderUrlAc(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(0, acActive - 1); renderUrlAc(); return; }
      if (e.key === 'Enter' && acActive >= 0) { e.preventDefault(); pickDoc(acItems[acActive]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeUrlAc(); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLinkPop(); }
  });
  tIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLinkPop(); }
  });

  linkOff = function (e) {
    if (linkPop && !linkPop.contains(e.target) && !(e.target.closest && e.target.closest('.link-ac'))) closeLinkPop();
  };
  setTimeout(() => document.addEventListener('mousedown', linkOff), 0);
  setTimeout(() => ((o.canText && !tIn.value) ? tIn : uIn).focus(), 20);
}
