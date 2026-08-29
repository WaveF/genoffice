---
id: slides-authoring
name: Slides authoring
description: Create and edit presentation content with explicit slide and revision references.
appliesTo: [slides]
---

# Slides authoring

Read the deck context before changing a presentation. Use slide IDs returned by GenOffice rather than inferring page positions from the active tab.

For multi-operation edits, run `slides.apply_ops` with `dryRun: true` first, inspect the result, then submit the same operations with the current revision. Use `slides.render_preview` only for a single-page visual check.
