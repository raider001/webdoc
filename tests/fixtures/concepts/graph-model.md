<!--meta
{
  "title": "The Graph Model",
  "description": "Fixture for deep-link cold loads and for sitting one folder deep in the lazy tree.",
  "assumes": ["Guides/getting-started"],
  "next": []
}
-->

# The Graph Model

A TEST FIXTURE. It lives one folder deep on purpose: the drawer test expands
`concepts` to prove the lazy tree fetches a collapsed folder's children on
demand, which a flat corpus could never exercise.

`test_deep_link_cold_load` opens this document by hash route on a cold load and
asserts both the `<h1>` text and the document title, so the `title` in the meta
header above and the `# ` heading below must stay in agreement.

## Why a second level exists

The tree builds one folder level at a time from `GET /api/index/tree?path=`.
Without a nested document, nothing would ever call that endpoint with a
non-empty path.
