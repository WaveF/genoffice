# Security Policy

## Reporting a Vulnerability

Please report suspected vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/genspark-ai/genoffice/security/advisories/new)
on this repository. Do not open public issues for security reports. We aim to
acknowledge reports within 72 hours.

## Process Security Posture

All application windows run with the full Electron renderer lockdown:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for every
  document window and tab view (docs, sheets, slides, pdf, markdown, shell, updater).
- Renderers reach the main process only through typed, validated IPC channels
  (payloads are schema-checked in the main process; sheets uses zod end to end).
- Every `shell.openExternal` call goes through a single shared gate
  (`@genoffice/electron-utils` → `safeExternalUrl`) that parses the URL and
  enforces a protocol allowlist (http/https; pdf link annotations additionally
  allow mailto). `file:`, `javascript:`, and custom schemes are always rejected.
- No API keys are hardcoded. AI requests are proxied through the signed-in
  account by default; user-supplied keys stay in the OS-level settings store.

## Threat Model: AI-Generated Layout Scripts (slides)

The slides AI can adjust slide layouts by emitting a small script that is
parsed with Acorn and evaluated by a constrained AST interpreter
(`apps/slides/src/renderer/ai/layout-script-interpreter.ts`). The source looks
like a small, synchronous subset of JavaScript for model compatibility, but it
is not passed to `eval`, `Function`, a VM context, a worker, or the JavaScript
engine as executable source.

**What the script can do by design:** read prototype-free JSON copies of
`els`/`canvas`, perform bounded arithmetic/control flow, use explicitly
implemented string/array/regular-expression/Math helpers, and call
`setBox/moveBy/resizeBy/setText/setStyle/setFill/setStroke/log`. Every edit
primitive validates its arguments (element existence, read-only flags, finite
numbers, hex colors) and writes only into an op buffer that is applied through
the same command pipeline as manual edits.

**Interpreter boundary:**

1. Identifiers resolve only in interpreter-owned lexical scopes seeded with the
   documented data and callables. There are no ambient globals, module loader,
   DOM, network, IPC bridge, timers, process APIs, or dynamic code primitives.
2. Property reads are dispatched by value type. Data objects expose own JSON
   fields only; arrays, strings, and regexes expose a small method allowlist.
   Host prototypes and function properties are never traversed, including
   through computed property names.
3. Calls accept only interpreter-created functions or explicit builtins. A host
   function obtained through a constructor/prototype chain cannot be
   represented.
4. Inputs and values crossing into edit primitives are recursively copied as
   JSON-like, prototype-free data. Errors discard all buffered operations;
   logs are capped.
5. Execution has statement/expression and call-depth limits to bound runaway
   loops or recursion.

The Electron renderer sandbox remains defense in depth, but it is not the
layout-script security boundary. The interpreter is designed so a layout
script cannot obtain renderer capabilities in the first place.

If you find a way for a layout script to reach anything beyond the injected
primitives (network, storage, IPC channels not reachable by design, or the
main process), that is a vulnerability — please report it.

## Threat Model: Rendering AI-Generated HTML (slides export)

The HTML-to-pptx export pipeline renders AI-generated HTML in a hidden
`BrowserWindow`. That window is treated as hostile content: full renderer
lockdown (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`),
no preload script, no IPC surface — the main process drives it exclusively
through `executeJavaScript` and destroys it under a watchdog timeout.

## Threat Model: External MCP control

The MCP integration exposes a narrow local capability surface to an external
AI client. It is not a general Electron IPC, filesystem, or renderer-control
channel.

- The Shell creates a fresh random token and a private Unix socket (or Windows
  named pipe) for every application session. Discovery files are user-only on
  POSIX and are removed on shutdown. The bridge has no HTTP listener.
- The bridge assigns its own connection identity. An MCP client cannot select
  another connection's identity to reuse a write permission grant.
- Tools address only opaque `documentId` values for documents already open in
  GenOffice. File paths, `WebContents` IDs, archive bytes, and arbitrary IPC
  channels are never MCP inputs or outputs.
- Main-process adapters validate capability schemas and apply bounded input
  limits. Slides accepts only registered canonical operations; archive bytes,
  source paths, scripts, and oversized/nested payloads are rejected.
- Writes require `expectedRevision`, are serialized per document, and return
  `conflict` when a document changed after it was read. The renderer's active
  selection is never an implicit write target.
- First write/file operations require an application-native confirmation for
  the current bridge connection. Destructive slide operations require a new
  confirmation every time. Save operations use only application-controlled
  paths.
- Audit logs contain only connection ID, tool name, document ID, outcome, and
  revision. They intentionally omit token values, generated content, tool
  arguments, API keys, and file paths.

Documents may contain untrusted instructions intended to influence an external
AI. GenOffice treats document text as data: it does not automatically grant
additional MCP permissions, open paths, invoke tools, or execute scripts based
on document content. External AI clients should similarly treat document text
as untrusted input.

Report any way to read unopened local files, bypass an MCP confirmation,
reuse another connection's grant, invoke an arbitrary IPC channel, or retain a
working bridge after GenOffice exits as a security vulnerability.

## Out of Scope

- The cloud AI services this client talks to are operated separately and are
  not part of this repository; issues with them should be reported through the
  service provider's channels.
- Vulnerabilities that require an already-compromised machine or a modified
  binary. This includes the deliberate environment-variable override points
  for local development (`GSK_CLI_PATH`, `XLSX_SIDECAR_PATH`): setting them
  requires control of the process environment, which is equivalent to code
  execution on the machine.
