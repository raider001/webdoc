<!--meta
{
  "title": "Metadata Tags",
  "description": "Fixture with two Assumed-knowledge links, for the footer and tree-navigation tests.",
  "assumes": [
    "Guides/getting-started",
    "Guides/concepts/graph-model"
  ],
  "next": []
}
-->

# Metadata Tags

A TEST FIXTURE. It declares exactly two `assumes` entries, which is what
`test_footer_shows_multiple_assumes` counts and whose hrefs it checks.

`test_tree_item_navigates` also clicks through to this document from the drawer,
asserting the link text, the resulting hash route, the `<h1>` and the document
title. The `title` above is therefore the tree's link text as well.

## Keeping the two in step

Both tests read the same metadata from the header above, so a change to either
`assumes` entry breaks the footer test, and a change to `title` breaks the
navigation test.
