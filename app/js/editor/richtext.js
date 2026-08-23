// editor/richtext.js - contenteditable text fields, the floating inline toolbar
// (Bold / Italic / Code / Link / Image) shown on selection, and the link & image
// popovers (the link one with internal-document URL autocomplete). Everything about
// editing inline rich text.
import { elem, append } from '../dom.js';
/* ---- editable inline field (contenteditable + inline toolbar) ---- */
/**
 * @param {string} html
 * @param {string} cls
 * @param {(html: string) => void} onChange
 * @param {string} [placeholder]
 * @returns {HTMLElement}
 */
export function editable(html, cls, onChange, placeholder) {
    const ed = elem('div', {
        class: 'blk-edit blk-edit-' + cls, contenteditable: 'true', 'data-ph': placeholder || '',
        html, onInput: () => onChange(ed.innerHTML)
    });
    attachInlineToolbar(ed);
    return ed;
}
/** @param {string} [html] @returns {HTMLLIElement} */
export function listItem(html) { return elem('li', { html: html || '' }); }
/**
 * A standalone rich-text field (contenteditable + the shared inline toolbar),
 * for callers outside the block editor (e.g. the manual-test editor).
 * @param {string} html
 * @param {(html: string) => void} onChange
 * @param {string} [placeholder]
 * @returns {HTMLElement}
 */
export function richText(html, onChange, placeholder) {
    const ed = elem('div', {
        class: 'wysiwyg', contenteditable: 'true', 'data-ph': placeholder || '',
        html: html || '', onInput: () => onChange(ed.innerHTML)
    });
    attachInlineToolbar(ed);
    return ed;
}
// A small floating toolbar (Bold / Italic / Code / Link / Image) shown on selection.
/** @type {HTMLDivElement|null} */
let sharedBar = null;
/** @param {HTMLElement} ed - a contenteditable field */
export function attachInlineToolbar(ed) {
    ed.addEventListener('mouseup', showBar);
    ed.addEventListener('keyup', showBar);
    // Click an existing link to edit its text / URL or unlink it (no prompt()).
    ed.addEventListener('click', e => {
        const hit = /** @type {Element} */ (e.target);
        const anchor = hit.closest && hit.closest('a');
        if (!anchor || !ed.contains(anchor))
            return;
        e.preventDefault();
        if (sharedBar)
            sharedBar.style.display = 'none';
        const plain = !anchor.querySelector('*'); // link wraps only text -> its text is editable
        openLinkPopover({
            rect: anchor.getBoundingClientRect(),
            text: anchor.textContent, url: anchor.getAttribute('href') || '', canText: plain,
            onApply: (text, url) => { anchor.setAttribute('href', url); if (plain && text !== anchor.textContent)
                anchor.textContent = text; fireInput(ed); },
            onRemove: () => { unwrapAnchor(anchor); fireInput(ed); }
        });
    });
    ed.addEventListener('blur', () => setTimeout(() => { if (sharedBar && !sharedBar.matches(':hover'))
        sharedBar.style.display = 'none'; }, 150));
    ed.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'b') {
                e.preventDefault();
                document.execCommand('bold');
            }
            else if (e.key === 'i') {
                e.preventDefault();
                document.execCommand('italic');
            }
        }
    });
    function showBar() {
        const sel = window.getSelection();
        // Show while the caret is anywhere in this field (not only on a selection), so
        // Link / Image can be inserted at an empty caret - e.g. into a blank table cell.
        if (!sel || !sel.rangeCount || !ed.contains(sel.anchorNode)) {
            if (sharedBar)
                sharedBar.style.display = 'none';
            return;
        }
        const bar = ensureBar();
        let r = sel.getRangeAt(0).getBoundingClientRect();
        if (!r.width && !r.height && !r.top)
            r = ed.getBoundingClientRect(); // empty node -> anchor to the field
        bar.style.display = 'flex';
        bar.style.top = (window.scrollY + r.top - 40) + 'px';
        bar.style.left = (window.scrollX + r.left) + 'px';
    }
}
function ensureBar() {
    if (sharedBar)
        return sharedBar;
    // Buttons preventDefault on mousedown so the field keeps its selection.
    /** @param {string} label @param {() => void} run @param {string} title */
    const button = (label, run, title) => elem('button', { title, onMousedown: /** @param {MouseEvent} e */ /** @param {MouseEvent} e */ e => { e.preventDefault(); run(); } }, label);
    sharedBar = elem('div', 'inline-bar', button('B', () => document.execCommand('bold'), 'Bold'), button('I', () => document.execCommand('italic'), 'Italic'), button('<>', wrapCode, 'Inline code'), button('🔗', addLink, 'Link'), button('🖼', addImage, 'Insert image'));
    document.body.appendChild(sharedBar);
    return sharedBar;
}
function wrapCode() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed)
        return;
    const range = sel.getRangeAt(0);
    const code = elem('code', { text: range.toString() });
    range.deleteContents();
    range.insertNode(code);
    sel.removeAllRanges();
    const host = code.closest('[contenteditable]'); // fire input on the editable
    if (host)
        host.dispatchEvent(new Event('input', { bubbles: true }));
}
// Link button on the inline toolbar. Selection preserved (buttons preventDefault
// on mousedown). Opens the popover to create a link, or to edit one the caret is
// inside. Text is editable when inserting fresh or editing an existing link; when
// wrapping a selection the selected text is kept.
function addLink() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount)
        return;
    const range = sel.getRangeAt(0).cloneRange();
    const startEl = range.startContainer.nodeType === 1 ? /** @type {Element} */ (range.startContainer) : range.startContainer.parentElement;
    const host = startEl && startEl.closest('[contenteditable]');
    if (!host)
        return;
    if (sharedBar)
        sharedBar.style.display = 'none';
    const anchor = existingAnchor(range);
    const anchorPlain = anchor ? !anchor.querySelector('*') : false; // formatted link -> keep its markup, text not editable
    openLinkPopover({
        rect: anchor ? anchor.getBoundingClientRect() : range.getBoundingClientRect(),
        text: anchor ? anchor.textContent : sel.toString(),
        url: anchor ? (anchor.getAttribute('href') || '') : '',
        canText: anchor ? anchorPlain : range.collapsed, // edit text for a plain link or a fresh insert; keep selected text when wrapping
        onApply: (text, url) => applyLink(host, range, anchor, text, url),
        onRemove: anchor ? () => { unwrapAnchor(anchor); fireInput(host); } : null
    });
}
/**
 * @param {Element} host - the contenteditable the link ends up in
 * @param {Range} range
 * @param {HTMLAnchorElement|null} anchor - the link being edited, or null to make a new one
 * @param {string} text
 * @param {string} url
 */
