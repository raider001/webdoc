// md/render.ts - PHASE 2: render the block tree to an HTML string. Leaf-block
// text is handed to the inline parser; tables are delegated to md/tables.js.
// ---------------------------------------------------------------------------
import { parseInlines } from './inline.js';
import { esc, decodeInlineText } from './text.js';
import { renderTable } from './tables.js';
/**
 * PHASE 2 entry point: render a parsed document's block tree to an HTML string.
 * @param doc the document root block, as returned by parseDocument
 */
export function renderTree(doc, refs) {
    return renderChildren(doc, refs, false);
}
/**
 * @param tight whether the enclosing list is tight (suppresses paragraph <p> wrapping)
 */
function renderChildren(block, refs, tight) {
    let out = '';
    for (const child of block.children) {
        if (child.type === 'empty')
            continue;
        out += renderBlock(child, refs, tight);
    }
    return out;
}
function renderBlock(b, refs, tight) {
    switch (b.type) {
        case 'paragraph': {
            let html = parseInlines(b.lines.join('\n').replace(/^\s+|\s+$/g, ''), refs);
            if (b.taskPrefix)
                html = b.taskPrefix + ' ' + html;
            return tight ? html : '<p>' + html + '</p>\n';
        }
        case 'heading': {
            const html = parseInlines(b.lines.join('\n').replace(/^\s+|\s+$/g, ''), refs);
            return '<h' + b.level + '>' + html + '</h' + b.level + '>\n';
        }
        case 'thematic': return '<hr />\n';
        case 'blockquote': return '<blockquote>\n' + renderChildren(b, refs, false) + '</blockquote>\n';
        case 'list': {
            const tag = b.listType === 'ordered' ? 'ol' : 'ul';
            const startAttr = (b.listType === 'ordered' && b.start !== 1 && b.start !== null) ? ' start="' + b.start + '"' : '';
            return '<' + tag + startAttr + '>\n' + renderChildren(b, refs, b.tight) + '</' + tag + '>\n';
        }
        case 'item': {
            // GFM task list item: first block is a paragraph starting with [ ], [x] or [X].
            const first = b.children.find(c => c.type !== 'empty');
            if (first && first.type === 'paragraph' && first.lines.length && !first.taskPrefix) {
                const tm = /^\[([ xX])\](?=\s|$)/.exec(first.lines[0]);
                if (tm) {
                    const checked = tm[1] === 'x' || tm[1] === 'X';
                    first.taskPrefix = '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox" />';
                    first.lines = first.lines.slice();
                    first.lines[0] = first.lines[0].slice(tm[0].length);
                }
            }
            const inner = renderChildren(b, refs, tight);
            if (tight)
                return '<li>' + inner.replace(/^\n/, '').replace(/\n$/, '') + '</li>\n';
            return '<li>' + (inner === '' ? '' : '\n' + inner) + '</li>\n';
        }
        case 'codeblock': {
            let code = b.lines.join('\n');
            if (b.kind === 'fenced')
                code = code + (b.lines.length ? '\n' : '');
            else {
                code = code.replace(/\n+$/, '\n');
                code = code.replace(/^\n+/, '');
                if (!/\n$/.test(code))
                    code += '\n';
            }
            if (b.kind === 'fenced' && b.lines.length === 0)
                code = '';
            const info = b.kind === 'fenced' && b.info ? b.info.split(/\s+/)[0] : '';
            const cls = info ? ' class="language-' + esc(decodeInlineText(info).toLowerCase()) + '"' : '';
            return '<pre><code' + cls + '>' + esc(code) + '</code></pre>\n';
        }
        case 'htmlblock': return b.lines.join('\n') + '\n';
        case 'table': return renderTable(b, refs);
        default: return '';
    }
}
