// Shared, fence-aware paired metadata scanner. Offsets always refer to the
// original source; consumers can replace regions without losing nested blocks.
export interface MetaBlock {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  options: Record<string, unknown>;
  widget: boolean;
  error?: string;
}

function objectJson(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}

function identity(options: Record<string, unknown>): string {
  if ('widget' in options) return 'widget:' + String(options.widget);
  return String(options.test || options['test-case'] || options['requirement-group'] || options.group || '');
}

export function scanMetaBlocks(source: string): MetaBlock[] {
  const blocks: MetaBlock[] = [];
  const stack: MetaBlock[] = [];
  const fenced: [number, number][] = [];
  let offset = 0;
  let fence: { char: string; length: number; start: number } | null = null;
  for (const line of source.split('\n')) {
    const end = offset + line.length;
    // CRLF sources keep "\r" on each line; `.` and `$` do not match it, so test
    // the line without it while offsets still count it.
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.endsWith('\r') ? line.slice(0, -1) : line);
    if (f) {
      if (!fence) fence = { char: f[1][0], length: f[1].length, start: offset };
      else if (f[1][0] === fence.char && f[1].length >= fence.length && !f[2].trim()) {
        fenced.push([fence.start, end]); fence = null;
      }
    }
    offset = end + 1;
  }
  if (fence) fenced.push([fence.start, source.length]);
  const token = /<!--\s*meta\s+(start|end)\b\s*([\s\S]*?)-->/gi;
  let m: RegExpExecArray | null;
  while ((m = token.exec(source))) {
    const start = m.index;
    const end = start + m[0].length;
    // A wrapper occupies its own line(s); code examples and inline mentions
    // must remain literal. Multiline JSON retains the legacy block syntax.
    if (fenced.some(([a, b]) => start >= a && start < b) ||
        !/^ {0,3}$/.test(source.slice(source.lastIndexOf('\n', start - 1) + 1, start)) ||
        !/^[ \t\r]*$/.test(source.slice(end, source.indexOf('\n', end) < 0 ? source.length : source.indexOf('\n', end)))) continue;
    let options: Record<string, unknown> = {};
    let error: string | undefined;
    try { options = objectJson(m[2] || '{}'); } catch { error = 'Metadata is not a JSON object'; }
    const widget = 'widget' in options || /["']widget["']\s*:/.test(m[2]);
    if (m[1].toLowerCase() === 'start') {
      const block: MetaBlock = { start, end, innerStart: end, innerEnd: end, options, widget, error };
      stack.push(block);
      blocks.push(block);
    } else {
      const block = stack.pop();
      if (block) {
        block.end = end;
        block.innerEnd = start;
        if (error || (block.widget && !('widget' in options)) ||
            (identity(options) && identity(block.options) !== identity(options))) {
          block.error = block.error || 'Closing metadata does not match the opening block';
        }
      } else if (widget) {
        blocks.push({ start, end, innerStart: end, innerEnd: end, options, widget, error: 'Widget has no opening marker' });
      }
    }
  }
  for (const block of stack) {
    block.error = block.error || 'Block has no closing marker';
    // Do not swallow the rest of the page for an unclosed marker.
    block.innerStart = block.innerEnd = block.end;
  }
  return blocks.sort((a, b) => a.start - b.start);
}

export function outerBlocks(blocks: MetaBlock[]): MetaBlock[] {
  return blocks.filter((b, i) => !blocks.slice(0, i).some(parent => parent.start < b.start && parent.end >= b.end));
}

export function replaceMetaBlocks(source: string, blocks: MetaBlock[], replace: (block: MetaBlock, index: number) => string): string {
  let out = '', from = 0;
  outerBlocks(blocks).forEach((block, index) => {
    out += source.slice(from, block.start) + replace(block, index);
    from = block.end;
  });
  return out + source.slice(from);
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Replace what a widget holds in a document's source, leaving its markers and
 * everything around it untouched. The widget is found by what it holds - the
 * same options and the same inner Markdown the page was rendered from - so a
 * widget that a reader saves from is the one they were looking at. Returns null
 * when no widget matches: the page changed since it was rendered, and saving
 * over it would lose someone else's edit.
 */
export function replaceWidgetContent(source: string, options: Record<string, unknown>, oldInner: string, newInner: string): string | null {
  const match = scanMetaBlocks(source).find(b => b.widget && !b.error && sameJson(b.options, options) &&
    source.slice(b.innerStart, b.innerEnd) === oldInner);
  if (!match) return null;
  return source.slice(0, match.innerStart) + newInner + source.slice(match.innerEnd);
}

/** Keep authored widget prose in the page-link index, omitting structured data. */
export function stripMetaBlocks(source: string): string {
  return replaceMetaBlocks(source, scanMetaBlocks(source).filter(b => !b.widget), () => '')
    .replace(/<!--\s*meta\s+(?:start|end)\b[\s\S]*?-->/gi, '');
}
