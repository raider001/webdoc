<!--meta
{ "title": "Performance & Scale", "description": "How large a library WebDocs supports, the measured numbers behind it, and the architecture that gets there.", "assumes": ["Docs/reference/config"], "next": [] }
-->

# Performance & Scale

WebDocs was built to stay fast from a handful of documents up to **tens of
thousands of files**, and it has been measured to half a million. This page is the
honest account of what it supports, the numbers behind the claims, and the two
architectural choices that make the difference.

## What makes it scale

Early on, the browser loaded *every* document body at start-up and built the
search index, the map's links, and the requirement/test traceability entirely on
the client. That is simple and works beautifully for hundreds of documents — but
it is also a wall: at a few thousand files the tab is holding the whole library in
memory and the graph views try to create one SVG element per node. Two changes
removed the wall, both staying inside the project's constraints (a
standard-library-only server, no Node.js needed to run it, no build step for a
document, and no new third-party code in the browser):

- **A server-side index.** `serve.py` now builds a **SQLite (FTS5) index** of each
  document's metadata, headings, in-body links, and requirement/test blocks.
  `sqlite3` is part of the Python standard library, so this adds no dependency and
  no build step — the index builds on a background thread at start-up, updates
  incrementally when a document is saved, and lives in a disposable cache folder
  (`.webdoc-index/`) that is rebuilt, never migrated. The browser now **boots
  lazily**: it loads only the document you are viewing, and pulls search, the
  tree, the map, and traceability from the index on demand. The Markdown engine is
  still a pure client-side `string → HTML` function; only lightweight metadata
  extraction moved to the server. See [Configuration](Docs/reference/config) for
  the server and the index endpoints.
- **Canvas map rendering.** The [map](Docs/features/map) and the coverage view draw
  on a single `<canvas>` with a spatial index, viewport culling, and three levels
  of detail (dots when zoomed out, boxes at mid-zoom, full labels up close). Only
  what is on screen is drawn, so a frame costs the same at five hundred nodes or
  five hundred thousand. The whole graph is still rendered — it simply becomes a
  navigable density map when zoomed out, because tens of thousands of legible
  labels at once is physically impossible.

## Measured numbers

Measured on one commodity local machine, warm OS file cache, with synthetic
libraries of the stated size. Times are wall-clock; memory is the browser tab's
JavaScript heap.

| Library | Cold index build | Boot → interactive | Memory after boot | All-documents search | Map open | Map pan/zoom frame |
| ------- | ---------------- | ------------------ | ----------------- | -------------------- | -------- | ------------------ |
| 50,000 files | ~18 s | ~0.3 s | ~8 MB | 20–70 ms | ~1.0 s | ~0.3 ms |
| 100,000 files | ~36 s | ~2.5 s | ~12 MB | 15–100 ms | ~1.1 s | ~0.5 ms |
| 500,000 files | ~130 s | ~4.5 s | ~37 MB | 15–110 ms | ~4.6 s | ~0.3 ms |

A few things to read out of that table:

- **Boot, search, and reading barely move** as the library grows, because none of
  them hold the whole corpus. Opening a single document is 1–5 ms regardless of
  size.
- **The cold index build is a one-time cost** and runs in the background — the app
  serves immediately and shows a progress bar while it finishes (see below). A
  warm restart re-checks file modification times and keeps the existing index, so
  it is far quicker than a first build.
- **The map open** is where corpus size shows: it lays out every node and streams a
  compact (gzipped, integer-indexed) payload. Once open, panning and zooming stay
  smooth at ~60 fps because drawing is culled to the viewport.

## Supported limits

*Comfortable* means smooth, sub-second interactions with no hitches. *Practical
maximum* means still usable, but with noticeable one-time costs — a multi-second
map open, a longer first index build, higher memory. Search and reading scale much
further than the map, because they never hold the whole library at once.

| Capability | Comfortable | Practical maximum | What binds it at the maximum |
| ---------- | ----------- | ----------------- | ---------------------------- |
| **Search & read** (all-documents search, opening and rendering a document, the tree) | ~50,000 files | ~200,000–500,000 files | The one-time cold index build (roughly a few thousand files per second) and the index's disk size. Full-text search itself scales to millions of rows; boot and per-document cost stay flat. |
| **The document map** (whole graph, on canvas) | ~50,000 nodes | ~100,000–150,000 nodes | Browser heap for the in-memory layout and edges (about 0.2 GB at 50k, ~0.8 GB at 500k) and the one-time open frame. Interactive frames stay flat. Readability becomes a "constellation" well before this. |
| **Test traceability** (the coverage view) | ~50,000 requirement + test nodes | ~100,000 nodes | The same canvas engine as the map, measured in requirement + test count — which is a multiple of document count, depending on how many requirements each document carries. |

For context, a 500,000-file demo genuinely runs: search and navigation are
effortless, and even the whole-graph map opens in a few seconds and holds under a
gigabyte. That is roughly two orders of magnitude beyond the pre-index ceilings
(around one to two thousand map nodes, and one and a half to two thousand
traceability nodes).

## Knobs

- **Full-text body search.** By default the index covers titles, descriptions, and
  headings — matching what the older client-side search offered. Set
  `"indexBody": true` in `config.json` to index document bodies as well, at the
  cost of a larger index.
- **A separate index location.** `"indexDir"` in `config.json` points a site's
  index at its own folder, so two configurations (say a small guide and a large
  archive) never share or rebuild each other's database.
- **First-run progress.** The first time a large library is indexed, the app shows
  a progress bar ("*N documents indexed · X%*") instead of a blank screen, and
  clears it the moment the index is ready. Later starts, with the index already
  built, skip straight through.

## The short version

Reach for a **comfortable few tens of thousands of documents** for the full
experience — reading, search, the map, and traceability all snappy. Push toward
**hundreds of thousands** and search and reading stay excellent while the whole-map
view becomes the limiting factor. The architecture — a standard-library SQLite
index plus a culled canvas renderer — is what carries it there without adding a
single dependency on either side. See [Configuration](Docs/reference/config) for
how the index and server fit together, and
[Architecture](Docs/design/architecture) for the rendering pipeline.
