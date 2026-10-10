<!--meta
{ "title": "Refresh a Section in Place", "description": "Add a session-aware live queue to a dashboard without refreshing the page.", "assumes": ["Docs/how-to/collapsible"], "next": ["Docs/features/live-widget"] }
-->

# Refresh a Section in Place

1. Identify the source's document id, such as `LM/live/queue`. Open it as the
   intended reader and confirm the heading's exact text, such as **Running**.
2. In the dashboard editor, choose **+ Add widget → Auto-update section**.
3. Choose **⚙ Edit**. Browse **Source document**, pick **Section** from its
   headings, and set **Refresh interval** in seconds. Choose **Whole document**
   to include the entire body.
4. Add fallback text inside the settings panel, check the live preview, then save.
5. Press **Refresh** to check the first update. Later updates replace only this
   body and show **updated HH:MM**. Hide the tab to pause polling.

The equivalent Markdown is:

```text
<!--meta start {"widget":"live","src":"LM/live/queue","section":"Running","interval":60}-->
Waiting for the queue.
<!--meta end {"widget":"live"}-->
```

To make a collapsible live queue, add **Auto-update section** inside a
**Collapsible section**. Each section can have its own source and interval.
Ensure selected section boundaries do not split paired wrappers, and avoid
including a dashboard into itself.

Access rules still apply to the source. A reader who cannot open it cannot use
the widget to reveal it. See [Auto-Update Sections](Docs/features/live-widget)
for error handling, local headings and lifecycle limits.
