// md/scan.js - link-syntax scanners shared by the block phase (link reference
// definitions) and the inline phase (inline + reference links/images):
// link destinations, titles, bracket labels, and link-label normalization.
// No dependencies.
// ---------------------------------------------------------------------------
/**
 * Result of scanning a link destination (either `<...>` or a bare,
 * parenthesis-balanced run) starting at a source index; consumed wherever a
 * link or ref-def destination is parsed (md/blockpost.js, md/inline.js).
 * @typedef {Object} LinkDestScan
 * @property {string} dest
 * @property {number} pos
 */
/**
 * @param {string} text
 * @param {number} i - index to start scanning from
 * @returns {LinkDestScan|null}
 */
export function scanDest(text, i) {
    if (text[i] === '<') {
        let j = i + 1, dest = '';
        while (j < text.length) {
            const c = text[j];
            if (c === '\n' || c === '<')
                return null;
            if (c === '\\' && j + 1 < text.length) {
                dest += c + text[j + 1];
                j += 2;
                continue;
            }
            if (c === '>')
                return { dest: dest, pos: j + 1 };
            dest += c;
            j++;
        }
        return null;
    }
    let j = i, dest = '', depth = 0;
    while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length) {
            dest += c + text[j + 1];
            j += 2;
            continue;
        }
        if (c === '(') {
            depth++;
            dest += c;
            j++;
            continue;
        }
        if (c === ')') {
            if (depth === 0)
                break;
            depth--;
            dest += c;
            j++;
            continue;
        }
        if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 0x20)
            break;
        dest += c;
        j++;
    }
    if (dest === '')
        return null;
    return { dest: dest, pos: j };
}
/**
 * Result of scanning an optional link title (quoted or parenthesized) starting
 * at a source index; consumed by both the ref-def parser (md/blockpost.js) and
 * the inline link/image closer (md/inline.js).
 * @typedef {Object} LinkTitleScan
 * @property {string} title
 * @property {number} pos
 */
/**
 * @param {string} text
 * @param {number} i - index to start scanning from
 * @returns {LinkTitleScan|null}
 */
export function scanTitle(text, i) {
    const open = text[i];
    if (open !== '"' && open !== "'" && open !== '(')
        return null;
    const close = open === '(' ? ')' : open;
    let j = i + 1, title = '';
    while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length) {
            title += c + text[j + 1];
            j += 2;
            continue;
        }
        if (c === close)
            return { title: title, pos: j + 1 };
        if (open === '(' && c === '(')
            return null;
        title += c;
        j++;
    }
    return null;
}
// Link-label matching normalizes only whitespace and case (Unicode case fold);
// it does NOT resolve backslash escapes or entities, so `[foo\!]` and `[foo!]`
// are different labels.
/**
 * @param {string} s
 * @returns {string} the case-folded, whitespace-collapsed label used as the refs map key
 */
export function normLabel(s) { return s.replace(/[ \t\r\n]+/g, ' ').trim().toLowerCase().toUpperCase().toLowerCase(); }
/**
 * Result of scanning a `[...]` bracket label, used by md/inline.js to resolve
 * the collapsed/full reference-link form `[text][label]`.
 * @typedef {Object} BracketLabelScan
 * @property {string} label
 * @property {number} pos
 */
/**
 * @param {string} s
 * @param {number} i - index to start scanning from (must point at the opening '[')
 * @returns {BracketLabelScan|null}
 */
export function scanBracketLabel(s, i) {
    if (s[i] !== '[')
        return null;
    let j = i + 1, label = '';
    while (j < s.length) {
        const c = s[j];
        if (c === '\\' && j + 1 < s.length) {
            label += c + s[j + 1];
            j += 2;
            continue;
        }
        if (c === ']')
            return { label: label, pos: j + 1 };
        if (c === '[')
            return null;
        label += c;
        j++;
    }
    return null;
}
