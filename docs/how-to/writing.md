<!--meta
{ "title": "Write Your Content", "description": "The Markdown and GFM WebDocs supports, fenced-code highlighting, and what embedded HTML is allowed.", "assumes": ["Docs/how-to/authoring"], "next": ["Docs/how-to/diagrams"] }
-->

# Write Your Content

Whatever you type in a text block is Markdown underneath, and you can also
hand-author `.md` files directly. WebDocs runs a from-scratch CommonMark 0.31.2
engine — no third-party Markdown library — plus a handful of GitHub-flavored
extensions.

## Use Markdown and GFM

You have the full CommonMark grammar: headings, paragraphs, lists, block quotes,
fenced and indented code, thematic breaks, links, images, and emphasis. On top
of that WebDocs adds four GFM extensions:

- Tables — pipe tables with per-column alignment (`:---` left, `:---:` centre,
  `---:` right).
- Task lists — `- [x]` and `- [ ]` render as real but read-only checkboxes.
- Strikethrough — `~~text~~`.
- Autolinks — a bare URL in running text, `https://example.com` or
  `www.example.com`, becomes a link (no angle brackets needed).

One rule matters more than the rest: never number a heading by hand. WebDocs
numbers headings hierarchically at render time and mirrors those numbers into
the contents pane — type your own and you end up with two sets that drift apart.
See [Markdown & GFM](Docs/features/markdown) for the full grammar.

## Tag a code block for highlighting

WebDocs highlights fenced code itself — no highlight.js, no Prism, no network
call. Tag the opening fence with the language name:

````text
```python
def hello():
    return "hi"
```
````

Five languages have a dedicated, purpose-built highlighter, each with its own
fence tags:

- Python — `python`, `py`
- Robot Framework — `robotframework`, `robot`
- Makefile — `makefile`, `make`, `mk`
- Shell — `shell`, `sh`, `bash`, `console`, `zsh`
- Java — `java`

Any other tag still gets light, generic colouring for comments, strings, and
numbers, so you lose nothing by tagging a language WebDocs does not know by
name. A fence with no tag at all is left as plain monospaced code. The practical
rule is simple: always tag your fence.
[Syntax Highlighting](Docs/features/highlighting) lists the details.

## Embed HTML for structure Markdown lacks

Raw HTML is allowed in a document, but a sanitizer runs after parsing and before
anything reaches the page, and its policy is strict: embedded HTML is allowed,
but all styling and scripting is rejected. Use it for semantic structure
Markdown does not offer — `<details>`/`<summary>` for collapsible sections,
`<sub>`/`<sup>`, `<mark>`, `<ins>`, `<figure>`/`<figcaption>`, and tables with
`colspan`/`rowspan` — never for appearance. There is no `style` attribute, no
`id`, and no arbitrary `class`; scripts, iframes, forms, media, and even raw
`<svg>` are removed outright. The one class that survives is a `language-*` hint
on `<code>` or `<pre>`, which is what lets the highlighter find the grammar.
Links keep only `href` and `title`, and only safe URL schemes survive.
