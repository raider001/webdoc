<!--meta
{ "title": "Add an Auto-Update Table", "description": "Choose a document table, CSV or JSON source, then select and format columns in the visual editor.", "assumes": ["Docs/features/widget-api"], "next": ["Docs/features/live-widget", "Docs/how-to/widget-plugins"] }
-->

# Add an Auto-Update Table

1. Open the visual editor and choose **+ Add widget → Auto-update table**.
   The same named type appears in the block insertion menu.
2. Choose **⚙ Edit** on its preview. Select a source format:
   **Markdown table**, **CSV file**, or **JSON file**.
3. For Markdown, browse to a document and choose the heading containing its
   table. For example, choose `LM/live/queue` and **Running**. The first table
   in that section supplies the data. Empty section selects the first table
   in the whole document.
4. For CSV or JSON, browse to a file inside a configured document root. CSV
   uses its first row as unique column names and supports quoted commas,
   escaped quotes and multiline values. JSON can be an array of objects, or
   an object containing one; enter an **array key** such as `jobs` or
   `data.jobs` for the latter.
5. Choose **Use source columns**, or **+ Add column** to pick columns individually.
   Rename the displayed labels, reorder with ↑/↓, and choose each format:
   text, number, percent, date/time, link or status badge. An empty columns
   list displays all source columns as text.
6. Select a default sort column/direction, optionally enter a case-insensitive
   row filter, and set **Maximum rows** and the refresh interval in seconds.
   The filter searches displayed columns. Percent values normally use
   fractions (`0.25` → `25%`); strings already ending in `%` keep that scale.
   Date/time expects a parseable date, preferably ISO 8601.
7. Review the actual table preview, choose **Done**, then save the document.
   A field error appears beside the control and prevents a save. Raw options
   and plugin-specific extra keys are available inside **Advanced**.

Markdown example:

```text
<!--meta start {"widget":"live-table","source":{"kind":"markdown","src":"LM/live/queue","section":"Running"},"columns":[{"key":"Job","label":"Job","format":"text"},{"key":"Minutes so far","label":"Minutes","format":"number"}],"sortBy":"Minutes so far","sortDirection":"desc","maxRows":20,"interval":60}-->
The queue will appear here when the source is available.
<!--meta end {"widget":"live-table"}-->
```

CSV and JSON source options use the same widget and column configuration:

```json
{"kind":"csv","src":"Docs/data/jobs.csv"}
{"kind":"json","src":"Docs/data/jobs.json","key":"jobs"}
```

In the reader, **Refresh** updates just this table and **updated HH:MM** shows
the last successful check. Unchanged data retains its DOM nodes, table scroll,
and neighbouring widgets. Changed data preserves table and reading-pane scroll.
Updates pause when the tab is hidden, resume when it is shown, and back off on
errors. Requests time out after 30 seconds and stop when the widget is removed.
Transient errors keep fallback or previous rows with an inline message;
permission refusals and session changes clear fetched rows.

CSV/JSON are served through read-only `/api/data/file?src=<source/path>`.
The server uses the current session and the existing asset access policy:
readable referring documents grant access; unreferenced files inherit their
nearest document folder's access. Table source declarations are indexed as
asset references. The file picker uses the filtered `/api/data/tree` endpoint.
Hidden files, traversal, alternate streams and links escaping the configured
root are rejected. Files are limited to 2 MiB and carry an ETag; access is
checked again before every 304 response. There is no external-URL source or
write-back destination: a generator updates the chosen source on disk.

The parser accepts at most 10,000 rows and 128 columns. Display is limited by
**Maximum rows** (1–10,000, default 100). JSON cells containing objects display
as text, except link objects `{ "label": "Plan", "href": "#/LM/overview" }`.
Link format allows site links, HTTP(S) and mailto; script links remain plain
text. Status colours recognise done/complete/pass/ok/success, running/active/
pending/queued, and failed/fail/error/blocked; other values use a neutral badge.
