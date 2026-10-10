<!--meta
{ "title": "Collapsible Sections", "description": "Accessible sections that remember their disclosure state and contain ordinary Markdown.", "assumes": ["Docs/reference/authoring"], "next": ["Docs/how-to/collapsible", "Docs/features/widget-api"] }
-->

# Collapsible Sections

A collapsible widget groups a section under a title. Its body uses the normal
Markdown pipeline, including tables, links, diagrams, requirement groups, test
cases and nested widgets.

```text
<!--meta start {"widget":"collapse","title":"Card queue","open":false,"id":"card-queue"}-->
## Queue details

| Card | State |
| --- | --- |
| A | Running |
<!--meta end {"widget":"collapse"}-->
```

Both markers occupy their own lines. Their JSON must be an object and the end
marker must name the same widget. Multiline JSON is accepted. Markers in fenced
code, indented code and inline examples remain examples.

## Reading and printing

The title is a native disclosure control: focus it with Tab and use Enter or
Space to open or close the section. Heading and requirement jumps open enclosing
disclosures before moving focus or scrolling.

`open` chooses the initial state; it defaults to `false`. A browser remembers
each disclosure in localStorage by page id and widget position. Add a unique
`id` to preserve its identity when you move the block. Another page has its own
state. If storage is unavailable, the control still works with its default.

Printing temporarily expands every collapsible section and restores the
reading state afterwards. Print expansion does not overwrite the saved choice.

## Editing

In the editor, choose **Collapsible section** from the toolbar's **+ Add block**
menu or a block's insert menu. Edit **Title** and **Open by default**, then use
**+ Add block inside section** to author its body with the usual visual blocks.
Blocks can be moved and deleted inside the section. Saving produces the paired
metadata syntax above. Additional JSON options, including `id`, survive editing.

Malformed widget wrappers appear as a notice in the reader. The editor preserves
their original source and asks you to repair the markers in the file.

## Example

<!--meta start {"widget":"collapse","title":"A small card queue","open":false,"id":"example-queue"}-->
| Card | State |
| --- | --- |
| A | Running |
| B | Waiting |

See [auto-update sections](Docs/features/live-widget) to refresh a queue in place.
<!--meta end {"widget":"collapse"}-->

The built-in `collapse` type is registered through the same
[widget API](Docs/features/widget-api) available to extensions.
