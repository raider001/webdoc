import { describe, it, expect } from 'vitest';
import { scanMetaBlocks } from '/js/meta-blocks.js';
import { preprocessWidgets } from '/js/widgets.js';
import { extractGroups, preprocessRequirements } from '/js/requirements/parse.js';
import { splitMeta } from '/js/catalog.js';
import { wrapped } from './widget-harness.js';

describe('paired metadata widgets', () => {
  it.each(['collapse', 'live', 'panel'])('recognises %s options and keeps source Markdown', widget => {
    const markdown = wrapped(widget, '**bold**\n\n| A | B |\n|---|---|\n| x | y |', { title: 'Queue', open: false, src: 'LM/live/queue', interval: 60 });
    const [block] = scanMetaBlocks(markdown);
    expect(block.options.widget).toBe(widget);
    expect(block.options.open).toBe(false);
    expect(block.error).toBeUndefined();
    expect(markdown.slice(block.innerStart, block.innerEnd)).toContain('**bold**');
    expect(preprocessWidgets(markdown)).toContain('```wd-widget');
  });

  it('pairs nested widgets, requirements and tests independently', () => {
    const requirements = '<!--meta start {"requirement-group":"queue"}-->\n| requirement-no | description | trace-to |\n|---|---|---|\n| 1 | Queue | |\n<!--meta end {"requirement-group":"queue"}-->';
    const test = '<!--meta start {"test":"queue","steps":[{"action":"Run","expected":"Done"}]}-->\n<!--meta end {"test":"queue"}-->';
    const markdown = wrapped('collapse', requirements + '\n' + wrapped('collapse', test) + '\n' + wrapped('live', '', { src: 'LM/live/queue' }));
    expect(scanMetaBlocks(markdown).map(b => b.options.widget || b.options.test || b.options['requirement-group'])).toEqual(['collapse', 'queue', 'collapse', 'queue', 'live']);
    const blocks = extractGroups(markdown, { id: 'Docs/example', source: 'Docs' }, 'WD');
    expect(blocks.map(b => b.kind)).toEqual(['req', 'test']);
    const processed = preprocessRequirements(markdown, 'Docs/example');
    expect(processed).toContain('Docs/example::0');
    expect(processed).toContain('Docs/example::1');
    expect(processed).toContain('"widget":"collapse"');
  });

  it('keeps fenced, indented and inline examples literal', () => {
    const widget = wrapped('collapse');
    for (const markdown of ['```text\n' + widget + '\n```', '~~~~text\n' + widget + '\n~~~~', '`<!--meta start {"widget":"collapse"}-->`', widget.split('\n').map(l => '    ' + l).join('\n')]) {
      expect(scanMetaBlocks(markdown)).toEqual([]);
      expect(preprocessWidgets(markdown)).toBe(markdown);
    }
  });

  it('accepts multiline JSON and CRLF', () => {
    const markdown = '<!--meta start {\r\n "widget": "collapse",\r\n "title": "Queue"\r\n}-->\r\ncontent\r\n<!--meta end {"widget":"collapse"}-->';
    expect(scanMetaBlocks(markdown)[0].options.title).toBe('Queue');
    expect(scanMetaBlocks(markdown)[0].error).toBeUndefined();
  });

  it.each([
    ['<!--meta start {"widget":"collapse",}-->\ncontent\n<!--meta end {"widget":"collapse"}-->', 'JSON'],
    ['<!--meta start {"widget":"collapse"}-->\ncontent', 'closing'],
    ['<!--meta end {"widget":"live"}-->', 'opening'],
    ['<!--meta start {"widget":"collapse"}-->\ncontent\n<!--meta end {"widget":"live"}-->', 'match'],
    ['<!--meta start {"widget":"collapse"}-->\ncontent\n<!--meta end {}-->', 'match'],
  ])('reports malformed input without throwing', (markdown, message) => {
    expect(scanMetaBlocks(markdown)[0].error).toContain(message);
    expect(() => preprocessWidgets(markdown)).not.toThrow();
  });

  it('does not mistake a first widget for a page metadata header', () => {
    const markdown = wrapped('collapse');
    expect(splitMeta(markdown).body).toBe(markdown);
    expect(splitMeta('<!--meta {"title":"Title"}-->\n' + markdown).meta.title).toBe('Title');
  });
});
