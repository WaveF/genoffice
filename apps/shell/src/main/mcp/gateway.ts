import {
  CapabilityError,
  type CapabilityTool,
  type DocumentTarget,
  type ExecutionContext,
  type ToolResult,
  toolResult,
} from '@genoffice/capabilities'
import type { McpBridgeGateway, McpBridgeRequest } from './bridge'

/** Small interface keeps the gateway unit-testable without an Electron runtime. */
export interface DocumentTargetSource {
  listDocumentTargets(): Promise<DocumentTarget[]>
  findDocumentTarget(documentId: string): Promise<DocumentTarget | null>
}

interface ToolDescriptor {
  name: string
  description: string
  inputSchema: Readonly<Record<string, unknown>>
}

const LIST_OPEN_DOCUMENTS: CapabilityTool<Record<string, never>> = {
  name: 'list_open_documents',
  description: 'List documents currently open in this GenOffice application session.',
  inputSchema: { type: 'object', additionalProperties: false },
  risk: 'read',
  execute: async (_target, _input, context) => {
    throw new CapabilityError('internal_error', `Unbound tool called by ${context.clientId}`)
  },
}

const GET_DOCUMENT_STATUS: CapabilityTool<{ documentId: string }> = {
  name: 'get_document_status',
  description: 'Get the current status of one open GenOffice document.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['documentId'],
    properties: { documentId: { type: 'string', minLength: 1, maxLength: 128 } },
  },
  risk: 'read',
  execute: (target) => {
    if (!target) throw new CapabilityError('not_found', 'Document is no longer open')
    return toolResult(JSON.stringify(target), false, target.revision)
  },
}

const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [LIST_OPEN_DOCUMENTS, GET_DOCUMENT_STATUS].map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function executionContext(request: McpBridgeRequest): ExecutionContext {
  return { clientId: request.clientId, requestId: request.requestId, signal: request.signal }
}

/** Main-process router for the initial, capability-scoped MCP tool surface. */
export class ShellMcpGateway implements McpBridgeGateway {
  constructor(private readonly documents: DocumentTargetSource) {}

  async handle(request: McpBridgeRequest): Promise<unknown> {
    if (request.method === 'tools/list') return { tools: TOOL_DESCRIPTORS }
    return this.callTool(request)
  }

  private async callTool(request: McpBridgeRequest): Promise<ToolResult> {
    const name = request.params.name
    const argumentsValue = request.params.arguments ?? {}
    if (typeof name !== 'string') {
      throw new CapabilityError('validation_error', 'Tool name must be a string')
    }
    if (!isRecord(argumentsValue)) {
      throw new CapabilityError('validation_error', 'Tool arguments must be an object')
    }
    const context = executionContext(request)
    if (name === LIST_OPEN_DOCUMENTS.name) {
      this.assertEmptyArguments(argumentsValue)
      if (context.signal.aborted) throw new CapabilityError('cancelled', 'MCP request was cancelled')
      const documents = await this.documents.listDocumentTargets()
      return toolResult(JSON.stringify(documents))
    }
    if (name === GET_DOCUMENT_STATUS.name) {
      const documentId = argumentsValue.documentId
      if (
        typeof documentId !== 'string' ||
        documentId.length === 0 ||
        documentId.length > 128 ||
        Object.keys(argumentsValue).length !== 1
      ) {
        throw new CapabilityError('validation_error', 'documentId must be the only non-empty string argument')
      }
      if (context.signal.aborted) throw new CapabilityError('cancelled', 'MCP request was cancelled')
      const target = await this.documents.findDocumentTarget(documentId)
      return GET_DOCUMENT_STATUS.execute(target, { documentId }, context)
    }
    throw new CapabilityError('not_found', `Unknown MCP tool: ${name}`)
  }

  private assertEmptyArguments(argumentsValue: Record<string, unknown>): void {
    if (Object.keys(argumentsValue).length > 0) {
      throw new CapabilityError('validation_error', 'This tool does not accept arguments')
    }
  }
}
