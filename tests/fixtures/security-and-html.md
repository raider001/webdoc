<!--meta
{
  "title": "Security and Embedded HTML",
  "description": "Live XSS payloads for the sanitizer test. This document is deliberately hostile and must never be published.",
  "assumes": [],
  "next": []
}
-->

# Security and Embedded HTML

A TEST FIXTURE containing REAL, LIVE cross-site-scripting payloads. It exists so
`test_sanitizer_neutralizes_xss` has something genuine to defeat, and it is the
single reason the fixture corpus is a separate source rather than a repoint at
`docs/`: this page must never appear in WebDocs' own published documentation.

If any payload below actually executes, the test fails on three independent
signals at once - `window.__pwned` becomes set, a dialog opens, and a page error
is recorded. All three are asserted, so a partial sanitizer regression cannot
pass by silencing just one.

## Scripting must not survive

<script>window.__pwned = 'inline-script';</script>

<img src="x" onerror="window.__pwned = 'img-onerror'">

<svg onload="window.__pwned = 'svg-onload'"></svg>

<div onclick="window.__pwned = 'div-onclick'">An element carrying an inline handler.</div>

<iframe src="javascript:window.__pwned='iframe'"></iframe>

## Styling must not survive

<style>body { display: none; }</style>

<div style="color: red; position: fixed; inset: 0">An element carrying an inline style attribute.</div>

<p style="font-size: 3rem">A styled paragraph.</p>

## Dangerous URLs must not stay active

<a href="javascript:window.__pwned = 'anchor'">A javascript: link.</a>

<a href="JaVaScRiPt:alert(1)">A javascript: link with mixed casing.</a>

<a href="data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19wd25lZD0nZGF0YSc8L3NjcmlwdD4=">A data: URL link.</a>

## Structure must survive

The sanitizer strips scripting and styling, not markup. This is the control
case - if it disappeared, the sanitizer would be over-broad rather than unsafe:

<div>This plain div is kept</div>
