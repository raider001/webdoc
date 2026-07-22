<!--meta
{ "title": "The CommonMark Engine", "description": "A hand-written, two-phase CommonMark 0.31.2 + GFM parser at 99.5% spec conformance.", "assumes": ["Docs/design/architecture"], "next": [] }
-->

# The CommonMark Engine

At the centre of WebDocs is a Markdown parser written entirely from scratch in
vanilla JavaScript — no library, no dependency, no shortcuts. It implements
[CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/) plus the common
GitHub-flavored extensions, and it passes **649 of the 652** examples in the
official specification suite: **99.5%** conformance.

CommonMark is deceptively hard. Emphasis, links, and HTML blocks each carry
edge cases that a naive regular-expression pass gets wrong. The engine follows
the specification's own recommended architecture: two distinct phases with a
clean handoff between them.

## Two-phase design

Parsing runs in two passes over the document, in the order the specification
prescribes.

- **Block-structure phase.** The source is consumed line by line to build the
  tree of block containers — documents, block quotes, lists and list items — and
  the leaf blocks they hold: headings, paragraphs, fenced and indented code,
  thematic breaks, and HTML blocks. Container blocks can stay *open* across many
  lines; each new line is matched against the currently open containers before
  deciding whether it continues them, closes them, or starts something new. The
  raw inline text of each leaf is accumulated but **not** interpreted yet.
- **Inline phase.** Once the block tree is final, the accumulated text of every
  leaf block is parsed for inline constructs: emphasis and strong emphasis, code
  spans, links and images, autolinks, raw inline HTML, and hard line breaks. Only
  now do link reference definitions collected during the block phase get
  resolved.

Separating the phases is what makes the tricky cases tractable. The block phase
never has to worry about `*` versus `**`; the inline phase never has to worry
about whether a line continues a list item.

## The array-of-pieces inline model

The inline phase is the subtle one, because emphasis is context-sensitive: a run
of `*` or `_` can open emphasis, close it, or be literal text, and which one it
is depends on what surrounds it. Rather than mutate a string, the engine breaks
each leaf's text into an **array of pieces** — literal text runs interleaved
with candidate delimiter runs — and resolves emphasis by scanning that array.

When a delimiter run is matched to a partner, the engine does not splice HTML
into the middle of the array. Instead it emits paired **`wrapOpen` / `wrapClose`
markers** around the enclosed pieces. A `*text*` pair becomes a `wrapOpen(em)` …
`wrapClose(em)` bracket; `**text**` becomes `wrapOpen(strong)` … The array is
serialized to HTML in a single final pass, turning each marker into its tag. This
keeps nesting correct — `***both***`, `*a **b** c*`, and the classic
left/right-flanking rules all fall out of matching markers rather than juggling
substrings.

Consider this Markdown:

```text
The `render()` call takes **bold _nested_ emphasis** and a
[link](Docs/design/architecture).
```

The inline phase splits it into pieces (`The `, a code-span piece, ` call takes `,
a `**` delimiter run, and so on), matches the `**` and `_` delimiter runs to
their partners, and emits `wrapOpen`/`wrapClose` markers around the enclosed
runs. Serialized, that yields a code span, a nested `<strong>`/`<em>`, and a
resolved internal link — the same construct you are reading now.

## GFM extensions

On top of strict CommonMark, the engine adds the GitHub-flavored features
authors expect:

- **Tables** — pipe-delimited with an alignment row.
- **Task lists** — `- [x]` and `- [ ]` list items rendered as checkboxes.
- **Strikethrough** — `~~deleted~~`.
- **Autolinks** — bare URLs turned into links without explicit `<…>` brackets.

These slot into the pipeline at different points. Tables are **not** recognised
during line-by-line block parsing; instead a distinct post-parse pass
(`extractTables`) runs after the block-structure loop completes and before the
inline phase, scanning the already-parsed paragraph blocks and rewriting any
whose first two lines form a header row plus an alignment/delimiter row into a
table. Strikethrough and extended autolinks, by contrast, are resolved as
additional delimiter and scanning rules in the inline phase.

## Rendering a sample

Fenced code blocks are a leaf block: the block phase captures their content
verbatim and records the info string (the language), and the content is **not**
inline-parsed — so the `*`, `_`, and `<` inside stay literal. The decorate stage
later hands the captured text to the matching syntax highlighter. Given this
input:

```java
public final class Greeter {
    public static void main(String[] args) {
        // asterisks and angle-brackets stay literal inside a code fence
        String name = args.length > 0 ? args[0] : "world";
        System.out.println("Hello, " + name + "!");
    }
}
```

the engine preserves every character exactly and tags the block as Java, so the
highlighter can tokenize it — none of the `*`/`<`/`>` are treated as Markdown.

## The sanitizer is a separate layer

The parser's job ends at producing an HTML string. It is **not** the security
boundary. A distinct sanitizer pass walks the parsed DOM against an allowlist and
removes anything that could style or script the page — inline styles, `style`
attributes, `script` elements, event-handler attributes, and
`javascript:`/`data:` URLs. It also strips every `class` attribute, with a single
exception: one `language-*` token is preserved (lowercased) on `<code>`/`<pre>`
as the hint the syntax highlighter relies on. Keeping sanitization independent of
the parser means
a parser bug can never become an injection bug: even malformed or adversarial
Markdown is scrubbed after parsing, before it is numbered, decorated, or
injected. The exact rules are specified in
[the sanitizer requirements](Docs/requirements/functional/sanitizer).

## Conformance

The engine is validated against the official CommonMark 0.31.2 example suite and
passes 649 of 652 examples. The remaining three are obscure corner cases with no
practical effect on authored documentation. At 99.5% the engine is, for every
realistic document, a faithful CommonMark implementation — with GFM on top and no
third-party code beneath.
