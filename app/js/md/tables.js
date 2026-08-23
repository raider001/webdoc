// md/tables.ts - GFM tables. `extractTables` is a block post-pass that rewrites
// qualifying paragraphs (a header row immediately followed by a delimiter row)
// into `table` blocks; `renderTable` renders one to HTML during phase 2.
// ---------------------------------------------------------------------------
import { makeBlock } from './blocks.js';
import { parseInlines } from './inline.js';
/**
 * Split one table row into trimmed cell strings. An escaped pipe (\|) is a
 * literal pipe; a single unescaped leading/trailing pipe is a fence, not a cell.
 */
function splitTableRow(line) {
    const s = line.trim();
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\' && i + 1 < s.length && s[i + 1] === '|') {
            cur += '|';
            i++;
            continue;
        }
        if (c === '\\' && i + 1 < s.length) {
            cur += c + s[i + 1];
            i++;
            continue;
        }
        if (c === '|') {
            cells.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    cells.push(cur);
    if (cells.length > 1 && cells[0].trim() === '')
        cells.shift();
    if (cells.length > 1 && cells[cells.length - 1].trim() === '')
        cells.pop();
    return cells.map(c => c.trim());
}
/**
 * Validate a GFM table delimiter row.
 * @returns an array of per-column alignments ('left'|'right'|'center'|null), or null if invalid
 */
function parseDelimiterRow(line) {
    if (line.indexOf('|') === -1)
        return null; // require at least one pipe
    const cells = splitTableRow(line);
    if (!cells.length)
        return null;
    const aligns = [];
    for (const cell of cells) {
        const m = /^(:?)-+(:?)$/.exec(cell);
        if (!m)
            return null;
        const l = m[1] === ':', r = m[2] === ':';
        aligns.push(l && r ? 'center' : r ? 'right' : l ? 'left' : null);
    }
    return aligns;
}
/**
 * If `lines` (a paragraph's accumulated lines) contain a header row immediately
 * followed by a delimiter row with matching column count, describe the table.
 */
function tryBuildTable(lines) {
    for (let d = 1; d < lines.length; d++) {
        const aligns = parseDelimiterRow(lines[d]);
        if (!aligns)
            continue;
        const header = splitTableRow(lines[d - 1]);
        if (header.length !== aligns.length)
            continue;
        return { headerIndex: d - 1, delimIndex: d, aligns };
    }
    return null;
}
/**
 * Walk the block tree, converting qualifying paragraphs into table blocks.
 */
export function extractTables(block) {
    const kids = block.children;
    for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (child.type === 'paragraph') {
            const built = tryBuildTable(child.lines);
            if (!built)
                continue;
            const repl = [];
            if (built.headerIndex > 0) {
                const para = makeBlock('paragraph', { open: false });
                para.lines = child.lines.slice(0, built.headerIndex);
                repl.push(para);
            }
            const headerCells = splitTableRow(child.lines[built.headerIndex]);
            const bodyRows = [];
            for (let r = built.delimIndex + 1; r < child.lines.length; r++) {
                bodyRows.push(splitTableRow(child.lines[r]));
            }
            const tbl = makeBlock('table', { open: false, aligns: built.aligns, headerCells, bodyRows });
            repl.push(tbl);
            kids.splice(i, 1, ...repl);
            i += repl.length - 1;
        }
        else if (child.children && child.children.length) {
            extractTables(child);
        }
    }
}
/**
 * Render a `table` block to HTML.
 */
export function renderTable(b, refs) {
    const cols = b.aligns.length;
    /** @param a this column's alignment, null for the default */
    const attr = (a) => a ? ' align="' + a + '"' : '';
    /** @param text raw cell markdown */
    const cell = (tag, text, a) => '<' + tag + attr(a) + '>' + parseInlines(text || '', refs) + '</' + tag + '>\n';
    let out = '<table>\n<thead>\n<tr>\n';
    for (let i = 0; i < cols; i++)
        out += cell('th', b.headerCells[i], b.aligns[i]);
    out += '</tr>\n</thead>\n';
    if (b.bodyRows.length) {
        out += '<tbody>\n';
        for (const row of b.bodyRows) {
            out += '<tr>\n';
            for (let i = 0; i < cols; i++)
                out += cell('td', row[i], b.aligns[i]);
            out += '</tr>\n';
        }
        out += '</tbody>\n';
    }
    out += '</table>\n';
    return out;
}
