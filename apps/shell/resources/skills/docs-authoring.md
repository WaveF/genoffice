---
id: docs-authoring
name: Docs native rich formatting
description: Create and edit formatted GenOffice Docs content through native structured MCP operations.
appliesTo: [docs]
---

# Docs native rich formatting

Use this skill for `.docx`-style Docs documents. Docs is not a Markdown source editor.

1. Resolve the target yourself with `list_open_documents` or `create_document({"kind":"docs"})`; never ask the user for an opaque `documentId`.
2. Before changing an existing document, call `docs.get_context` or `docs.read_blocks`. Keep the returned `expectedRevision` and use the returned opaque `blockId` only with that revision.
3. Use `docs.apply_operations` to create formatted content. Its `insert_blocks` operation accepts native `heading`, `paragraph`, `bullet_list`, and `ordered_list` blocks with text `runs`. A run's `style` can use bold, italic, underline, strike, color, highlight, font, and fontSizePt.
4. Use `format_text` for a non-empty character range inside one returned block, and `set_block` for heading/list/paragraph and paragraph alignment or indentation. An `insert_blocks` operation may have an `id`; later operations in the same batch can target its new blocks with `{ "resultId": "...", "blockIndex": 0 }`.
5. Run `dryRun: true` first for nontrivial operation batches, then repeat the exact batch without `dryRun` after validation. All non-dry-run writes require `expectedRevision`; on `conflict`, read again before retrying.
6. `docs.insert_content` and `docs.replace_blocks` deliberately insert literal text. Do not send Markdown such as `# Heading` or `**bold**` to them expecting formatting.
7. Do not pass HTML, Markdown source, file paths, URLs, or image bytes to Docs formatting tools. Links, tables, images, comments, revisions, sections, and headers/footers are outside the first Docs rich-format MCP surface.

Example operation shape:

```json
{
  "documentId": "<resolved internally>",
  "expectedRevision": 4,
  "operations": [
    {
      "op": "insert_blocks",
      "id": "report",
      "blocks": [
        {
          "type": "heading",
          "headingLevel": 1,
          "runs": [{ "text": "Quarterly report", "style": { "bold": true, "color": "1F4E79" } }]
        },
        {
          "type": "paragraph",
          "runs": [
            { "text": "Revenue increased by " },
            { "text": "12%", "style": { "bold": true, "highlight": "yellow" } }
          ]
        }
      ]
    }
  ]
}
```
