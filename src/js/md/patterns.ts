// md/patterns.ts - the low-level block scanning primitives: the line-shape
// regexes, HTML-block start/end detection, and the whitespace/tab-column helpers
// that the block parser (./blocks.js) drives. Pure and self-contained (imports
// nothing). Extracted from blocks.js.
// ---------------------------------------------------------------------------

// ---- line-shape patterns --------------------------------------------------
export const reThematic = /^ {0,3}([-_*])(?:[ \t]*\1){2,}[ \t]*$/;
export const reATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
export const reFence = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
export const reBulletItem = /^( *)([-+*])( +|\t|$)(.*)$/;
export const reOrderedItem = /^( *)(\d{1,9})([.)])( +|\t|$)(.*)$/;
export const reBlockquote = /^ {0,3}> ?/;
export const reSetext = /^ {0,3}(=+|-+)[ \t]*$/;
export const reBlank = /^[ \t]*$/;

// ---- HTML blocks ----------------------------------------------------------
/**
 * Classify a line as an HTML-block start condition (CommonMark types 1-7).
 * @param canInterrupt true when the container is NOT an open paragraph (type 7 is only recognized then)
 * @returns the HTML block kind (1-7), or 0 if no HTML block starts here
 */
export function htmlBlockKind(line: string, canInterrupt: boolean): number {
  const l = line.replace(/^ {0,3}/, '');
  if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(l)) return 1;
  if (/^<!--/.test(l)) return 2;
  if (/^<\?/.test(l)) return 3;
  if (/^<![A-Za-z]/.test(l)) return 4;
  if (/^<!\[CDATA\[/.test(l)) return 5;
  if (/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>/]|$)/i.test(l)) return 6;
  if (!canInterrupt) {
    const OPEN = '<[A-Za-z][A-Za-z0-9-]*(?:[ \\t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \\t]*=[ \\t]*(?:[^"\'=<>`\\s]+|\'[^\']*\'|"[^"]*"))?)*[ \\t]*/?>';
    const CLOSE = '</[A-Za-z][A-Za-z0-9-]*[ \\t]*>';
    if (new RegExp('^(?:' + OPEN + '|' + CLOSE + ')[ \\t]*$').test(l)) return 7;
  }
  return 0;
}
/**
 * @param kind an HTML block kind as returned by htmlBlockKind
 * @returns whether this line's content closes the HTML block (kinds 6/7 close on a blank line instead, handled by the caller)
 */
export function htmlBlockCloses(kind: number, line: string): boolean {
  switch (kind) {
    case 1: return /<\/(?:script|pre|style|textarea)>/i.test(line);
    case 2: return /-->/.test(line);
    case 3: return /\?>/.test(line);
    case 4: return />/.test(line);
    case 5: return /\]\]>/.test(line);
    default: return false; // 6,7 close on a blank line (handled by caller)
  }
}

// ---- whitespace / tab-column helpers --------------------------------------
/**
 * Tab-expanded leading-whitespace measurement for a line; used throughout
 * md/blocks.js's line loop to decide indentation-sensitive structure (indented
 * code, list markers, blockquote markers).
 */
export interface LineIndent {
  /** the leading whitespace width in columns (tabs expanded) */
  spaces: number;
  /** the character index in `s` where the leading whitespace ends */
  offset: number;
}

export function leading(s: string): LineIndent {
  let spaces = 0, i = 0, col = 0;
  while (i < s.length) {
    if (s[i] === ' ') { spaces++; col++; i++; }
    else if (s[i] === '\t') { const n = 4 - (col % 4); spaces += n; col += n; i++; }
    else break;
  }
  return { spaces: spaces, offset: i };
}
/**
 * Remove up to n columns of leading whitespace.
 */
export function removeIndent(s: string, n: number): string {
  let col = 0, i = 0;
  while (i < s.length && col < n) {
    if (s[i] === ' ') { col++; i++; }
    else if (s[i] === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return s.slice(i);
}
export function stripUpTo(s: string, n: number): string {
  let i = 0, col = 0;
  while (i < s.length && col < n && (s[i] === ' ' || s[i] === '\t')) { col += s[i] === '\t' ? 4 - (col % 4) : 1; i++; }
  return s.slice(i);
}
/**
 * Remove exactly n columns of leading whitespace, splitting a straddling tab.
 */
export function stripCols(s: string, n: number): string {
  let i = 0, col = 0;
  while (i < s.length && col < n) {
    if (s[i] === '\t') { const w = 4 - (col % 4); if (col + w <= n) { col += w; i++; } else { return ' '.repeat(col + w - n) + s.slice(i + 1); } }
    else if (s[i] === ' ') { col++; i++; }
    else break;
  }
  return s.slice(i);
}
/**
 * Expand only the LEADING run of whitespace of `s`, measuring tab stops from
 * `startCol` so a tab after a list marker lands on the correct column.
 */
export function expandLeadingTabs(s: string, startCol: number): string {
  let i = 0, col = startCol, out = '';
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; }
    else { out += ' '; col++; }
    i++;
  }
  return out + s.slice(i);
}