function applyLink(host, range, anchor, text, url) {
    if (anchor) {
        anchor.setAttribute('href', url);
        if (!anchor.querySelector('*') && text != null && text !== anchor.textContent)
            anchor.textContent = text; // don't flatten inner markup
    }
    else if (!range.collapsed) {
        const link = elem('a', { href: url });
        try {
            range.surroundContents(link);
        }
        catch (e) {
            link.appendChild(range.extractContents());
            range.insertNode(link);
        }
        link.querySelectorAll('a').forEach(unwrapAnchor); // no nested anchors (would be invalid Markdown)
        if (text && text !== link.textContent)
            link.textContent = text;
    }
    else {
        range.insertNode(elem('a', { href: url, text: text || url }));
    }
    fireInput(host);
}
// The <a> the range starts inside (within an editable), if any.
/** @param {Range} range @returns {HTMLAnchorElement|null} */
function existingAnchor(range) {
    const n = range.startContainer.nodeType === 1 ? /** @type {Element} */ (range.startContainer) : range.startContainer.parentElement;
    const anchor = n && n.closest ? n.closest('a') : null;
    return (anchor && anchor.closest('[contenteditable]')) ? anchor : null;
}
/** @param {Element} a */
function unwrapAnchor(a) {
    const parent = a.parentNode;
    if (!parent)
        return;
    while (a.firstChild)
        parent.insertBefore(a.firstChild, a);
    parent.removeChild(a);
}
/** @param {Element|null} host */
function fireInput(host) { if (host)
    host.dispatchEvent(new Event('input', { bubbles: true })); }
