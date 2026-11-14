// thirdpartyrenderer/software-design.ts - facade around the Software Designer
// diagram editor (UML, sequence, activity and wireframe diagrams).
// ===========================================================================
// NOT core code: it adapts an EXTERNAL library to WebDoc's extension points and
// only runs when the site opts in via  "plugins": ["software-design"].
//
// BRING YOUR OWN LIBRARY. The library is one self-contained file, built in the
// Software Designer repository with `npm run build:embed` (dist-embed/
// softwaredesigner.js). Copy it next to this facade:
//   app/thirdpartyrenderer/softwaredesigner.js
// or set LIB_URL below. If it is missing, diagrams fall back to their source.
//
// What it adds:
//  - ```softwaredesigner fenced blocks render as a read-only diagram: SVG in a
//    pan/zoom frame, links that follow like Markdown links, and the diagram in
//    words for screen readers and AI tools (all drawn by the library).
//  - the "software-design" widget wraps such a block:
//      <!-- meta start {"widget":"software-design","title":"Checkout"} -->
//      ```softwaredesigner
//      { "format": "softwaredesigner/2", ... }
//      ```
//      <!-- meta end {"widget":"software-design"} -->
//    Readers who may edit the page get an Edit button that opens the full editor
//    over the page and saves straight back into the block. In the page editor
//    the widget's settings open the same editor.
//
// The diagram format is the library's FORMAT.md: JSON that people and AI tools
// can read and write, with the meaning (elements, relations) apart from layout.
// ===========================================================================

import { registerBlockRenderer } from '../js/blocks.js';
import { registerWidget } from '../js/widgets.js';
import { app } from '../js/app-shell.js';
import { registerMounted, resolveDocPaths } from '../js/reader.js';
import { elem } from '../js/dom.js';
import type { WidgetContext, WidgetEditorContext } from '../js/widgets.js';

/** The slice of the library's API this facade uses (see its EMBEDDING.md). */
interface Handle { update(options: Record<string, unknown>): void; destroy(): void }
interface EditorHandle extends Handle { isDirty(): boolean }
interface SoftwareDesignerLib {
  mountViewer(target: HTMLElement, options: Record<string, unknown>): Handle;
  mountEditor(target: HTMLElement, options: Record<string, unknown>): EditorHandle;
}

declare global {
  interface Window {
    /** Set by the host page if it loaded the library itself. */
    SoftwareDesigner?: SoftwareDesignerLib;
  }
}

// Optional explicit URL for the library. Leave '' to use ./softwaredesigner.js
// next to this facade.
const LIB_URL = '';
const FENCE_LANG = 'softwaredesigner';
const DEFAULT_HEIGHT = 440;

let libPromise: Promise<SoftwareDesignerLib> | null = null;
function loadLib(): Promise<SoftwareDesignerLib> {
  if (window.SoftwareDesigner) return Promise.resolve(window.SoftwareDesigner);
  if (!libPromise) {
    const src = LIB_URL || new URL('./softwaredesigner.js', import.meta.url).href;
    libPromise = (import(/* @vite-ignore */ src) as Promise<SoftwareDesignerLib>).catch(() => {
      libPromise = null;
      throw new Error('the Software Designer library was not found. Build it with `npm run build:embed` in the ' +
        'Software Designer repository and copy dist-embed/softwaredesigner.js to app/thirdpartyrenderer/');
    });
  }
  return libPromise;
}

// --- Theme -------------------------------------------------------------------

const theme = (): 'light' | 'dark' => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

