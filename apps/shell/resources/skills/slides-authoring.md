---
id: slides-authoring
name: Slides authoring
description: Create and edit presentation content with explicit slide and revision references.
appliesTo: [slides]
---

# Slides authoring

Read the deck context before changing a presentation. Use slide IDs returned by NexOffice rather than inferring page positions from the active tab.

For placement work, call `slides.get_layout_context` before editing. It returns a stable 96-DPI logical-pixel canvas and CSS-style `{x,y,width,height}` bounds; do not infer geometry from OOXML EMU fields in `slides.read_slide`. Use `slides.apply_layout` for bounded position, size, and rotation changes to existing elements. For grouped children, retain the returned parent group ID and coordinate-space information.

Run `slides.audit_layout` after substantial text or layout changes. It is a deterministic renderer check for horizontal text overflow, not an AI judgement. Use `slides.render_preview` only for a single-page visual check when the MCP client can consume PNG output.

For multi-operation edits outside layout transforms, run `slides.apply_ops` with `dryRun: true` first, inspect the result, then submit the same operations with the current revision.
