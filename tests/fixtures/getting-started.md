<!--meta
{
  "title": "Getting Started",
  "description": "The default fixture document: stable heading structure and two Recommended-next links.",
  "assumes": [],
  "next": [
    "Guides/concepts/graph-model",
    "Guides/markdown-kitchen-sink"
  ]
}
-->

# Getting Started

This is a TEST FIXTURE, not product documentation. It exists so the end-to-end
suite has a corpus it owns and may freely change. Nothing here is published as
part of WebDocs' own documentation set.

Its heading structure is load-bearing: `test_heading_numbers_match_toc` asserts
the numbering sequence `1, 1.1, 1.1.1, 1.1.2, 1.1.3, 1.2` and a six-entry table
of contents. Do not add, remove or re-nest a heading in this file without
updating that test.

## First Section

The first second-level heading, numbered 1.1.

### Nested One

Numbered 1.1.1.

### Nested Two

Numbered 1.1.2.

### Nested Three

Numbered 1.1.3.

## Second Section

The second second-level heading, numbered 1.2. The document ends here so the
heading count stays at six.