// Image button on the inline toolbar: insert an <img> at the caret. Works in any
// rich-text field, including table cells. A relative src (diagram.png, ../x.png) is
// resolved for DISPLAY via the editor's image resolver (set by setImageResolver),
// keeping the original in data-mdsrc, so it shows in the editor AND serializes back
// to the relative path - the same contract as images loaded from a document.
/** @type {((url: string) => (string|null|undefined))|null} */
let imageResolver = null;
/** @param {(url: string) => (string|null|undefined)} fn - resolves a relative image src for DISPLAY */
export function setImageResolver(fn) { imageResolver = (typeof fn === 'function') ? fn : null; }
function addImage() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount)
        return;
    const range = sel.getRangeAt(0).cloneRange();
    const startEl = range.startContainer.nodeType === 1 ? /** @type {Element} */ (range.startContainer) : range.startContainer.parentElement;
    const host = startEl && startEl.closest('[contenteditable]');
    if (!host)
        return;
    if (sharedBar)
        sharedBar.style.display = 'none';
    openImagePopover({
        rect: range.getBoundingClientRect(),
        onApply: (alt, url) => {
            const img = document.createElement('img');
            img.setAttribute('src', url);
            if (alt)
                img.setAttribute('alt', alt);
            const resolved = imageResolver ? imageResolver(url) : null; // relative -> /docs/... for display
            if (resolved) {
                img.setAttribute('data-mdsrc', url);
                img.setAttribute('src', resolved);
            }
            range.deleteContents();
            range.insertNode(img);
            range.setStartAfter(img);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            fireInput(host);
        }
    });
}
/* ---- popovers -------------------------------------------------------------- */
/**
 * Only the bottom-left corner of the anchoring rect is ever read, so a bare
 * literal stands in for a DOMRect when there is nothing on screen to measure.
 * @typedef {{bottom: number, left: number}} PopoverRect
 */
// Shared bits: a labelled input row, and positioning below the anchoring rect.
/** @param {string} labelText @param {HTMLElement} input */
function popRow(labelText, input) {
    return elem('label', 'link-pop-row', elem('span', null, labelText), input);
}
/** @param {HTMLElement} pop @param {PopoverRect|null} rect */
function positionPopover(pop, rect) {
    const r = rect || { bottom: 80, left: 80 };
    const width = 300;
    pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
    pop.style.left = (window.scrollX + Math.max(8, Math.min(r.left, window.innerWidth - width - 12))) + 'px';
}
// A minimal image popover (URL + Alt, Insert / Cancel), reusing the link popover's
// shared state + styling. No doc autocomplete - image paths aren't in the doc index.
/**
 * @typedef {Object} ImagePopoverOptions
 * @property {PopoverRect} rect
 * @property {(alt: string, url: string) => void} onApply
 */
/** @param {ImagePopoverOptions} o */
function openImagePopover(o) {
    closeLinkPop();
    const urlInput = elem('input', { type: 'text', class: 'link-pop-url', placeholder: 'diagram.png or https://…' });
    const altInput = elem('input', { type: 'text', placeholder: 'describe the image' });
    const pop = elem('div', 'link-pop', popRow('Image URL', urlInput), popRow('Alt text', altInput), elem('div', 'link-pop-bar', elem('span', { style: 'flex:1' }), elem('button', { type: 'button', onMousedown: /** @param {MouseEvent} e */ /** @param {MouseEvent} e */ e => { e.preventDefault(); closeLinkPop(); } }, 'Cancel'), elem('button', { type: 'button', class: 'link-pop-apply', onClick: commit }, 'Insert')));
    document.body.appendChild(pop);
    linkPop = pop;
    positionPopover(pop, o.rect);
    function commit() {
        const url = normalizeImgUrl(urlInput.value);
        if (!url) {
            pop.classList.add('link-pop-err');
            urlInput.focus();
            return;
        }
        o.onApply(altInput.value.trim(), url);
        closeLinkPop();
    }
    [urlInput, altInput].forEach(i => i.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            closeLinkPop();
        }
    }));
    linkOff = e => { if (linkPop && !linkPop.contains(/** @type {Node} */ (e.target)))
        closeLinkPop(); };
    setTimeout(() => document.addEventListener('mousedown', linkOff), 0);
    setTimeout(() => urlInput.focus(), 20);
}
// Image-src acceptance: relative paths are kept AS-IS (a bare "diagram.png" is a
// file next to the doc, NOT a bare domain - so, unlike link URLs, never prepend
// https://). Schemes are limited to http(s)/data; others (javascript:, …) rejected.
/** @param {string} v @returns {string} */
function normalizeImgUrl(v) {
    v = (v || '').trim();
    if (!v)
        return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(v))
        return /^(https?:|data:)/i.test(v) ? v : '';
    return v; // relative (diagram.png, ./x.png, ../x.png, /assets/x.png)
}
// Accept the same URL shapes the sanitizer keeps; bare domains get https://.
// Returns '' for an unsafe/empty URL (caller flags the field).
/** @param {string} v @returns {string} */
function normalizeUrl(v) {
    v = (v || '').trim();
    if (!v)
        return '';
    if (/^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#)/i.test(v))
        return v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v))
        return ''; // some other scheme (javascript:, data:) -> reject
    if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(v))
        return 'https://' + v; // bare domain
    return v; // relative-ish path
}
/* ---- link popover (Text + URL, Apply / Unlink / Cancel) - replaces window.prompt ---- */
/** @type {HTMLDivElement|null} */
let linkPop = null;
/** @type {((e: MouseEvent) => void)|null} */
let linkOff = null;
/**
 * One internal-document suggestion in the URL autocomplete: the id is what gets
 * inserted as the link target, the title is what the dropdown shows.
 * @typedef {{id: string, title: string}} LinkDoc
 */
