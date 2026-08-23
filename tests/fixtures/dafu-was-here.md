<!--meta
{
  "title": "Dafu Was Here",
  "description": "Fixture with a deliberately dangling Recommended-next reference.",
  "assumes": [],
  "next": ["Guides/no-such-document"]
}
-->

# Dafu Was Here

A TEST FIXTURE. Its `next` entry points at `Guides/no-such-document`, which does
not exist and never will.

Under the lazy server-backed architecture the client cannot cheaply prove a
target is absent, so `buildFootGroup` links it anyway and a click lands on the
not-found view. That is the current, deliberate behaviour - see the comment in
`reader.js`. This document exists so that behaviour has a fixture, and so the
day someone reinstates a dangling-reference affordance there is already a
document to assert it against.
