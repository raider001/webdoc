// highlight/grammars.ts - the per-language tokenizers. Each is a small state
// machine that drives a Lexer over the code and emits typed tokens; all grammars
// are written from scratch (token names/structure original to this project).
// Extracted from highlighter.js. Exports one tokenizer per supported language.
// ---------------------------------------------------------------------------
import { lineLen, blockLen, quoteLen, atLineStart, prevIsBoundary, nextIsParen, lineStartIdx, RE_ID, RE_NUM_GEN, RE_NUM_PY, RE_NUM_JAVA, Lexer } from './lexer.js';
// ---- Python ---------------------------------------------------------------
const PY_KW = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
    'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
    'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
    'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
    'match', 'case'
]);
const PY_BUILTIN = new Set([
    'print', 'len', 'range', 'int', 'str', 'float', 'bool', 'list', 'dict',
    'set', 'tuple', 'type', 'object', 'isinstance', 'issubclass', 'super',
    'abs', 'min', 'max', 'sum', 'sorted', 'enumerate', 'zip', 'map', 'filter',
    'open', 'input', 'format', 'repr', 'id', 'hash', 'iter', 'next', 'any',
    'all', 'round', 'divmod', 'pow', 'bytes', 'bytearray', 'frozenset',
    'complex', 'hex', 'oct', 'bin', 'ord', 'chr', 'vars', 'dir', 'getattr',
    'setattr', 'hasattr', 'delattr', 'callable', 'staticmethod', 'classmethod',
    'property', 'self', 'cls', 'Exception', 'ValueError', 'TypeError',
    'KeyError', 'IndexError', 'RuntimeError', 'StopIteration'
]);
/**
 * Length of a Python string literal at i (optional r/b/u/f prefix, single or
 * triple quotes), safely to close or end-of-input; 0 if none starts here.
 */
function pyStringAt(src, i) {
    const head = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 6));
    if (!head)
        return 0;
    const prefix = head[1], quote = head[2];
    const raw = /r/i.test(prefix);
    const triple = quote.length === 3;
    let j = i + prefix.length + quote.length;
    while (j < src.length) {
        const c = src[j];
        if (!raw && c === '\\') {
            j += 2;
            continue;
        }
        if (src.startsWith(quote, j))
            return (j + quote.length) - i;
        if (!triple && c === '\n')
            return j - i; // unterminated single-line
        j++;
    }
    return src.length - i;
}
export function pythonTokens(src) {
    const lx = new Lexer(src);
    while (!lx.eof()) {
        const c = lx.peek();
        if (c === '#') {
            lx.push('comment', lineLen(src, lx.pos));
            continue;
        }
        const s = pyStringAt(src, lx.pos);
        if (s) {
            lx.push('string', s);
            continue;
        }
        if (c === '@' && atLineStart(src, lx.pos)) {
            const m = lx.match(/@[A-Za-z_][\w.]*/y);
            if (m) {
                lx.push('meta', m[0].length);
                continue;
            }
        }
        const num = lx.match(RE_NUM_PY);
        if (num) {
            lx.push('number', num[0].length);
            continue;
        }
        const id = lx.match(RE_ID);
        if (id) {
            const w = id[0];
            let type = null;
            if (lx.prev && lx.prev.type === 'keyword' &&
                (lx.prev.text === 'def' || lx.prev.text === 'class'))
                type = 'function';
            else if (PY_KW.has(w))
                type = 'keyword';
            else if (PY_BUILTIN.has(w))
                type = 'builtin';
            else if (nextIsParen(src, lx.pos + w.length))
                type = 'function';
            lx.push(type, w.length);
            continue;
        }
        const op = lx.match(/[-+*/%=<>!&|^~@:]+/y);
        if (op) {
            lx.push('operator', op[0].length);
            continue;
        }
        const pun = lx.match(/[()[\]{}.,;]/y);
        if (pun) {
            lx.push('punct', pun[0].length);
            continue;
        }
        lx.push(null, 1);
    }
    return lx.toks;
}
// ---- Java -----------------------------------------------------------------
const JAVA_KW = new Set([
    'abstract', 'assert', 'break', 'case', 'catch', 'class', 'const',
    'continue', 'default', 'do', 'else', 'enum', 'extends', 'final', 'finally',
    'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'interface',
    'native', 'new', 'package', 'private', 'protected', 'public', 'return',
    'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
    'throws', 'transient', 'try', 'volatile', 'while', 'var', 'yield', 'record',
    'sealed', 'permits', 'module', 'requires', 'exports', 'true', 'false', 'null'
]);
const JAVA_TYPE = new Set([
    'boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'short',
    'void', 'String', 'Object', 'Integer', 'Long', 'Double', 'Float',
    'Boolean', 'Character', 'Byte', 'Short', 'Number', 'List', 'Map', 'Set',
    'Collection', 'ArrayList', 'LinkedList', 'HashMap', 'TreeMap', 'HashSet',
    'Optional', 'Stream', 'Iterable', 'Iterator', 'Exception', 'Throwable',
    'RuntimeException', 'Override', 'System', 'Math', 'Thread', 'Runnable'
]);
const JAVA_DECL = new Set(['class', 'interface', 'enum', 'record', 'new']);
/**
 * Length of a Java string ("..." or a """ text block) or 0.
 */
