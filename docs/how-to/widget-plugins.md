<!--meta
{ "title": "Add a Widget Plugin", "description": "Register a custom widget and offer its options in the block editor.", "assumes": ["Docs/features/diagrams"], "next": ["Docs/features/widget-api"] }
-->

# Add a Widget Plugin

1. Create `app/thirdpartyrenderer/my-panel.js`. Import `registerWidget` from
   `../js/widgets.js` and register `my-panel` using the
   [API example](Docs/features/widget-api). In this TypeScript checkout, a
   maintained plugin can instead live in `src/thirdpartyrenderer/` and be built
   with the application.
2. Give it `displayName`, `icon`, `description` and an `editor` definition so
   authors can find it and use its own settings. Append the supplied `content` element to preserve nested
   widgets and requirement mounts.
3. Add `my-panel` to `config.json`'s `plugins` array, preserving existing entries,
   then restart the server and reload the reader to load the changed config.
4. Choose your plugin from **+ Add widget**, then use **⚙ Edit** beside its real
   renderer preview. Save to produce matching `widget` metadata markers.
5. Check an intentional render failure: the widget should show an inline notice
   while the rest of the page remains usable. Wrap callbacks with `guard` and
   clean up subscriptions in `destroy`.

For a ready-made reference, insert the built-in **Panel**:

```text
<!--meta start {"widget":"panel","title":"Highlights"}-->
- A richer container around ordinary Markdown.
<!--meta end {"widget":"panel"}-->
```

Only install plugins whose JavaScript you trust. The
[widget API](Docs/features/widget-api) explains the error boundary and lifecycle.
