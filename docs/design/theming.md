<!--meta
{ "title": "Theming", "description": "Day/night themes via CSS custom-property design tokens, resolved before first paint.", "assumes": ["Docs/design/architecture"], "next": [] }
-->

# Theming

WebDocs ships a day theme and a night theme. Both are expressed as a single set
of **design tokens** — CSS custom properties — whose values change with the
active theme. Every colour, border, and surface in the application reads from a
token, so switching themes is a matter of swapping one attribute on the root
element, and nothing in the component styles has to know which theme is live.

## Design tokens

The stylesheet defines a flat vocabulary of semantic tokens on `:root`. Component
rules never hard-code a colour; they reference a token. A theme is then just a
different set of values for the same names.

```css
:root {
  /* semantic surface + text tokens (day theme defaults) */
  --wd-bg:            #ffffff;
  --wd-surface:       #f5f6f8;
  --wd-text:          #1a1c1f;
  --wd-text-muted:    #5b6570;
  --wd-border:        #d9dde2;
  --wd-accent:        #2f6feb;
  --wd-code-bg:       #f0f2f5;
  --wd-link:          #1a5fd0;
}

:root[data-theme="night"] {
  /* the night theme redefines the same names */
  --wd-bg:            #14171c;
  --wd-surface:       #1c2027;
  --wd-text:          #e6e9ee;
  --wd-text-muted:    #9aa4b0;
  --wd-border:        #2a2f38;
  --wd-accent:        #5b8cff;
  --wd-code-bg:       #1a1e25;
  --wd-link:          #7ba7ff;
}

/* every component reads tokens, never raw colours */
.wd-content a { color: var(--wd-link); }
.wd-content code { background: var(--wd-code-bg); }
```

Because the tokens are semantic (`--wd-surface`, not `--gray-100`), the theming
layer and the component styles stay decoupled. Adding a theme means supplying one
more block of token values; it never means touching a single component rule.

## `[data-theme]` as the switch

The active theme is carried by a `data-theme` attribute on the document root.
Absence (or `data-theme="day"`) selects the day palette; `data-theme="night"`
selects the night palette via the `:root[data-theme="night"]` overrides above.
The theme toggle in the header does exactly one thing: it sets that attribute and
persists the choice. No stylesheet is swapped and no classes are toggled on
individual elements — the cascade does the rest.

## Resolving the theme before first paint

A theme applied after the page renders produces a visible flash — the wrong
colours for a frame, then a jarring correction. WebDocs avoids this by resolving
the theme in a tiny inline script in the document `<head>`, *before* the browser
paints anything. Running inline and synchronously, ahead of the body, means
`data-theme` is already correct on the very first paint.

```text
// inline in <head>, runs before first paint — no flash of the wrong theme
(function () {
  var saved = localStorage.getItem("wd-theme");          // remembered choice
  var prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = saved || (prefersDark ? "night" : "day");  // OS preference fallback
  document.documentElement.setAttribute("data-theme", theme);
})();
```

The precedence is deliberate:

- **A remembered choice wins.** If the reader has toggled the theme before, that
  value is read from `localStorage` and applied.
- **Otherwise, follow the operating system.** With no stored preference, the
  script honours the OS `prefers-color-scheme` setting, so a reader whose system
  is in dark mode gets the night theme on their first visit.

When the reader uses the header toggle, the new value is written back to
`localStorage`, so the choice sticks across reloads and future visits — and,
because it is stored rather than merely applied, it overrides the OS preference
from then on.

## Why tokens, not stylesheets

Two themes could have been two stylesheets, but tokens are strictly better here.
A single set of rules is loaded once; switching is one attribute write with no
network request and no reflow of which stylesheet applies. It also guarantees the
themes stay structurally identical — they can only differ in the values they
assign, never in which elements they style — which keeps day and night from
drifting apart as the application grows.
