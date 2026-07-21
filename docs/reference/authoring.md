<!--meta
{ "title": "Authoring Reference", "description": "How to write documents: metadata, headings, code fences, links and requirement tables.", "assumes": ["Docs/overview"], "next": ["Docs/reference/config"] }
-->

# Authoring Reference

A WebDocs document is a plain Markdown file. There is no build step and no
front-matter processor to install — you save a `.md` file inside a configured
source folder and it is discovered the next time the library loads. This page is
the practical reference for the five things every author touches: the metadata
header, headings and their automatic numbering, fenced code blocks, links, and
requirement-group tables.

Everything below is parsed and rendered in the browser by hand-written vanilla
JavaScript. Nothing here depends on a plugin, a theme package, or a CDN.

## Where files live and how ids work

Each document's **id** is its path beneath a source folder, prefixed with the
source name. The source named `Docs` is mounted from the `docs/` folder, so
`docs/reference/authoring.md` has the id `Docs/reference/authoring`. Drop the
`.md` extension; folders become path segments. Ids are the currency of the whole
system — links, `assumes`/`next` edges, deep-links and requirement traces all
address documents by id. See [Configuration](Docs/reference/config) for how a
source name maps to a folder.

## The metadata header

Every document begins with a metadata block: an HTML comment whose body is a
single JSON object. It is extracted and `JSON.parse`d **before** the Markdown is
parsed, so it never appears in the rendered page. Because it is an HTML comment,
the sanitizer would strip it anyway — extracting it first keeps the two concerns
separate.

```text
<!--meta
{
  "title": "Navigation",
  "description": "The document tree, contents, and deep-linkable headings.",
  "assumes": ["Docs/overview"],
  "next": ["Docs/features/search"]
}
-->
```

The recognised fields:

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `title` | string | The document's display name. Surfaced in the tree, the search index, the map node and the browser tab. |
| `description` | string | A one-line summary. Rendered as a lede beneath the H1 and shown in search results. |
| `assumes` | string[] | Prerequisite document ids. Drawn as **prerequisite** edges on the map. |
| `next` | string[] | Recommended-next document ids. Drawn as **recommended-next** edges on the map. |

`assumes` and `next` are arrays of document ids, and either may hold several
entries. A reference to an id that does not resolve to a real document is not an
error — it is flagged as a dangling link and shown as a placeholder node on the
map, which is a useful way to spot a document you have not written yet.

Keep the `title` in the header identical to the H1 that follows it; the H1 is the
human-visible heading while the metadata `title` feeds the navigation surfaces.

## The H1 and body

After the metadata comes exactly one `#` H1 whose text matches the `title`, then
the body. Use `##` and `###` for sections and subsections.

Do **not** write your own section numbers. WebDocs numbers every heading
hierarchically after parsing — the first `##` becomes `1`, its first `###`
becomes `1.1`, and so on down to `######`. Those same numbers are mirrored in the
on-this-page contents list, so a heading and its contents entry always agree. If
you type numbers by hand you will end up with two sets that drift apart. See
[Navigation](Docs/features/navigation) for how the contents list is built.

## Fenced code blocks

Use fenced code blocks with a language tag after the opening fence. The language
is emitted as a CommonMark-standard `class="language-xxx"` on the `<code>`
element and picked up by the syntax highlighter, which runs as a post-sanitize
DOM pass. The highlighters are hand-written per-language tokenizers — there is no
Prism or highlight.js in the bundle.

The languages with a dedicated highlighter are:

- `python`
- `robotframework`
- `makefile`
- `bash` (and other shell)
- `java`

Any other language tag (or none) renders as a clean, un-tokenized code block, so
you never lose content by tagging a language WebDocs does not yet colour. A
tagged block looks like this in source:

```text
```python
def greet(name):
    return f"hello, {name}"
```
```

For the full showcase of every supported language, see
[Syntax Highlighting](Docs/features/highlighting).

## Links

WebDocs distinguishes two kinds of link, and the distinction matters because it
changes what the map draws.

**Internal links** target another document by its id — no `.md`, no leading
slash:

```text
See [the configuration reference](Docs/reference/config) for source folders.
```

An in-body internal link that is not already expressed as an `assumes`, `next` or
requirement-trace relationship is drawn on the map as a **page-link** edge, so
casual cross-references between documents still show up in the graph.

**External links** use a full URL. On the map, an external target becomes a URL
box with a small "?" bubble that opens in a new tab rather than a document node:

```text
Conformance is measured against [the CommonMark spec](https://spec.commonmark.org/0.31.2/).
```

Standard Markdown link and autolink syntax both work, including bare-URL
autolinks such as `<https://example.org>`.

## Requirement-group tables

A requirement group is a Markdown table wrapped in a matched pair of metadata
comments. Like the document header, the pair is extracted from the raw Markdown
before parsing, then rendered back as a composed 4-column table. Author it as a
plain table with three columns — `requirement-no`, `description` and `trace-to`:

```text
<!--meta start {"requirement-group":"nav"}-->
| requirement-no | description | trace-to |
| -------------- | ----------- | -------- |
| 1 | Present the document set as a folder tree. | sys_3 |
| 2 | Show the current document's headings as a contents list. | sys_3 |
| 3 | Deep-link to any document and requirement. | sys_3 |
<!--meta end {"requirement-group":"nav"}-->
```

On render this becomes a table with the columns **Requirement | Description |
Trace To | Trace From**:

- **Requirement** is a composed id, `{component}_{group}_{no}`. The component
  comes from the source folder's configuration (`WD` for the `Docs` source), the
  group is the `requirement-group` name, and the number is `requirement-no`. Row
  1 above becomes `WD_nav_1`.
- **Description** is your text, verbatim.
- **Trace To** is what you authored in `trace-to`. It is a requirement
  reference, never free text and never a document id: use the shorthand `2`
  (same group), `group_2` (same component, another group), or a fully composed
  id across components. Multiple references are comma-separated; leave it blank
  for a top-level requirement. Each reference renders as a link to the document
  that defines the target requirement. An unresolved reference is flagged.
- **Trace From** is calculated for you — it is the inverse of every other
  requirement whose `trace-to` points at this one — so you never author it.

Because trace-to and trace-from resolve to documents, they also feed the map's
**requirement-trace** edges, giving you a cross-document view of how
requirements relate. For the concept and the map integration see
[Requirements Traceability](Docs/features/requirements); for the top-level
targets that functional requirements trace up to, see
[System Requirements](Docs/requirements/system).

## Checklist

Before saving a new document, confirm:

- It opens with a `<!--meta ... -->` header containing valid JSON.
- The header `title` matches the single `#` H1 beneath it.
- No heading contains a hand-typed number.
- Every code fence has a language tag.
- Internal links use bare document ids; external links use full URLs.
- Any requirement group is wrapped in a matched `meta start` / `meta end` pair.

With those in place the document is ready to be discovered. Next, see
[Configuration](Docs/reference/config) to register the source folder it lives in.
