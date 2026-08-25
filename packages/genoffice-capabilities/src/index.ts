/** A document type currently hosted by the unified GenOffice shell. */
export type DocumentKind = 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  'docs',
  'sheets',
  'slides',
  'pdf',
  'markdown',
]

/** Opaque ID issued by the shell for the lifetime of one open document tab. */
export type DocumentId = string

/** Minimal JSON Schema shape understood by MCP clients and the GenOffice gateway. */
export type JsonSchema = Readonly<Record<string, unknown>>

/** External side-effect class used by the MCP permission gateway. */
export type ToolRisk = 'read' | 'write' | 'file' | 'destructive'

/** Public target metadata; file path is omitted when it was not authorized for disclosure. */
export interface DocumentSummary {
  documentId: DocumentId
  kind: DocumentKind
  title: string
  path?: string
  revision: number
  dirty: boolean
  active: boolean
}

/** Reference passed to document-specific capability executors. */
export interface DocumentTarget extends DocumentSummary {
  /** The shell-owned WebContents identity; never expose this outside the app bridge. */
  webContentsId: number
}

/** Standardized failure codes shared between the MCP adapter and application gateway. */
export const CAPABILITY_ERROR_CODES = [
  'not_running',
  'unauthorized',
  'not_found',
  'conflict',
  'permission_denied',
  'renderer_unavailable',
  'validation_error',
  'cancelled',
  'internal_error',
] as const

export type CapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[number]

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: CapabilityErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'CapabilityError'
    this.code = code
    this.details = details
  }
}

/** Text-only output is intentional for the initial MCP surface; binary previews use resource handles later. */
export interface ToolResult {
  content: string
  /** Present when the tool observed or produced a document revision. */
  revision?: number
  /** True only after the document's state changed successfully. */
  mutated: boolean
}

export interface ExecutionContext {
  clientId: string
  requestId: string
  signal: AbortSignal
}

export interface CapabilityTool<Input = unknown> {
  /** Stable, MCP-facing tool name (for example `slides.read_slide`). */
  name: string
  description: string
  inputSchema: JsonSchema
  risk: ToolRisk
  execute(target: DocumentTarget | null, input: Input, context: ExecutionContext): ToolResult | Promise<ToolResult>
}

export const isDocumentKind = (value: unknown): value is DocumentKind =>
  typeof value === 'string' && DOCUMENT_KINDS.includes(value as DocumentKind)

export function toolResult(content: string, mutated = false, revision?: number): ToolResult {
  return { content, mutated, ...(revision === undefined ? {} : { revision }) }
}
