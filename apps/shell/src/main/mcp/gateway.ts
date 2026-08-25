import {
  CapabilityError,
  type CapabilityTool,
  type DocumentTarget,
  type ExecutionContext,
  type ToolRisk,
  type ToolResult,
  toolResult,
} from '@genoffice/capabilities'
import type { McpBridgeGateway, McpBridgeRequest } from './bridge'
import type { McpPermissionGate } from './permissions'
import { DocumentWriteQueue } from './write-queue'

/** Small interface keeps the gateway unit-testable without an Electron runtime. */
export interface DocumentTargetSource {
  listDocumentTargets(): Promise<DocumentTarget[]>
  findDocumentTarget(documentId: string): Promise<DocumentTarget | null>
  activateDocument(documentId: string): Promise<DocumentTarget | null>
}

/** Read-only portion of the Slides facade, injected to avoid an Electron dependency in gateway tests. */
export interface SlidesMcpReader {
  getDeckContext(webContentsId: number): unknown
  readSlide(webContentsId: number, slideRef: number | string): unknown
}

export interface SlidesMcpWriter extends SlidesMcpReader {
  opsRisk(rawOps: unknown): ToolRisk
  applyOps(
    webContentsId: number,
    rawOps: unknown,
    expectedRevision: number,
    dryRun?: boolean,
  ):
    | { applied: boolean; revision: number; [key: string]: unknown }
    | Promise<{ applied: boolean; revision: number; [key: string]: unknown }>
  undo(webContentsId: number, expectedRevision: number): { applied: boolean; revision: number }
  redo(webContentsId: number, expectedRevision: number): { applied: boolean; revision: number }
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

const DOCUMENT_REVISION_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documentId', 'expectedRevision'],
  properties: {
    documentId: { type: 'string', minLength: 1, maxLength: 128 },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
}

const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  LIST_OPEN_DOCUMENTS,
  GET_DOCUMENT_STATUS,
  {
    name: 'slides.get_deck_context',
    description: 'Read the slide IDs and element counts for one open Slides document.',
    inputSchema: GET_DOCUMENT_STATUS.inputSchema,
  },
  {
    name: 'activate_document',
    description: 'Bring one explicitly identified open GenOffice document to the foreground.',
    inputSchema: DOCUMENT_REVISION_INPUT_SCHEMA,
  },
  {
    name: 'slides.read_slide',
    description: 'Read the editable element model for one slide in an open Slides document.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId', 'slide'],
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 128 },
        slide: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string', minLength: 1 }] },
      },
    },
  },
  {
    name: 'slides.apply_ops',
    description: 'Validate or atomically apply canonical edits to an open Slides document.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentId', 'expectedRevision', 'ops'],
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 128 },
        expectedRevision: { type: 'integer', minimum: 0 },
        ops: { type: 'array', minItems: 1, maxItems: 50 },
        dryRun: { type: 'boolean' },
      },
    },
  },
  {
    name: 'undo',
    description: 'Undo the latest supported MCP or manual edit in an open Slides document.',
    inputSchema: DOCUMENT_REVISION_INPUT_SCHEMA,
  },
  {
    name: 'redo',
    description: 'Redo the latest supported MCP or manual edit in an open Slides document.',
    inputSchema: DOCUMENT_REVISION_INPUT_SCHEMA,
  },
].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function executionContext(request: McpBridgeRequest): ExecutionContext {
  return { clientId: request.clientId, requestId: request.requestId, signal: request.signal }
}

/** Main-process router for the initial, capability-scoped MCP tool surface. */
export class ShellMcpGateway implements McpBridgeGateway {
  private readonly writeQueue = new DocumentWriteQueue()

  constructor(
    private readonly documents: DocumentTargetSource,
    private readonly slides?: SlidesMcpReader,
    private readonly permissions?: McpPermissionGate,
  ) {}

  async handle(request: McpBridgeRequest): Promise<unknown> {
    if (request.method === 'tools/list') return TOOL_DESCRIPTORS
    return this.callTool(request)
  }

