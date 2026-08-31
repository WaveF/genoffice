---
id: safe-document-editing
name: Safe document editing
description: Core rules for working with documents through NexOffice MCP.
appliesTo: [docs, sheets, slides, markdown, pdf]
---

# Safe document editing

Use `list_open_documents` to identify a document from the user's title or context. Do not ask the user for, display, or guess a `documentId`.

Before a write, read the relevant context and send the returned `expectedRevision`. If a write reports a conflict, read the document again and retry only after re-evaluating the requested change.

Use only public MCP tools. Never ask NexOffice to read arbitrary local paths, URLs, tokens, or file contents outside the documented media staging flow.