/** @type {LinkDoc[]} */
let linkDocs = []; // static fallback list for the URL autocomplete
/** @param {LinkDoc[]} docs */
export function setLinkDocs(docs) { linkDocs = Array.isArray(docs) ? docs : []; }
/** @type {((query: string) => Promise<LinkDoc[]>)|null} */
let linkSearch = null; // server-backed suggestions (scales past a client list)
/** @param {(query: string) => Promise<LinkDoc[]>} fn */
export function setLinkSearch(fn) { linkSearch = (typeof fn === 'function') ? fn : null; }
function closeLinkPop() {
    if (linkOff) {
        document.removeEventListener('mousedown', linkOff);
        linkOff = null;
    } // no leaked global listener
    if (linkPop) {
        linkPop.remove();
        linkPop = null;
    }
    document.querySelectorAll('.link-ac').forEach(n => n.remove());
}
/**
 * @typedef {Object} LinkPopoverOptions
 * @property {PopoverRect} rect
 * @property {string} text
 * @property {string} url
 * @property {boolean} canText - false for a formatted link, whose inner markup must survive
 * @property {(text: string, url: string) => void} onApply
 * @property {(() => void)|null} onRemove - null when there is no link to unlink yet
 */
/** @param {LinkPopoverOptions} o */
function openLinkPopover(o) {
    closeLinkPop();
    const textInput = elem('input', { type: 'text', value: o.text || '', placeholder: 'Link text', disabled: !o.canText });
    const urlInput = elem('input', { type: 'text', class: 'link-pop-url', value: o.url || '', placeholder: 'https://…' });
    const removeBtn = elem('button', { type: 'button', class: 'link-pop-remove', onClick: () => { if (o.onRemove)
            o.onRemove(); closeLinkPop(); } }, 'Unlink');
    if (!o.onRemove)
        removeBtn.style.display = 'none';
    const pop = elem('div', 'link-pop', popRow('Text', textInput), popRow('URL', urlInput), elem('div', 'link-pop-bar', removeBtn, elem('span', { style: 'flex:1' }), elem('button', { type: 'button', onMousedown: /** @param {MouseEvent} e */ /** @param {MouseEvent} e */ e => { e.preventDefault(); closeLinkPop(); } }, 'Cancel'), elem('button', { type: 'button', class: 'link-pop-apply', onClick: commit }, 'Apply')));
    document.body.appendChild(pop);
    linkPop = pop;
    positionPopover(pop, o.rect);
    function commit() {
        const url = normalizeUrl(urlInput.value);
        if (!url) {
            pop.classList.add('link-pop-err');
            urlInput.focus();
            return;
        }
        o.onApply(o.canText ? textInput.value : o.text, url);
        closeLinkPop();
    }
    // URL autocomplete: suggest internal documents by title / id. Selecting one
    // inserts its doc id (the reading view resolves it to a route). Typing a real
    // URL (scheme, /, #) suppresses the list, so external links still work freely.
    /** @type {LinkDoc[]} */
    let acItems = [];
    let acActive = -1;
    /** @type {HTMLDivElement|null} */
    let acDrop = null;
    let acSeq = 0;
    /** @type {number|null} */
    let acTimer = null;
    /** @param {string} v */
    function looksExternal(v) { return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(v); }
    function closeUrlAc() { if (acTimer) {
        clearTimeout(acTimer);
        acTimer = null;
    } if (acDrop) {
        acDrop.remove();
        acDrop = null;
    } acItems = []; acActive = -1; }
    /** @param {LinkDoc} d */
    function pickDoc(d) {
        urlInput.value = d.id;
        if (o.canText && !textInput.disabled && !textInput.value)
            textInput.value = d.title || d.id;
        pop.classList.remove('link-pop-err');
        closeUrlAc();
        urlInput.focus();
    }
    function renderUrlAc() {
        if (!acItems.length) {
            if (acDrop) {
                acDrop.remove();
                acDrop = null;
            }
            return;
        }
        if (acActive >= acItems.length)
            acActive = acItems.length - 1;
        if (!acDrop) {
            acDrop = elem('div', 'ac-drop link-ac');
            document.body.appendChild(acDrop);
        }
        acDrop.textContent = '';
        acItems.forEach((d, idx) => append(acDrop, elem('div', { class: 'ac-opt' + (idx === acActive ? ' is-active' : ''), onMousedown: /** @param {MouseEvent} e */ /** @param {MouseEvent} e */ e => { e.preventDefault(); pickDoc(d); } }, elem('span', 'ac-id', d.title || d.id), elem('span', 'ac-desc', d.id))));
        const rc = urlInput.getBoundingClientRect();
        acDrop.style.left = (window.scrollX + rc.left) + 'px';
        acDrop.style.top = (window.scrollY + rc.bottom + 3) + 'px';
        acDrop.style.minWidth = Math.max(220, rc.width) + 'px';
    }
    function openUrlAc() {
        const raw = urlInput.value.trim();
        if (looksExternal(raw)) {
            closeUrlAc();
            return;
        }
        if (linkSearch) {
            // Server-backed: query the index as you type (debounced; a sequence guard drops
            // out-of-order responses). Scales past any client-held document list.
            if (acTimer)
                clearTimeout(acTimer);
            acTimer = setTimeout(async () => {
                const mySeq = ++acSeq;
                /** @type {LinkDoc[]} */
                let items = [];
                try {
                    items = await linkSearch(raw);
                }
                catch (e) {
                    items = [];
                }
                if (mySeq !== acSeq)
                    return;
                acItems = (items || []).slice(0, 8);
                renderUrlAc();
            }, 160);
        }
        else {
            const q = raw.toLowerCase();
            acItems = linkDocs.filter(d => !q || (d.id && d.id.toLowerCase().includes(q)) || (d.title && d.title.toLowerCase().includes(q))).slice(0, 8);
            renderUrlAc();
        }
    }
    urlInput.addEventListener('input', () => { pop.classList.remove('link-pop-err'); acActive = -1; openUrlAc(); });
    urlInput.addEventListener('focus', openUrlAc);
    urlInput.addEventListener('keydown', e => {
        if (acDrop && acItems.length) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                acActive = Math.min(acItems.length - 1, acActive + 1);
                renderUrlAc();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                acActive = Math.max(0, acActive - 1);
                renderUrlAc();
                return;
            }
            if (e.key === 'Enter' && acActive >= 0) {
                e.preventDefault();
                pickDoc(acItems[acActive]);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeUrlAc();
                return;
            }
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            closeLinkPop();
        }
    });
    textInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            closeLinkPop();
        }
    });
    linkOff = function (e) {
        const t = /** @type {Element} */ (e.target);
        if (linkPop && !linkPop.contains(t) && !(t.closest && t.closest('.link-ac')))
            closeLinkPop();
    };
    setTimeout(() => document.addEventListener('mousedown', linkOff), 0);
    setTimeout(() => ((o.canText && !textInput.value) ? textInput : urlInput).focus(), 20);
}
