<!--meta
{ "title": "Widget Extension API", "description": "Register paired Markdown widgets, editor fields and lifecycle hooks through an optional renderer plugin.", "assumes": ["Docs/features/diagrams"], "next": ["Docs/how-to/widget-plugins", "Docs/features/live-widget"] }
-->

# Widget Extension API

A widget is a named renderer for a metadata-wrapped Markdown body. Unlike a
fenced diagram, its body remains normal Markdown. Plugins use the existing
`app/thirdpartyrenderer/<name>.js` folder and the configuration's `plugins` list.
The built-in `collapse`, `live`, `live-table` and `panel` types are available
without enabling a plugin.

## Register a type

```javascript
// app/thirdpartyrenderer/my-panel.js
import { registerWidget } from '../js/widgets.js';

registerWidget({
  name: 'my-panel',
  displayName: 'My panel',
  icon: '▣',
  description: 'A titled container for Markdown.',
  editor: { fields: [{ name: 'title', label: 'Title', type: 'text', default: 'Panel', required: true }] },
  render({ options, content }) {
    const panel = document.createElement('aside');
    const title = document.createElement('strong');
    title.textContent = String(options.title || 'Panel');
    panel.append(title, content);
    return panel;
  },
  mount(context) { /* subscribe; use context.signal for cancellation */ },
  update(context) { /* react to context.update() */ },
  destroy(context) { /* remove subscriptions and release resources */ }
});
```

Enable it with `"plugins": ["my-panel"]` in
[configuration](Docs/reference/config). Names use lower-case letters, digits
and hyphens, beginning with a letter; duplicate registrations are rejected.
The **displayName**, **icon** (a text glyph) and one-line **description** identify
the type in the toolbar and insertion menus. `label` remains a compatibility
alias for displayName. A file missing or failing
during import is skipped by the plugin loader.

```text
<!--meta start {"widget":"my-panel","title":"Highlights"}-->
**Rich Markdown** inside a plugin's panel.
<!--meta end {"widget":"my-panel"}-->
```

## Render context

| Property | Meaning |
| --- | --- |
| `options` | The opening marker's JSON object, including `widget`. Unknown keys survive the editor. |
| `innerMarkdown` | The body Markdown. |
| `content` | A sanitized, rendered body element. Append this element to keep its nested widgets and requirement mounts. |
| `innerHTML` | A snapshot of that rendered body's HTML. Prefer moving `content`; copying HTML does not copy its lifecycle. |
| `host` | The widget's container. A renderer can fill it itself or return a Node. |
| `docId`, `pageId`, `key`, `depth` | Source document, owning page, positional identity and nesting depth. |
| `signal` | Aborted when the widget is destroyed or fails. Cancel outstanding work with it. |
| `renderContent(markdown, docId?)` | Run fresh Markdown through the reader pipeline, including links, resources, requirements and widgets, without page chrome or scroll resets. |
| `teardown(root)` | Destroy widgets and Svelte components inside a body before replacing it. |
| `update(options?)` | Optionally replace the context's options and invoke the registered update hook. Returns a Promise. |
| `reportError(error)` | Replace this widget with an inline failure notice. |
| `guard(callback)` | Wrap an event or timer callback so thrown errors and rejected Promises use that inline failure notice. |

`render` receives the context and returns a Node, nothing if it fills `host`, or
a Promise for either. `mount` runs in a microtask once the host is connected.
`update` runs when `context.update()` is called; the live widget calls it after
replacing changed content. Hooks may return Promises. `destroy` runs once during
teardown, including failure cleanup. Resources must be released even if mounting
only partially completed.

## Editor fields

Each type supplies `editor.fields` and/or `editor.component`. Authors insert
the named type, see its actual renderer preview and open **⚙ Edit** for its own
settings panel. Collapsible titles and nested Markdown remain editable inline.
Raw options are available only inside **Advanced**. Unrecognised plugin types
already in a document are preserved; they do not create a generic insert entry.

| Field type | Editor control |
| --- | --- |
| `text` | Text input |
| `number` | Number input with optional `min`/`max` |
| `boolean` | Checkbox |
| `select` | Choices supplied as strings, or by `choices(options, signal)` |
| `document` | Document id and a browser of the reader-filtered site tree |
| `section` | Headings from the document in `documentField` (default `src`); empty means whole document |
| `columns` | Source column selection, label, format, move-up/down and remove controls |
| `data-source` | Markdown document/section, CSV file, or JSON file/array-key controls |
| `interval` | Refresh interval in seconds, normally 1–86400 |

Every field has `name`, `label`, optional serializable `default`, `required`,
`hint` and `validate(value, options)`. A validator returns an error sentence or
`undefined`; errors appear beside the field and prevent saving. `visibleWhen`
can hide conditional fields. `choices` may return a Promise and receives an
AbortSignal; `dependsOn` names the options that trigger a new column-discovery
request. Unknown keys survive editing. Top-level `fields` is retained for old
plugins; new plugins should declare their editor explicitly.

```javascript
editor: {
  fields: [
    { name: 'src', label: 'Document', type: 'document', required: true },
    { name: 'section', label: 'Section', type: 'section', documentField: 'src' },
    { name: 'mode', label: 'Mode', type: 'select', choices: ['compact', 'full'], default: 'compact' },
    { name: 'interval', label: 'Refresh', type: 'interval', default: 60 }
  ]
}
```

For a custom component, return an HTMLElement or
`{ element, destroy?, validate? }`. Components are mounted synchronously; a
plugin can mount its own already-loaded Svelte component into that element.
`validate` returns a boolean. The editor context has `options`, `docId`,
`signal`, `change(patch)` and `setError(fieldName, message?)`. Use `change` to
update options and the renderer preview; use `signal`/`destroy` to release
subscriptions and requests. Component/validation errors stay inside settings.

```javascript
editor: {
  component(ctx) {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Panel title');
    input.value = String(ctx.options.title || '');
    const change = () => ctx.change({ title: input.value });
    input.addEventListener('input', change);
    return {
      element: input,
      validate: () => {
        ctx.setError('title', input.value.trim() ? undefined : 'Enter a title');
        return !!input.value.trim();
      },
      destroy: () => input.removeEventListener('input', change)
    };
  }
}
```

## Failure boundary and trust

Errors in render, mount and update are contained in the widget; rejected Promises
also become inline notices. A failed destroy cannot block navigation. Use
`guard` for event listeners and timer callbacks, and `signal` for pending work.
The output scrub removes scripts, inline event attributes and script URLs,
matching the existing diagram-renderer safety net.

Plugins are trusted JavaScript installed by the site operator. This is an error
boundary, not an iframe or a security sandbox: arbitrary global side effects,
unguarded asynchronous callbacks and infinite loops cannot be contained. A
plugin must not fetch private content by another channel or inject unsanitized
authored HTML. Widget nesting is limited to 16 levels.

## Built-in reference implementations

`src/js/widgets/panel.ts` supplies **Panel** and its own editor.
`widget-panel` remains a harmless compatibility plugin for configurations that
enabled the original example. New plugins can copy the registration example
above under their own name.

```text
<!--meta start {"widget":"panel","title":"Programme highlights"}-->
Any ordinary Markdown, including another widget.
<!--meta end {"widget":"panel"}-->
```

The collapse implementation in `src/js/widgets/collapse.ts` is the built-in
reference for persistence and cleanup; `src/js/widgets/live.ts` demonstrates
session-aware fetching, cancellation and in-place updates. The
[auto-update table](Docs/how-to/live-table) in `src/js/widgets/live-table.ts`
demonstrates data-source and columns editors plus conditional data fetching.