  private async callTool(request: McpBridgeRequest): Promise<ToolResult> {
    const name = request.params.name
    const argumentsValue = request.params.input ?? {}
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
      const documentId = this.requireOnlyDocumentId(argumentsValue)
      if (context.signal.aborted) throw new CapabilityError('cancelled', 'MCP request was cancelled')
      const target = await this.documents.findDocumentTarget(documentId)
      return GET_DOCUMENT_STATUS.execute(target, { documentId }, context)
    }
    if (name === 'slides.get_deck_context') {
      const target = await this.requireSlidesTarget(this.requireOnlyDocumentId(argumentsValue))
      return toolResult(JSON.stringify(this.requireSlides().getDeckContext(target.webContentsId)), false, target.revision)
    }
    if (name === 'slides.read_slide') {
      const documentId = argumentsValue.documentId
      const slide = argumentsValue.slide
      if (
        typeof documentId !== 'string' ||
        documentId.length === 0 ||
        (typeof slide !== 'string' && (!Number.isInteger(slide) || (slide as number) < 0)) ||
        Object.keys(argumentsValue).length !== 2
      ) {
        throw new CapabilityError('validation_error', 'documentId and a non-negative slide index or slide ID are required')
      }
      const target = await this.requireSlidesTarget(documentId)
      return toolResult(
        JSON.stringify(this.requireSlides().readSlide(target.webContentsId, slide)),
        false,
        target.revision,
      )
    }
    if (name === 'slides.apply_ops') {
      const documentId = argumentsValue.documentId
      const expectedRevision = argumentsValue.expectedRevision
      const rawOps = argumentsValue.ops
      const dryRun = argumentsValue.dryRun ?? false
      if (
        typeof documentId !== 'string' ||
        documentId.length === 0 ||
        typeof expectedRevision !== 'number' ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        !Array.isArray(rawOps) ||
        typeof dryRun !== 'boolean' ||
        Object.keys(argumentsValue).some((key) => !['documentId', 'expectedRevision', 'ops', 'dryRun'].includes(key))
      ) {
        throw new CapabilityError('validation_error', 'documentId, expectedRevision, ops, and optional dryRun are required')
      }
      const target = await this.requireSlidesTarget(documentId)
      const slides = this.requireSlidesWriter()
      const risk = slides.opsRisk(rawOps)
      const execute = async () => {
        if (!dryRun)
          await this.requirePermissions().authorize({
            clientId: context.clientId,
            toolName: name,
            risk,
            document: target,
          })
        return slides.applyOps(target.webContentsId, rawOps, expectedRevision, dryRun)
      }
      const result = dryRun
        ? await execute()
        : await this.writeQueue.enqueue(target.documentId, context.signal, execute)
      return toolResult(JSON.stringify(result), result.applied, result.revision)
    }
    if (name === 'undo' || name === 'redo') {
      const { documentId, expectedRevision } = this.requireDocumentRevision(argumentsValue)
      const target = await this.requireSlidesTarget(documentId)
      const slides = this.requireSlidesWriter()
      const result = await this.writeQueue.enqueue(target.documentId, context.signal, async () => {
        await this.requirePermissions().authorize({
          clientId: context.clientId,
          toolName: name,
          risk: 'write',
          document: target,
        })
        return name === 'undo'
          ? slides.undo(target.webContentsId, expectedRevision)
          : slides.redo(target.webContentsId, expectedRevision)
      })
      return toolResult(JSON.stringify(result), result.applied, result.revision)
    }
    if (name === 'activate_document') {
      const { documentId, expectedRevision } = this.requireDocumentRevision(argumentsValue)
      const target = await this.documents.findDocumentTarget(documentId)
      if (!target) throw new CapabilityError('not_found', 'Document is no longer open')
      if (target.revision !== expectedRevision) {
        throw new CapabilityError('conflict', 'Document changed since it was read', {
          expectedRevision,
          actualRevision: target.revision,
        })
      }
      await this.requirePermissions().authorize({
        clientId: context.clientId,
        toolName: name,
        risk: 'write',
        document: target,
      })
      const activated = await this.documents.activateDocument(documentId)
      if (!activated) throw new CapabilityError('not_found', 'Document is no longer open')
      return toolResult(JSON.stringify(activated), false, activated.revision)
    }
    throw new CapabilityError('not_found', `Unknown MCP tool: ${name}`)
  }

  private assertEmptyArguments(argumentsValue: Record<string, unknown>): void {
    if (Object.keys(argumentsValue).length > 0) {
      throw new CapabilityError('validation_error', 'This tool does not accept arguments')
    }
  }

  private requireOnlyDocumentId(argumentsValue: Record<string, unknown>): string {
    const documentId = argumentsValue.documentId
    if (
      typeof documentId !== 'string' ||
      documentId.length === 0 ||
      documentId.length > 128 ||
      Object.keys(argumentsValue).length !== 1
    ) {
      throw new CapabilityError('validation_error', 'documentId must be the only non-empty string argument')
    }
    return documentId
  }

  private requireDocumentRevision(argumentsValue: Record<string, unknown>): {
    documentId: string
    expectedRevision: number
  } {
    const documentId = argumentsValue.documentId
    const expectedRevision = argumentsValue.expectedRevision
    if (
      typeof documentId !== 'string' ||
      documentId.length === 0 ||
      typeof expectedRevision !== 'number' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      Object.keys(argumentsValue).length !== 2
    ) {
      throw new CapabilityError('validation_error', 'documentId and expectedRevision are required')
    }
    return { documentId, expectedRevision }
  }

  private async requireSlidesTarget(documentId: string): Promise<DocumentTarget> {
    const target = await this.documents.findDocumentTarget(documentId)
    if (!target) throw new CapabilityError('not_found', 'Document is no longer open')
    if (target.kind !== 'slides') throw new CapabilityError('validation_error', 'Document is not a Slides deck')
    return target
  }

  private requireSlides(): SlidesMcpReader {
    if (!this.slides) throw new CapabilityError('not_running', 'Slides MCP support is unavailable')
    return this.slides
  }

  private requireSlidesWriter(): SlidesMcpWriter {
    const slides = this.requireSlides()
    if (
      typeof (slides as Partial<SlidesMcpWriter>).applyOps !== 'function' ||
      typeof (slides as Partial<SlidesMcpWriter>).undo !== 'function' ||
      typeof (slides as Partial<SlidesMcpWriter>).redo !== 'function'
    ) {
      throw new CapabilityError('not_running', 'Slides write support is unavailable')
    }
    return slides as SlidesMcpWriter
  }

  private requirePermissions(): McpPermissionGate {
    if (!this.permissions) throw new CapabilityError('permission_denied', 'MCP write permission is unavailable')
    return this.permissions
  }
}
