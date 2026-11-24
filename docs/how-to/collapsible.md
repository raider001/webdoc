<!--meta
{ "title": "Add a Collapsible Section", "description": "Create a disclosure from the visual editor or Markdown.", "assumes": ["Docs/how-to/authoring"], "next": ["Docs/features/collapsible", "Docs/how-to/live-widget"] }
-->

# Add a Collapsible Section

1. Open the document's editor and choose **+ Add widget → Collapsible section**.
2. Edit the title inline, or choose **⚙ Edit** to set **Title** and **Open by default**.
3. Use **+ Add block inside section** to add text, tables, requirements, tests or
   another widget. Use the inner arrows to reorder those blocks.
4. Optionally add `"id":"card-queue"` under **Advanced → Raw widget options** to retain
   the reader's disclosure state if you move the block.
5. Save. Focus its title with Tab and press Enter or Space to test it.

In a text editor, write the same section as:

```text
<!--meta start {"widget":"collapse","title":"Card queue","open":false,"id":"card-queue"}-->
**Your content**, including ordinary Markdown tables and links.
<!--meta end {"widget":"collapse"}-->
```

See [Collapsible Sections](Docs/features/collapsible) for persistence, nesting
and printing behaviour.