// Every mounted viewer and editor follows the site's light/dark switch.
const themed = new Set<Handle>();
new MutationObserver(() => themed.forEach(h => h.update({ theme: theme() })))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// The library's colours (EMBEDDING.md, Theming) from WebDoc's own tokens, so the
// viewer and editor look like part of the site in both themes.
const STYLE = `
.wd-software-design .uml-viewer, .wd-sd-overlay .uml-designer {
  --sd-font: inherit;
  --sd-surface: var(--surface); --sd-surface-alt: var(--surface-2);
  --sd-hover: var(--surface-2); --sd-hover-strong: var(--surface-sunk);
  --sd-border: var(--border); --sd-input-bg: var(--bg); --sd-input-border: var(--border-strong);
  --sd-text: var(--text); --sd-text-muted: var(--muted); --sd-heading: var(--text);
  --sd-accent: var(--accent); --sd-accent-hover: var(--accent-hover);
  --sd-accent-text: var(--accent-contrast); --sd-accent-soft: var(--accent-soft);
  --sd-bar: var(--surface); --sd-bar-text: var(--text); --sd-bar-input: var(--bg);
  --sd-backdrop: var(--scrim); --sd-warning-soft: var(--warn-bg);
}
.wd-software-design { margin: 1em 0; }
.wd-software-design > .wd-sd-title { font-weight: 600; margin: 0 0 .4em; }
.wd-software-design > .wd-sd-empty { color: var(--muted); }
.wd-sd-overlay { position: fixed; inset: 0; z-index: 1000; background: var(--scrim); display: flex; padding: 2vh 2vw; }
.wd-sd-overlay > .wd-sd-frame { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--surface);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.wd-sd-overlay .wd-sd-status { padding: 6px 12px; font-size: 13px; color: var(--muted); border-bottom: 1px solid var(--border); }
.wd-sd-overlay .wd-sd-status:empty { display: none; }
.wd-sd-overlay .wd-sd-status.wd-sd-error { color: var(--warn-text); background: var(--warn-bg); }
.wd-sd-overlay .wd-sd-editor { flex: 1; min-height: 0; }
.blk-widget .wd-sd-open { margin-top: .5em; }
`;
let styled = false;
function addStyle() {
  if (styled) return;
  styled = true;
  document.head.append(elem('style', { id: 'wd-software-design-style', text: STYLE }));
}

// --- Links -------------------------------------------------------------------

/**
 * Follow a link from a diagram the way the page's own Markdown links go: web
 * addresses in a new tab, #sections on this page, and page paths resolved like
 * [text](path) against the page holding the diagram. The library only passes
 * links that are safe to follow.
 */
async function followLink(href: string, baseId: string): Promise<void> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { window.open(href, '_blank', 'noopener,noreferrer'); return; }
  if (href.startsWith('#/')) { location.hash = href; return; }
  if (href.startsWith('#')) {
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  const hash = href.indexOf('#');
  const path = (hash >= 0 ? href.slice(0, hash) : href).replace(/\.md$/i, '').replace(/\/+$/, '');
  const id = (await resolveDocPaths(baseId, [path]))[path];
  if (!id) { app.showError?.('The diagram links to "' + href + '", which is not a page here.'); return; }
  if (app.navigate) app.navigate(id); else location.hash = '#/' + id;
}

// --- The diagram block ---------------------------------------------------------

/** The diagram JSON inside a widget's Markdown: the first ```softwaredesigner block. */
function fenceOf(markdown: string): string | null {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*softwaredesigner[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}\1[ \t]*$/m.exec(markdown);
  return m ? m[2] : null;
}