function javaStringAt(src, i) {
    if (src.startsWith('"""', i)) {
        let j = i + 3;
        while (j < src.length) {
            if (src[j] === '\\') {
                j += 2;
                continue;
            }
            if (src.startsWith('"""', j))
                return (j + 3) - i;
            j++;
        }
        return src.length - i;
    }
    if (src[i] === '"')
        return quoteLen(src, i, '"', true);
    return 0;
}
export function javaTokens(src) {
    const lx = new Lexer(src);
    while (!lx.eof()) {
        const c = lx.peek();
        if (c === '/' && lx.peek(1) === '/') {
            lx.push('comment', lineLen(src, lx.pos));
            continue;
        }
        if (c === '/' && lx.peek(1) === '*') {
            lx.push('comment', blockLen(src, lx.pos));
            continue;
        }
        const s = javaStringAt(src, lx.pos);
        if (s) {
            lx.push('string', s);
            continue;
        }
        if (c === "'") {
            lx.push('string', quoteLen(src, lx.pos, "'", true));
            continue;
        }
        if (c === '@') {
            const m = lx.match(/@\s*[A-Za-z_][\w.]*/y);
            if (m) {
                lx.push('meta', m[0].length);
                continue;
            }
        }
        const num = lx.match(RE_NUM_JAVA);
        if (num) {
            lx.push('number', num[0].length);
            continue;
        }
        const id = lx.match(RE_ID);
        if (id) {
            const w = id[0];
            let type = null;
            if (JAVA_KW.has(w))
                type = 'keyword';
            else if (lx.prev && lx.prev.type === 'keyword' && JAVA_DECL.has(lx.prev.text))
                type = 'function';
            else if (nextIsParen(src, lx.pos + w.length))
                type = 'function';
            else if (JAVA_TYPE.has(w))
                type = 'builtin';
            lx.push(type, w.length);
            continue;
        }
        const op = lx.match(/[-+*/%=<>!&|^~?:]+/y);
        if (op) {
            lx.push('operator', op[0].length);
            continue;
        }
        const pun = lx.match(/[()[\]{};,.]/y);
        if (pun) {
            lx.push('punct', pun[0].length);
            continue;
        }
        lx.push(null, 1);
    }
    return lx.toks;
}
// ---- shell ----------------------------------------------------------------
const SH_KW = new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
    'case', 'esac', 'in', 'function', 'select', 'time', 'coproc'
]);
const SH_BUILTIN = new Set([
    'echo', 'cd', 'export', 'set', 'unset', 'local', 'read', 'printf', 'source',
    'alias', 'eval', 'exit', 'return', 'trap', 'shift', 'pwd', 'test', 'declare',
    'readonly', 'getopts', 'kill', 'wait', 'jobs', 'true', 'false', 'command',
    'type', 'hash', 'umask', 'exec', 'sudo', 'ls', 'cat', 'grep', 'sed', 'awk'
]);
/**
 * Length of a $(...) command substitution (paren-balanced), to close or EOF.
 */
