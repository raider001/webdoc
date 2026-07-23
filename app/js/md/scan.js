// md/scan.js - link-syntax scanners shared by the block phase (link reference
// definitions) and the inline phase (inline + reference links/images):
// link destinations, titles, bracket labels, and link-label normalization.
// No dependencies.
// ---------------------------------------------------------------------------

export function scanDest(text, i) {
  if (text[i] === '<') {
    let j = i + 1, dest = '';
    while (j < text.length) {
      const c = text[j];
      if (c === '\n' || c === '<') return null;
      if (c === '\\' && j + 1 < text.length) { dest += c + text[j + 1]; j += 2; continue; }
      if (c === '>') return { dest: dest, pos: j + 1 };
      dest += c; j++;
    }
    return null;
  }
  let j = i, dest = '', depth = 0;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\' && j + 1 < text.length) { dest += c + text[j + 1]; j += 2; continue; }
    if (c === '(') { depth++; dest += c; j++; continue; }
    if (c === ')') { if (depth === 0) break; depth--; dest += c; j++; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 0x20) break;
    dest += c; j++;
  }
  if (dest === '') return null;
  return { dest: dest, pos: j };
}
export function scanTitle(text, i) {
  const open = text[i];
  if (open !== '"' && open !== "'" && open !== '(') return null;
  const close = open === '(' ? ')' : open;
  let j = i + 1, title = '';
  while (j < text.length) {
    const c = text[j];
    if (c === '\\' && j + 1 < text.length) { title += c + text[j + 1]; j += 2; continue; }
    if (c === close) return { title: title, pos: j + 1 };
    if (open === '(' && c === '(') return null;
    title += c; j++;
  }
  return null;
}
// Link-label matching normalizes only whitespace and case (Unicode case fold);
// it does NOT resolve backslash escapes or entities, so `[foo\!]` and `[foo!]`
// are different labels.
export function normLabel(s) { return s.replace(/[ \t\r\n]+/g, ' ').trim().toLowerCase().toUpperCase().toLowerCase(); }

export function scanBracketLabel(s, i) {
  if (s[i] !== '[') return null;
  let j = i + 1, label = '';
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length) { label += c + s[j + 1]; j += 2; continue; }
    if (c === ']') return { label: label, pos: j + 1 };
    if (c === '[') return null;
    label += c; j++;
  }
  return null;
}