/** The widget's Markdown with its diagram replaced (or added, if it had none). */
function withFence(markdown: string, json: string): string {
  const ticks = '`'.repeat(Math.max(3, ...[...json.matchAll(/`+/g)].map(m => m[0].length + 1)));
  const block = ticks + FENCE_LANG + '\n' + json.replace(/\s+$/, '') + '\n' + ticks;
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*softwaredesigner[ \t]*\r?\n[\s\S]*?\r?\n {0,3}\1[ \t]*$/m.exec(markdown);
  if (m) return markdown.slice(0, m.index) + block + markdown.slice(m.index + m[0].length);
  const trimmed = markdown.replace(/^\s+|\s+$/g, '');
  return '\n' + (trimmed ? trimmed + '\n\n' : '') + block + '\n';
}

const EMPTY = '{\n  "format": "softwaredesigner/2",\n  "elements": []\n}';

/** Mounts a read-only viewer into `host`; it is destroyed with the page. */
async function mountViewer(host: HTMLElement, diagram: string, baseId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const lib = await loadLib();
  addStyle();
  const handle = lib.mountViewer(host, {
    diagram, theme: theme(),
    onlink: (href: string) => { void followLink(href, baseId); },
    ...extra,
  });
  themed.add(handle);
  registerMounted(host, () => { themed.delete(handle); handle.destroy(); });
}

// A bare ```softwaredesigner block anywhere in a page: read-only.
registerBlockRenderer(FENCE_LANG, async (source, ctx) => {
  const docId = String((ctx as unknown as { docId?: string }).docId || '');
  const host = elem('div', 'wd-mounted wd-software-design');
  await mountViewer(host, source, docId);
  return host;
}, { label: 'Software Designer diagram' });

// --- The editor overlay --------------------------------------------------------

interface EditorSession {
  diagram: string;
  baseId: string;
  /** Store the diagram; rejects with a sentence to show when it cannot. */
  save(json: string): Promise<void>;
}

/** Opens the full editor over the page. Closing with unsaved changes asks first. */
async function openEditor(session: EditorSession): Promise<void> {
  const lib = await loadLib();
  addStyle();
  const status = elem('div', { class: 'wd-sd-status', role: 'status', 'aria-live': 'polite' });
  const target = elem('div', 'wd-sd-editor');
  const overlay = elem('div', { class: 'wd-sd-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Diagram editor' },
    elem('div', 'wd-sd-frame', status, target));
  const scroll = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.append(overlay);

  const report = (text: string, error = false) => { status.textContent = text; status.classList.toggle('wd-sd-error', error); };
  const close = () => { themed.delete(handle); handle.destroy(); overlay.remove(); document.body.style.overflow = scroll; };
  const handle: EditorHandle = lib.mountEditor(target, {
    diagram: session.diagram,
    theme: theme(),
    onsave: (json: string) => {
      report('Saving…');
      session.save(json).then(() => report('Saved.'), (e: unknown) => report(e instanceof Error ? e.message : String(e), true));
    },
    onclose: ({ dirty }: { dirty: boolean }) => {
      if (dirty && !confirm('Close the diagram editor and discard the changes you have not saved?')) return;
      close();
    },
    onwarnings: (warnings: string[]) => report('Some of this diagram could not be shown and was kept as it is: ' + warnings.join(' '), true),
    onlink: (href: string) => {
      if (handle.isDirty() && !confirm('Leave the diagram editor and discard the changes you have not saved?')) return;
      close();
      void followLink(href, session.baseId);
    },
  });
  themed.add(handle);
}

// --- The widget ------------------------------------------------------------------

registerWidget({
  name: 'software-design',
  displayName: 'Software design',
  icon: '◫',
  description: 'A UML, sequence, activity or wireframe diagram, drawn and edited with the Software Designer editor.',
  editor: {
    fields: [
      { name: 'title', label: 'Title', type: 'text', default: '' },
      { name: 'height', label: 'Height (px)', type: 'number', default: DEFAULT_HEIGHT, min: 160, max: 2000 },
    ],
    // In the page editor: open the diagram editor on the widget's content
    component(context: WidgetEditorContext) {
      const open = elem('button', { type: 'button', class: 'btn wd-sd-open' }, 'Open diagram editor');
      open.addEventListener('click', () => {
        const content = context.content;
        if (!content) { context.setError('editor', 'This version of WebDoc cannot edit widget content.'); return; }
        void openEditor({
          diagram: fenceOf(content.get()) ?? EMPTY,
          baseId: context.docId,
          save: async json => { content.set(withFence(content.get(), json)); },
        }).catch(e => context.setError('editor', 'The diagram editor could not open: ' + (e instanceof Error ? e.message : String(e))));
      });
      return open;
    },
  },
  async render(ctx: WidgetContext) {
    // The widget draws the diagram itself; drop whatever the block renderer
    // mounted in its pre-rendered content.
    ctx.teardown(ctx.content);
    const options = ctx.options;
    const host = elem('div', 'wd-mounted wd-software-design');
    if (typeof options.title === 'string' && options.title.trim()) host.append(elem('p', 'wd-sd-title', options.title));
    const diagram = fenceOf(ctx.innerMarkdown);
    const height = Number(options.height) > 0 ? Number(options.height) : DEFAULT_HEIGHT;
    let inner = ctx.innerMarkdown;
    const save = ctx.saveContent;
    const onedit = save ? () => {
      void openEditor({
        diagram: fenceOf(inner) ?? EMPTY,
        baseId: ctx.docId,
        save: async json => { const next = withFence(inner, json); await save(next); inner = next; },
      }).catch(ctx.reportError);
    } : undefined;
    if (diagram === null) {
      host.append(elem('p', 'wd-sd-empty', 'No diagram yet.'));
      if (onedit) host.append(elem('button', { type: 'button', class: 'btn', onClick: onedit }, 'Draw a diagram'));
      return host;
    }
    const view = elem('div', 'wd-mounted');
    host.append(view);
    await mountViewer(view, diagram, ctx.docId, { height, ...(onedit ? { onedit } : {}) });
    return host;
  },
});
