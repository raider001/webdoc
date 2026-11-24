<!--meta
{ "title": "Switch Day and Night", "description": "Toggle the light and dark themes; the choice is remembered and applied to all content automatically.", "assumes": ["Docs/how-to/coverage"], "next": ["Docs/how-to/accounts"] }
-->

# Switch Day and Night

WebDocs ships a day theme and a night theme and applies your content correctly
to both automatically — you never write CSS, and there is nothing to set per
document. Switch with the theme button at the top right, titled "Day / night".
It shows a moon while you are in day mode — click it for night — and a sun while
you are in night mode — click it for day; the glyph is always what you switch
to. Your choice is remembered across reloads and sessions, and overrides the
operating system preference from then on. Because colours come entirely from
theme tokens, highlighted code and every surface read correctly in both themes.

![The reading view in night mode, with the theme button showing the sun.](/assets/how-to/theming-dark.png)

[Theming](Docs/design/theming) explains the token model.

## Where to go next

That is the tour. For the fine print behind these recipes, the reference
documents take over: [the authoring reference](Docs/reference/authoring) for the
full rules of writing a document, and [the configuration reference](Docs/reference/config)
for standing up and tuning the set.
