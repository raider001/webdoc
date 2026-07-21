<!--meta
{
  "title": "The Graph Model",
  "description": "How assumed-knowledge and recommended-next metadata become a navigable map.",
  "assumes": ["Guides/getting-started"],
  "next": ["Guides/concepts/metadata-tags"]
}
-->

# The Graph Model

Every document declares two kinds of relationship in its metadata:

- **Assumed knowledge** — documents you should read *first*. These become
  prerequisite edges.
- **Recommended next** — documents to read *after* this one. These become
  suggested-reading edges.

Together, across the whole library, these edges form a directed graph.

## Prerequisites

Prerequisite edges point from a prerequisite to the document that needs it, so
the map reads in learning order — top to bottom.

## Recommended reading

Recommended-next edges are drawn dashed and in a warmer colour, so a quick
glance separates "must know first" from "good to read after".

## Handling messy data

If a document references another that does not exist, the map shows a clearly
marked placeholder instead of failing — so the graph doubles as a link checker.
