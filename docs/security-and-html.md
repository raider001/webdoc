<!--meta
{
  "title": "Security & Embedded HTML",
  "description": "Demonstrates that raw HTML is allowed but all styling and scripting is rejected.",
  "assumes": [],
  "next": []
}
-->

# Security & Embedded HTML

Documents may contain raw HTML, but the sanitizer strips all styling and
scripting before anything reaches the page. Everything below is deliberately
hostile; none of it should style the page, run code, or pop a dialog.

## Structural HTML is kept

<div>This plain div is kept — structure is allowed.</div>

## Styling is removed

<div style="color:red;background:yellow" class="flashy">This text must NOT be red or highlighted — the style and class are stripped.</div>

## Scripting is removed

<script>window.__pwned = true;</script>

<img src="x" onerror="window.__pwned = true">

<a href="javascript:window.__pwned=true">this link must be neutralised</a>

## The result

If the sanitizer is working, the page above looks plain, `window.__pwned` is
never set, and no dialog appears.
