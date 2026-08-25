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
import type { McpAuditLogger } from './audit'
import { assertSafeMcpInput } from './input-guard'
import type { RendererMcpAction, RendererMcpBridge } from './renderer-bridge'

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
  renderSlidePreview(webContentsId: number, slideRef: number | string): Promise<unknown>
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
  save(webContentsId: number, expectedRevision: number): Promise<{ saved: boolean; revision: number }>
  addSlide(
    webContentsId: number,
    afterSlide: number | string,
    expectedRevision: number,
  ): { applied: boolean; revision: number; [key: string]: unknown }
  deleteSlide(
    webContentsId: number,
    slide: number | string,
    expectedRevision: number,
  ): { applied: boolean; revision: number; [key: string]: unknown }
}

export interface RendererMcpReader {
  request(
    webContentsId: number,
    action: RendererMcpAction,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>
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
    name: 'slides.add_slide',
    description: 'Insert a blank slide after one explicit slide ID or index.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['documentId', 'expectedRevision', 'afterSlide'],
      properties: { documentId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 }, afterSlide: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string', minLength: 1 }] } },
    },
  },
  {
    name: 'slides.delete_slide',
    description: 'Delete one explicit slide ID or index after a one-time confirmation.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['documentId', 'expectedRevision', 'slide'],
      properties: { documentId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 }, slide: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string', minLength: 1 }] } },
    },
  },
  {
    name: 'save_document',
    description: 'Save one explicitly identified open Slides document to its application-controlled path.',
    inputSchema: DOCUMENT_REVISION_INPUT_SCHEMA,
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
    name: 'slides.render_preview',
    description: 'Render one open slide as a bounded PNG preview for inspection.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['documentId', 'slide'],
      properties: { documentId: { type: 'string', minLength: 1, maxLength: 128 }, slide: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string', minLength: 1 }] } },
    },
  },
  ...(['docs', 'markdown'] as const).flatMap((kind) => [
    {
      name: `${kind}.get_context`,
      description: `Read a compact context summary from one open ${kind} document.`,
      inputSchema: GET_DOCUMENT_STATUS.inputSchema,
    },
    {
      name: `${kind}.insert_content`,
      description: `Append bounded content to one explicit open ${kind} document.`,
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['documentId', 'expectedRevision', 'content'],
        properties: { documentId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 }, content: { type: 'string', minLength: 1, maxLength: 8192 } },
      },
    },
    {
      name: `${kind}.replace_blocks`,
      description: `Replace explicitly addressed content in one open ${kind} document.`,
      inputSchema: { type: 'object', additionalProperties: false, required: ['documentId', 'expectedRevision', 'content'], properties: { documentId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 }, start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, content: { type: 'string', maxLength: 65536 } } },
    },
    {
      name: `${kind}.read_blocks`,
      description: `Read a bounded block range from one open ${kind} document.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['documentId'],
        properties: {
          documentId: { type: 'string', minLength: 1, maxLength: 128 },
          start: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
  ]),
  ...([
    ['sheets', 'get_workbook_context'],
    ['pdf', 'get_document_context'],
  ] as const).map(([kind, operation]) => ({
    name: `${kind}.${operation}`,
    description: `Read a compact context summary from one open ${kind} document.`,
    inputSchema: GET_DOCUMENT_STATUS.inputSchema,
  })),
  {
    name: 'sheets.read_range',
    description: 'Read one explicit bounded cell range from an open workbook.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['documentId', 'sheetId', 'range'],
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 128 },
        sheetId: { type: 'string', minLength: 1, maxLength: 128 },
        range: { type: 'string', minLength: 1, maxLength: 64 },
      },
    },
  },
  {
    name: 'sheets.find', description: 'Find bounded text matches in one explicit workbook range.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['documentId', 'sheetId', 'range', 'query'], properties: { documentId: { type: 'string' }, sheetId: { type: 'string' }, range: { type: 'string' }, query: { type: 'string', minLength: 1, maxLength: 256 } } },
  },
  { name: 'sheets.aggregate', description: 'Aggregate numeric cells in one explicit workbook range.', inputSchema: { type: 'object', additionalProperties: false, required: ['documentId', 'sheetId', 'range', 'operation'], properties: { documentId: { type: 'string' }, sheetId: { type: 'string' }, range: { type: 'string' }, operation: { enum: ['sum', 'count', 'average'] } } } },
  { name: 'sheets.trace_formula', description: 'Read direct A1 precedents of one formula cell.', inputSchema: { type: 'object', additionalProperties: false, required: ['documentId', 'sheetId', 'address'], properties: { documentId: { type: 'string' }, sheetId: { type: 'string' }, address: { type: 'string' } } } },
  {
    name: 'sheets.apply_operations',
    description: 'Dry-run or atomically apply a validated operation batch to an open workbook.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['documentId', 'expectedRevision', 'transactionId', 'summary', 'operations'],
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 128 },
        expectedRevision: { type: 'integer', minimum: 0 },
        transactionId: { type: 'string', minLength: 1, maxLength: 128 },
        summary: { type: 'string', minLength: 1, maxLength: 500 },
        operations: { type: 'array', minItems: 1, maxItems: 1000 },
        dryRun: { type: 'boolean' },
      },
    },
  },
  { name: 'sheets.undo', description: 'Undo the latest compatible workbook change.', inputSchema: DOCUMENT_REVISION_INPUT_SCHEMA },
  {
    name: 'pdf.read_page_context',
    description: 'Read bounded text context for one explicit page of an open PDF.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['documentId', 'page'], properties: { documentId: { type: 'string' }, page: { type: 'integer', minimum: 0 } } },
  },
  { name: 'pdf.search', description: 'Search bounded text matches in an open PDF.', inputSchema: { type: 'object', additionalProperties: false, required: ['documentId', 'query'], properties: { documentId: { type: 'string' }, query: { type: 'string', minLength: 1, maxLength: 256 } } } },
  { name: 'pdf.read_annotations', description: 'Read bounded saved and pending annotations on one PDF page.', inputSchema: { type: 'object', additionalProperties: false, required: ['documentId', 'page'], properties: { documentId: { type: 'string' }, page: { type: 'integer', minimum: 0 } } } },
  {
    name: 'pdf.apply_operations',
    description: 'Dry-run or queue bounded non-destructive annotations in an open PDF.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['documentId', 'expectedRevision', 'operations'],
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 128 },
        expectedRevision: { type: 'integer', minimum: 0 },
        operations: { type: 'array', minItems: 1, maxItems: 50 },
        dryRun: { type: 'boolean' },
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
    private readonly audit?: McpAuditLogger,
    private readonly renderer?: RendererMcpReader,
  ) {}

  async handle(request: McpBridgeRequest): Promise<unknown> {
    if (request.method === 'tools/list') return TOOL_DESCRIPTORS
    try {
      const result = await this.callTool(request)
      await this.auditResult(request, result, 'success')
      return result
    } catch (error) {
      await this.auditResult(request, undefined, 'error', error)
      throw error
    }
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
    assertSafeMcpInput(argumentsValue)
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
      const { documentId, slide } = this.requireDocumentSlide(argumentsValue)
      const target = await this.requireSlidesTarget(documentId)
      return toolResult(
        JSON.stringify(this.requireSlides().readSlide(target.webContentsId, slide)),
        false,
        target.revision,
      )
    }
    if (name === 'slides.render_preview') {
      const { documentId, slide } = this.requireDocumentSlide(argumentsValue)
      const target = await this.requireSlidesTarget(documentId)
      return toolResult(JSON.stringify(await this.requireSlides().renderSlidePreview(target.webContentsId, slide)), false, target.revision)
    }
    if (
      name === 'docs.get_context' ||
      name === 'markdown.get_context' ||
      name === 'docs.read_blocks' ||
      name === 'markdown.read_blocks'
    ) {
      const [kind, operation] = name.split('.') as ['docs' | 'markdown', 'get_context' | 'read_blocks']
      const documentId =
        operation === 'get_context'
          ? this.requireOnlyDocumentId(argumentsValue)
          : this.requireDocumentBlockRange(argumentsValue).documentId
      const target = await this.requireRendererTarget(documentId, kind)
      const input =
        operation === 'get_context'
          ? {}
          : this.requireDocumentBlockRange(argumentsValue)
      const result = await this.requireRenderer().request(
        target.webContentsId,
        name as RendererMcpAction,
        input,
        context.signal,
      )
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'sheets.get_workbook_context' || name === 'pdf.get_document_context') {
      const [kind] = name.split('.') as ['sheets' | 'pdf']
      const documentId = this.requireOnlyDocumentId(argumentsValue)
      const target = await this.requireRendererTarget(documentId, kind)
      const result = await this.requireRenderer().request(target.webContentsId, name as RendererMcpAction, {}, context.signal)
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'sheets.read_range') {
      const { documentId, sheetId, range } = argumentsValue
      if (
        typeof documentId !== 'string' || typeof sheetId !== 'string' || typeof range !== 'string' ||
        documentId.length === 0 || sheetId.length === 0 || range.length === 0 || Object.keys(argumentsValue).length !== 3
      ) throw new CapabilityError('validation_error', 'documentId, sheetId, and range are required')
      const target = await this.requireRendererTarget(documentId, 'sheets')
      const result = await this.requireRenderer().request(target.webContentsId, 'sheets.read_range', { sheetId, range }, context.signal)
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'sheets.find') {
      const { documentId, sheetId, range, query } = argumentsValue
      if (typeof documentId !== 'string' || typeof sheetId !== 'string' || typeof range !== 'string' || typeof query !== 'string' || Object.keys(argumentsValue).length !== 4) throw new CapabilityError('validation_error', 'documentId, sheetId, range, and query are required')
      const target = await this.requireRendererTarget(documentId, 'sheets')
      const result = await this.requireRenderer().request(target.webContentsId, 'sheets.find', { sheetId, range, query }, context.signal)
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'sheets.aggregate') {
      const { documentId, sheetId, range, operation } = argumentsValue
      if (typeof documentId !== 'string' || typeof sheetId !== 'string' || typeof range !== 'string' || !['sum', 'count', 'average'].includes(String(operation)) || Object.keys(argumentsValue).length !== 4) throw new CapabilityError('validation_error', 'documentId, sheetId, range, and operation are required')
      const target = await this.requireRendererTarget(documentId, 'sheets')
      const result = await this.requireRenderer().request(target.webContentsId, 'sheets.aggregate', { sheetId, range, operation }, context.signal)
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'sheets.trace_formula') {
      const { documentId, sheetId, address } = argumentsValue
      if (typeof documentId !== 'string' || typeof sheetId !== 'string' || typeof address !== 'string' || Object.keys(argumentsValue).length !== 3) throw new CapabilityError('validation_error', 'documentId, sheetId, and address are required')
      const target = await this.requireRendererTarget(documentId, 'sheets')
      const result = await this.requireRenderer().request(target.webContentsId, 'sheets.trace_formula', { sheetId, address }, context.signal)
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'sheets.apply_operations') {
      const { documentId, expectedRevision, transactionId, summary, operations, dryRun = false } = argumentsValue
      if (
        typeof documentId !== 'string' || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0 ||
        typeof transactionId !== 'string' || typeof summary !== 'string' || !Array.isArray(operations) || typeof dryRun !== 'boolean' ||
        Object.keys(argumentsValue).some((key) => !['documentId', 'expectedRevision', 'transactionId', 'summary', 'operations', 'dryRun'].includes(key))
      ) throw new CapabilityError('validation_error', 'A complete Sheets operation batch is required')
      const target = await this.requireRendererTarget(documentId, 'sheets')
      if (target.revision !== expectedRevision) throw new CapabilityError('conflict', 'Workbook changed since it was read', { expectedRevision, actualRevision: target.revision })
      const result = await this.writeQueue.enqueue(target.documentId, context.signal, async () => {
        if (!dryRun) await this.requirePermissions().authorize({ clientId: context.clientId, toolName: name, risk: 'write', document: target })
        return this.requireRenderer().request(target.webContentsId, 'sheets.apply_operations', { expectedRevision, transactionId, summary, operations, dryRun }, context.signal)
      })
      const updated = await this.requireRendererTarget(documentId, 'sheets')
      return toolResult(JSON.stringify(result), !dryRun, updated.revision)
    }
    if (name === 'sheets.undo') {
      const { documentId, expectedRevision } = argumentsValue
      if (typeof documentId !== 'string' || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0 || Object.keys(argumentsValue).length !== 2) throw new CapabilityError('validation_error', 'documentId and expectedRevision are required')
      const target = await this.requireRendererTarget(documentId, 'sheets')
      if (target.revision !== expectedRevision) throw new CapabilityError('conflict', 'Workbook changed since it was read', { expectedRevision, actualRevision: target.revision })
      const result = await this.writeQueue.enqueue(target.documentId, context.signal, async () => {
        await this.requirePermissions().authorize({ clientId: context.clientId, toolName: name, risk: 'write', document: target })
        return this.requireRenderer().request(target.webContentsId, 'sheets.undo', { expectedRevision }, context.signal)
      })
      const updated = await this.requireRendererTarget(documentId, 'sheets')
      return toolResult(JSON.stringify(result), true, updated.revision)
    }
    if (name === 'pdf.read_page_context') {
      const documentId = argumentsValue.documentId
      const page = argumentsValue.page
      if (typeof documentId !== 'string' || typeof page !== 'number' || !Number.isSafeInteger(page) || page < 0 || Object.keys(argumentsValue).length !== 2) throw new CapabilityError('validation_error', 'documentId and non-negative page are required')
      const target = await this.requireRendererTarget(documentId, 'pdf')
      const result = await this.requireRenderer().request(target.webContentsId, 'pdf.read_page_context', { page }, context.signal)
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'pdf.search') {
      const { documentId, query } = argumentsValue
      if (typeof documentId !== 'string' || typeof query !== 'string' || query.length === 0 || Object.keys(argumentsValue).length !== 2) throw new CapabilityError('validation_error', 'documentId and query are required')
      const target = await this.requireRendererTarget(documentId, 'pdf')
      const result = await this.requireRenderer().request(target.webContentsId, 'pdf.search', { query }, context.signal)
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'pdf.read_annotations') {
      const { documentId, page } = argumentsValue
      if (typeof documentId !== 'string' || !Number.isSafeInteger(page) || (page as number) < 0 || Object.keys(argumentsValue).length !== 2) throw new CapabilityError('validation_error', 'documentId and page are required')
      const target = await this.requireRendererTarget(documentId, 'pdf')
      const result = await this.requireRenderer().request(target.webContentsId, 'pdf.read_annotations', { page }, context.signal)
      return toolResult(JSON.stringify(result), false, target.revision)
    }
    if (name === 'pdf.apply_operations') {
      const { documentId, expectedRevision, operations, dryRun = false } = argumentsValue
      if (
        typeof documentId !== 'string' || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0 ||
        !Array.isArray(operations) || operations.length === 0 || operations.length > 50 || typeof dryRun !== 'boolean' ||
        Object.keys(argumentsValue).some((key) => !['documentId', 'expectedRevision', 'operations', 'dryRun'].includes(key))
      ) throw new CapabilityError('validation_error', 'A bounded PDF operation batch is required')
      const target = await this.requireRendererTarget(documentId, 'pdf')
      if (target.revision !== expectedRevision) throw new CapabilityError('conflict', 'Document changed since it was read', { expectedRevision, actualRevision: target.revision })
      const destructive = operations.some((operation) => isRecord(operation) && ['delete_page', 'replace_pages', 'split_pages', 'merge_pages'].includes(String(operation.op)))
      const result = await this.writeQueue.enqueue(target.documentId, context.signal, async () => {
        if (!dryRun) await this.requirePermissions().authorize({ clientId: context.clientId, toolName: name, risk: destructive ? 'destructive' : 'write', document: target })
        return this.requireRenderer().request(target.webContentsId, 'pdf.apply_operations', { expectedRevision, operations, dryRun }, context.signal)
      })
      const updated = await this.requireRendererTarget(documentId, 'pdf')
      return toolResult(JSON.stringify(result), !dryRun, updated.revision)
    }
    if (
      name === 'docs.insert_content' || name === 'docs.replace_blocks' ||
      name === 'markdown.insert_content' || name === 'markdown.replace_blocks'
    ) {
      const [kind] = name.split('.') as ['docs' | 'markdown']
      const { documentId, expectedRevision } = this.requireDocumentRevisionWithContent(argumentsValue)
      const target = await this.requireRendererTarget(documentId, kind)
      if (target.revision !== expectedRevision) throw new CapabilityError('conflict', 'Document changed since it was read', { expectedRevision, actualRevision: target.revision })
      const result = await this.writeQueue.enqueue(target.documentId, context.signal, async () => {
        await this.requirePermissions().authorize({ clientId: context.clientId, toolName: name, risk: 'write', document: target })
        return this.requireRenderer().request(target.webContentsId, name as RendererMcpAction, argumentsValue, context.signal)
      })
      const updated = await this.requireRendererTarget(documentId, kind)
      return toolResult(JSON.stringify(result), true, updated.revision)
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
    if (name === 'save_document') {
      const { documentId, expectedRevision } = this.requireDocumentRevision(argumentsValue)
      const target = await this.requireSlidesTarget(documentId)
      const slides = this.requireSlidesWriter()
      const result = await this.writeQueue.enqueue(target.documentId, context.signal, async () => {
        await this.requirePermissions().authorize({
          clientId: context.clientId,
          toolName: name,
          risk: 'file',
          document: target,
        })
        return slides.save(target.webContentsId, expectedRevision)
      })
      return toolResult(JSON.stringify(result), false, result.revision)
    }
    if (name === 'slides.add_slide' || name === 'slides.delete_slide') {
      const { documentId, expectedRevision } = this.requireDocumentRevisionWithSlide(
        argumentsValue,
        name === 'slides.add_slide' ? 'afterSlide' : 'slide',
      )
      const target = await this.requireSlidesTarget(documentId)
      const slides = this.requireSlidesWriter()
      const slide = argumentsValue[name === 'slides.add_slide' ? 'afterSlide' : 'slide'] as number | string
      const risk: ToolRisk = name === 'slides.delete_slide' ? 'destructive' : 'write'
      const result = await this.writeQueue.enqueue(target.documentId, context.signal, async () => {
        await this.requirePermissions().authorize({ clientId: context.clientId, toolName: name, risk, document: target })
        return name === 'slides.add_slide'
          ? slides.addSlide(target.webContentsId, slide, expectedRevision)
          : slides.deleteSlide(target.webContentsId, slide, expectedRevision)
      })
      return toolResult(JSON.stringify(result), result.applied, result.revision)
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

  private requireDocumentRevisionWithSlide(
    argumentsValue: Record<string, unknown>,
    slideKey: 'afterSlide' | 'slide',
  ): { documentId: string; expectedRevision: number } {
    const base = this.requireDocumentRevision({
      documentId: argumentsValue.documentId,
      expectedRevision: argumentsValue.expectedRevision,
    })
    const slide = argumentsValue[slideKey]
    if ((typeof slide !== 'string' && (!Number.isInteger(slide) || (slide as number) < 0)) || Object.keys(argumentsValue).length !== 3) {
      throw new CapabilityError('validation_error', `${slideKey} must be a slide ID or non-negative index`)
    }
    return base
  }

  private requireDocumentSlide(argumentsValue: Record<string, unknown>): {
    documentId: string
    slide: number | string
  } {
    const documentId = argumentsValue.documentId
    const slide = argumentsValue.slide
    if (
      typeof documentId !== 'string' ||
      documentId.length === 0 ||
      (typeof slide !== 'string' &&
        (typeof slide !== 'number' || !Number.isInteger(slide) || slide < 0)) ||
      Object.keys(argumentsValue).length !== 2
    ) {
      throw new CapabilityError(
        'validation_error',
        'documentId and a non-negative slide index or slide ID are required',
      )
    }
    return { documentId, slide: slide as number | string }
  }

  private requireDocumentBlockRange(argumentsValue: Record<string, unknown>): {
    documentId: string
    start?: number
    limit?: number
  } {
    const documentId = argumentsValue.documentId
    const start = argumentsValue.start
    const limit = argumentsValue.limit
    if (
      typeof documentId !== 'string' ||
      documentId.length === 0 ||
      (start !== undefined &&
        (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0)) ||
      (limit !== undefined &&
        (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)) ||
      Object.keys(argumentsValue).some((key) => !['documentId', 'start', 'limit'].includes(key))
    ) {
      throw new CapabilityError('validation_error', 'documentId and optional bounded start/limit are required')
    }
    return {
      documentId,
      ...(typeof start === 'number' ? { start } : {}),
      ...(typeof limit === 'number' ? { limit } : {}),
    }
  }

  private requireDocumentRevisionWithContent(argumentsValue: Record<string, unknown>): { documentId: string; expectedRevision: number } {
    const base = this.requireDocumentRevision({ documentId: argumentsValue.documentId, expectedRevision: argumentsValue.expectedRevision })
    const content = argumentsValue.content
    if (typeof content !== 'string' || content.length === 0 || content.length > 64 * 1024 || Object.keys(argumentsValue).some((key) => !['documentId', 'expectedRevision', 'start', 'end', 'content'].includes(key)))
      throw new CapabilityError('validation_error', 'documentId, expectedRevision, and bounded content are required')
    return base
  }

  private async requireSlidesTarget(documentId: string): Promise<DocumentTarget> {
    const target = await this.documents.findDocumentTarget(documentId)
    if (!target) throw new CapabilityError('not_found', 'Document is no longer open')
    if (target.kind !== 'slides') throw new CapabilityError('validation_error', 'Document is not a Slides deck')
    return target
  }

  private async requireRendererTarget(
    documentId: string,
    kind: 'docs' | 'markdown' | 'sheets' | 'pdf',
  ): Promise<DocumentTarget> {
    const target = await this.documents.findDocumentTarget(documentId)
    if (!target) throw new CapabilityError('not_found', 'Document is no longer open')
    if (target.kind !== kind) throw new CapabilityError('validation_error', `Document is not a ${kind} document`)
    return target
  }

  private requireRenderer(): RendererMcpReader {
    if (!this.renderer) throw new CapabilityError('not_running', 'Renderer MCP support is unavailable')
    return this.renderer
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
      typeof (slides as Partial<SlidesMcpWriter>).redo !== 'function' ||
      typeof (slides as Partial<SlidesMcpWriter>).save !== 'function' ||
      typeof (slides as Partial<SlidesMcpWriter>).addSlide !== 'function' ||
      typeof (slides as Partial<SlidesMcpWriter>).deleteSlide !== 'function'
    ) {
      throw new CapabilityError('not_running', 'Slides write support is unavailable')
    }
    return slides as SlidesMcpWriter
  }

  private requirePermissions(): McpPermissionGate {
    if (!this.permissions) throw new CapabilityError('permission_denied', 'MCP write permission is unavailable')
    return this.permissions
  }

  private async auditResult(
    request: McpBridgeRequest,
    result: ToolResult | undefined,
    outcome: 'success' | 'error',
    error?: unknown,
  ): Promise<void> {
    if (!this.audit || typeof request.params.name !== 'string') return
    const input = isRecord(request.params.input) ? request.params.input : undefined
    try {
      await this.audit.record({
        at: new Date().toISOString(),
        clientId: request.clientId,
        toolName: request.params.name,
        ...(typeof input?.documentId === 'string' ? { documentId: input.documentId } : {}),
        outcome,
        ...(result ? { mutated: result.mutated } : {}),
        ...(result?.revision === undefined ? {} : { revision: result.revision }),
        ...(error instanceof CapabilityError ? { errorCode: error.code } : {}),
      })
    } catch {
      // Audit I/O must never turn a completed or rejected tool call into a different result.
    }
  }
}
