# Security Policy

## Reporting a Vulnerability

Please report suspected vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/WaveF/genoffice/security/advisories/new)
on this repository. Do not open public issues for security reports. We aim to
acknowledge reports within 72 hours.

## Process Security Posture

All application windows run with the full Electron renderer lockdown:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for every
  document window and tab view (docs, sheets, slides, pdf, markdown, shell, updater).
- Renderers reach the main process only through typed, validated IPC channels
  (payloads are schema-checked in the main process; sheets uses zod end to end).
- Every `shell.openExternal` call goes through a single shared gate
  (`@nexoffice/electron-utils` → `safeExternalUrl`) that parses the URL and
  enforces a protocol allowlist (http/https; pdf link annotations additionally
  allow mailto). `file:`, `javascript:`, and custom schemes are always rejected.

## Threat Model: External MCP control

The MCP integration exposes a narrow local capability surface to an external
AI client. It is not a general Electron IPC, filesystem, or renderer-control
channel.

- The Shell creates a fresh random token and a private Unix socket (or Windows
  named pipe) for every application session. Discovery files are user-only on
  POSIX and are removed on shutdown. The bridge has no HTTP listener.
- The bridge assigns its own connection identity for auditability. An MCP
  client-controlled display name is never treated as an authorization identity.
- Tools address only opaque `documentId` values for documents already open in
  NexOffice. File paths, `WebContents` IDs, archive bytes, and arbitrary IPC
  channels are never MCP inputs or outputs.
- Main-process adapters validate capability schemas and apply bounded input
  limits. Slides accepts only registered canonical operations; archive bytes,
  source paths, scripts, and oversized/nested payloads are rejected.
- Writes require `expectedRevision`, are serialized per document, and return
  `conflict` when a document changed after it was read. The renderer's active
  selection is never an implicit write target.
- The fresh bridge token is the sole MCP authorization credential. Once the
  bridge has authenticated a request, NexOffice does not display a per-write
  or per-document confirmation dialog; risk metadata continues to select
  validation, queueing, audit, and destructive-operation constraints. Save
  operations use only application-controlled paths.
- Audit logs contain only connection ID, tool name, document ID, outcome, and
  revision. They intentionally omit token values, generated content, tool
  arguments, API keys, and file paths.

Documents may contain untrusted instructions intended to influence an external
AI. NexOffice treats document text as data: it does not automatically grant
additional MCP permissions, open paths, invoke tools, or execute scripts based
on document content. External AI clients should similarly treat document text
as untrusted input.

Report any way to read unopened local files, bypass the MCP token boundary,
impersonate an audit identity, invoke an arbitrary IPC channel, or retain a
working bridge after NexOffice exits as a security vulnerability.

## Out of Scope

- External AI clients, models, and their remote services are outside this
  repository's trust boundary. NexOffice does not embed their credentials or
  invoke them; they must treat document content as untrusted data.
- Vulnerabilities that require an already-compromised machine or a modified
  binary. This includes the deliberate environment-variable override points
  for local development (`GSK_CLI_PATH`, `XLSX_SIDECAR_PATH`): setting them
  requires control of the process environment, which is equivalent to code
  execution on the machine.