function shParenSub(src, i) {
    let depth = 0;
    for (let j = i + 1; j < src.length; j++) {
        if (src[j] === '(')
            depth++;
        else if (src[j] === ')') {
            depth--;
            if (depth === 0)
                return (j + 1) - i;
        }
    }
    return src.length - i;
}
/**
 * Length of a ${...} expansion, to close or EOF.
 */
function shBraceVar(src, i) {
    let j = i + 2;
    while (j < src.length && src[j] !== '}')
        j++;
    return (j < src.length ? j + 1 : j) - i;
}
/**
 * Length of a `...` command substitution, to close or EOF.
 */
function shBacktick(src, i) {
    let j = i + 1;
    while (j < src.length && src[j] !== '`')
        j++;
    return (j < src.length ? j + 1 : j) - i;
}
export function shellTokens(src) {
    const lx = new Lexer(src);
    while (!lx.eof()) {
        const c = lx.peek();
        if (lx.pos === 0 && c === '#' && lx.peek(1) === '!') {
            lx.push('meta', lineLen(src, lx.pos));
            continue;
        }
        if (c === '#' && prevIsBoundary(src, lx.pos)) {
            lx.push('comment', lineLen(src, lx.pos));
            continue;
        }
        if (c === '$' && lx.peek(1) === "'") {
            lx.push('string', 1 + quoteLen(src, lx.pos + 1, "'", true));
            continue;
        }
        if (c === '"') {
            lx.push('string', quoteLen(src, lx.pos, '"', true));
            continue;
        }
        if (c === "'") {
            lx.push('string', quoteLen(src, lx.pos, "'", false));
            continue;
        }
        if (c === '`') {
            lx.push('variable', shBacktick(src, lx.pos));
            continue;
        }
        if (c === '$') {
            const n = lx.peek(1);
            if (n === '(') {
                lx.push('variable', shParenSub(src, lx.pos));
                continue;
            }
            if (n === '{') {
                lx.push('variable', shBraceVar(src, lx.pos));
                continue;
            }
            const nm = lx.match(/\$[A-Za-z_][A-Za-z0-9_]*/y);
            if (nm) {
                lx.push('variable', nm[0].length);
                continue;
            }
            const sp = lx.match(/\$[@*#?$!0-9-]/y);
            if (sp) {
                lx.push('variable', sp[0].length);
                continue;
            }
            lx.push(null, 1);
            continue;
        }
        const id = lx.match(/[A-Za-z_][A-Za-z0-9_]*/y);
        if (id) {
            const w = id[0];
            let type = null;
            if (SH_KW.has(w))
                type = 'keyword';
            else if (SH_BUILTIN.has(w))
                type = 'builtin';
            else if (nextIsParen(src, lx.pos + w.length))
                type = 'function';
            lx.push(type, w.length);
            continue;
        }
        const num = lx.match(RE_NUM_GEN);
        if (num) {
            lx.push('number', num[0].length);
            continue;
        }
        const op = lx.match(/[|&;<>]+/y);
        if (op) {
            lx.push('operator', op[0].length);
            continue;
        }
        const pun = lx.match(/[()[\]{}]/y);
        if (pun) {
            lx.push('punct', pun[0].length);
            continue;
        }
        lx.push(null, 1);
    }
    return lx.toks;
}
// ---- Makefile -------------------------------------------------------------
const MK_DIRECTIVE = /(?:include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|override|export|unexport|vpath)\b/y;
const MK_TARGET = /[.A-Za-z0-9_%][A-Za-z0-9_.%/-]*(?=[ \t]*:(?!=))/y;
const MK_ASSIGN = /[A-Za-z_][A-Za-z0-9_]*(?=[ \t]*[:+?!]?=)/y;
/**
 * True on a recipe line (first char of the line is a hard TAB).
 */
function mkInRecipe(src, i) { return src[lineStartIdx(src, i)] === '\t'; }
export function makefileTokens(src) {
    const lx = new Lexer(src);
    while (!lx.eof()) {
        const c = lx.peek();
        if (c === '#') {
            lx.push('comment', lineLen(src, lx.pos));
            continue;
        }
        if (atLineStart(src, lx.pos) && c !== ' ' && c !== '\t' && !mkInRecipe(src, lx.pos)) {
            const dir = lx.match(MK_DIRECTIVE);
            if (dir) {
                lx.push('keyword', dir[0].length);
                continue;
            }
            const tgt = lx.match(MK_TARGET);
            if (tgt) {
                lx.push('function', tgt[0].length);
                continue;
            }
            const asn = lx.match(MK_ASSIGN);
            if (asn) {
                lx.push('variable', asn[0].length);
                continue;
            }
        }
        if (c === '$') {
            const n = lx.peek(1);
            if (n === '(') {
                lx.push('variable', shParenSub(src, lx.pos));
                continue;
            }
            if (n === '{') {
                lx.push('variable', shBraceVar(src, lx.pos));
                continue;
            }
            const auto = lx.match(/\$[@<^?*+%|&$]/y); // automatic vars incl. $$ escape
            if (auto) {
                lx.push('variable', auto[0].length);
                continue;
            }
            lx.push(null, 1);
            continue;
        }
        if (c === '"') {
            lx.push('string', quoteLen(src, lx.pos, '"', true));
            continue;
        }
        if (c === "'") {
            lx.push('string', quoteLen(src, lx.pos, "'", false));
            continue;
        }
        const op = lx.match(/[:+?!]?=|::?/y);
        if (op) {
            lx.push('operator', op[0].length);
            continue;
        }
        lx.push(null, 1);
    }
    return lx.toks;
}
// ---- Robot Framework ------------------------------------------------------
export function robotTokens(src) {
    const lx = new Lexer(src);
    while (!lx.eof()) {
        const c = lx.peek();
        if (atLineStart(src, lx.pos) && src.startsWith('***', lx.pos)) {
            lx.push('section', lineLen(src, lx.pos));
            continue;
        }
        if (c === '#' && prevIsBoundary(src, lx.pos)) {
            lx.push('comment', lineLen(src, lx.pos));
            continue;
        }
        if ((c === '$' || c === '@' || c === '&' || c === '%') && lx.peek(1) === '{') {
            const m = lx.match(/[$@&%]\{[^}\n]*\}/y);
            if (m) {
                lx.push('variable', m[0].length);
                continue;
            }
        }
        if (c === '[') {
            const m = lx.match(/\[[A-Za-z][A-Za-z ]*\]/y);
            if (m) {
                lx.push('attr', m[0].length);
                continue;
            }
        }
        lx.push(null, 1);
    }
    return lx.toks;
}
// ---- generic fallback -----------------------------------------------------
export function genericTokens(src) {
    const lx = new Lexer(src);
    while (!lx.eof()) {
        const c = lx.peek();
        if (c === '/' && lx.peek(1) === '/') {
            lx.push('comment', lineLen(src, lx.pos));
            continue;
        }
        if (c === '/' && lx.peek(1) === '*') {
            lx.push('comment', blockLen(src, lx.pos));
            continue;
        }
        if (c === '#' && prevIsBoundary(src, lx.pos)) {
            lx.push('comment', lineLen(src, lx.pos));
            continue;
        }
        if (c === '"') {
            lx.push('string', quoteLen(src, lx.pos, '"', true));
            continue;
        }
        if (c === "'") {
            lx.push('string', quoteLen(src, lx.pos, "'", true));
            continue;
        }
        const num = lx.match(RE_NUM_GEN);
        if (num) {
            lx.push('number', num[0].length);
            continue;
        }
        lx.push(null, 1);
    }
    return lx.toks;
}
