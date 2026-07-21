<!--meta
{
  "title": "Requirements",
  "description": "A small requirement hierarchy - business, system and functional requirements - traced to verification and documentation.",
  "assumes": ["Guides/getting-started"],
  "next": ["Guides/Verification"]
}
-->

# Requirements

This page is a live demonstration of **requirements traceability**. Every block
below is a fenced `requirement` block (valid CommonMark), which the app turns
into a card with clickable trace chips. Requirement ids are globally unique and
resolve across every document in the library.

Open the **Requirements** view from the header (the ▦ button) to see the
traceability matrix and coverage dashboard built from these same blocks.

## Business requirement

The top of the hierarchy: a single business need with no parents.

```requirement
{
  "id": "BR-001",
  "title": "Account holders can recover access to a locked account",
  "type": "business",
  "status": "approved",
  "parents": [],
  "tags": ["account", "recovery"]
}
```

## System requirements

Each derives from the business requirement (its `parents`). Children are computed
automatically, so BR-001 above shows these as its children.

```requirement
{
  "id": "SR-001",
  "title": "The system provides a self-service password reset flow",
  "type": "system",
  "status": "approved",
  "parents": ["BR-001"],
  "satisfiedBy": ["FR-001"],
  "tags": ["auth"]
}
```

```requirement
{
  "id": "SR-002",
  "title": "The system notifies users of security-relevant account changes",
  "type": "system",
  "status": "proposed",
  "parents": ["BR-001"],
  "verifiedBy": ["TC-002"],
  "tags": ["security", "notifications"]
}
```

## Functional requirements

The leaves of the hierarchy. Note that `satisfiedBy` on FR-001 points at BOTH an
existing document id (`Guides/security-and-html`) AND another requirement
(`FR-002`) - so requirements trace directly into the documentation. Its
`verifiedBy` points at TC-101, a test requirement defined in a *different*
document (see the Verification page), proving cross-document tracing.

```requirement
{
  "id": "FR-001",
  "title": "Users can request a password-reset email",
  "type": "functional",
  "status": "approved",
  "parents": ["SR-001"],
  "satisfiedBy": ["Guides/security-and-html", "FR-002"],
  "verifiedBy": ["TC-101"],
  "tags": ["auth"]
}
```

```requirement
{
  "id": "FR-002",
  "title": "Password-reset tokens expire after 30 minutes",
  "type": "functional",
  "status": "draft",
  "parents": ["SR-001"],
  "verifiedBy": ["TC-101"],
  "tags": ["auth", "security"]
}
```

```requirement
{
  "id": "FR-003",
  "title": "Users are emailed whenever their password changes",
  "type": "functional",
  "status": "proposed",
  "parents": ["SR-002"],
  "verifiedBy": ["TC-404"],
  "tags": ["security", "notifications"]
}
```

FR-003 above is verified by `TC-404`, which does not exist anywhere in the
library - a deliberately **dangling reference**. It renders as a non-clickable
`⚠ TC-404` chip and is counted in the coverage dashboard.

```requirement
{
  "id": "FR-004",
  "title": "Password-reset links are single-use",
  "type": "functional",
  "status": "draft",
  "parents": ["SR-001"],
  "relatedTo": ["FR-002"],
  "tags": ["security"]
}
```

FR-004 is a leaf with **no verification** - it shows up as a coverage gap in the
matrix (highlighted) and in the dashboard's "unverified leaves" count.
