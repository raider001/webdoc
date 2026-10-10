<!--meta
{ "title": "Auto-Update Sections", "description": "Refresh a document or named heading inside a widget without reloading the page.", "assumes": ["Docs/features/collapsible"], "next": ["Docs/how-to/live-widget", "Docs/features/widget-api"] }
-->

# Auto-Update Sections

The `live` widget fetches another document and refreshes its own body. The rest
of the page, its scroll position and neighbouring widgets remain in place.

```text
<!--meta start {"widget":"live","src":"LM/live/queue","section":"Running","interval":60}-->
The queue will appear here when the source is available.
<!--meta end {"widget":"live"}-->
```

| Option | Meaning |
| --- | --- |
| `src` | Required document id, including its configured source name, such as `LM/live/queue`. An optional `.md` suffix is accepted. |
| `section` | Exact visible heading text. Omit or leave empty to include the whole document body. |
| `interval` | Seconds between updates; default 60, minimum 1, maximum 86400. |

The first fetch happens when the widget mounts. **Refresh** requests an immediate
update. A successful fetch shows **updated HH:MM** in the browser's local time.
Unchanged Markdown keeps the existing body and its nested widget instances.

## Section boundaries

The heading itself and its subsections are included, up to the next heading of
the same or higher level. ATX (`## Running`) and setext headings are supported,
including inline formatting; fenced code headings are ignored. If a heading
appears twice, the first match wins. A missing heading shows an update error.
Choose headings at the document level and keep paired metadata/access wrappers
wholly within the selected section, so slicing does not split a wrapper.

Live headings are numbered locally and excluded from the page's global contents
list. Their ids are scoped to the widget to support repeated inclusions. Links,
relative images, diagrams, requirement groups, test cases and nested widgets
use the same pipeline as an ordinary page, with the source document as their
link/resource base.

## Sessions and failure handling

Sources are fetched from `/docs/<source>/<path>.md`, with same-origin session
credentials and no browser cache. External URLs, traversal, encoded path input,
queries and fragments are rejected. The server applies its existing document
access rules and section redaction before returning Markdown. The widget does
not fetch an unrestricted copy or store source content in localStorage.

Updates pause while the tab is hidden. Leaving the page cancels pending fetches
and releases timers, listeners and nested Svelte mounts. A request times out
after 30 seconds. Failed updates back off exponentially, up to one hour (or the
normal interval when that is longer); a
success resets the normal interval. Manual refresh can retry earlier.

On transient errors, fallback or previously fetched content remains visible
beside an error status. HTTP 401, 403 and 404 clear fetched content, and a session
change clears it before another update. The server remains the authority on
what a reader can see.

## Limits

Ordinary document navigation also checks a small index version and conditionally
revalidates the selected document. External edits refresh the tree and cached
document metadata without reloading the page. Changing only a live source keeps
an unchanged dashboard article mounted.

This is interval polling, not a server push feed. Avoid cyclic live inclusions;
all widgets have a nesting limit of 16. A changed live body is replaced as a
fragment, so unsaved interactions inside that changed body are not retained.
Neighbouring widgets remain untouched, and collapsible state inside the body
can be restored by its stable `id`. Editing the dashboard file itself still
rebuilds the article; editing only a live source does not.
