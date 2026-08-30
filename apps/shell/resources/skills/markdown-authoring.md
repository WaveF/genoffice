---
id: markdown-authoring
name: Markdown authoring
description: Write structured Markdown documents through the NexOffice MCP surface.
appliesTo: [markdown]
---

# Markdown authoring

For a complete structured Markdown document, use `markdown.set_source` with the full `source` text. It parses headings, lists, quotes, tables, and task lists.

Use `markdown.insert_content` only for literal text insertion; Markdown markers in that tool are not interpreted as structure. For images, use the session `mediaImportDirectory`, then `media.stage_image`, then `markdown.insert_image` with the opaque media handle.
