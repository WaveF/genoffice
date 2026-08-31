import type { Readable, Writable } from 'node:stream'
import { CapabilityError, type ToolResult } from '@nexoffice/capabilities'
import type { BridgeCallContext, BridgeToolDefinition } from './bridge-client'

const FALLBACK_PROTOCOL_VERSION = '2025-06-18'
const MAX_STDIO_LINE_BYTES = 1024 * 1024

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method?: unknown
  params?: unknown
}

interface McpBackend {
  listTools(context: BridgeCallContext): Promise<BridgeToolDefinition[]>
  callTool(
    name: string,
    input: Record<string, unknown>,
    context: BridgeCallContext,
  ): Promise<ToolResult>
}

export interface StdioMcpServerOptions {
  input: Readable
  output: Writable
  backend: McpBackend
  serverName?: string
  serverVersion?: string
}

function toolError(error: unknown): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  if (error instanceof CapabilityError) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ code: error.code, message: error.message }) },
      ],
      isError: true,
    }
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify({ code: 'internal_error', message: 'Tool failed' }) },
    ],
    isError: true,
  }
}

/** Minimal MCP stdio server: initialize, ping, tools/list and tools/call. */
export class StdioMcpServer {
  private readonly options: StdioMcpServerOptions
  private buffer = ''
  private queue = Promise.resolve()
  private initialized = false
  private clientId = 'unknown-client'
  private readonly abortController = new AbortController()

  constructor(options: StdioMcpServerOptions) {
    this.options = options
  }

  start(): void {
    this.options.input.setEncoding('utf8')
    this.options.input.on('data', (chunk: string) => {
      this.queue = this.queue.then(() => this.receive(chunk)).catch(() => undefined)
    })
    this.options.input.once('end', () => this.close())
    this.options.input.once('error', () => this.close())
  }

  close(): void {
    this.abortController.abort()
  }

  private async receive(chunk: string): Promise<void> {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > MAX_STDIO_LINE_BYTES) {
      this.writeError(null, -32600, 'Request exceeds maximum size')
      this.close()
      return
    }
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      await this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private async handleLine(line: string): Promise<void> {
    let request: JsonRpcRequest
    try {
      request = JSON.parse(line) as JsonRpcRequest
    } catch {
      this.writeError(null, -32700, 'Parse error')
      return
    }
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      this.writeError(this.idOf(request), -32600, 'Invalid request')
      return
    }
    const id = this.idOf(request)
    const isNotification = request.id === undefined
    try {
      const result = await this.dispatch(request.method, request.params)
      if (!isNotification) this.writeResult(id, result)
    } catch (error) {
      if (!isNotification) {
        const message = error instanceof CapabilityError ? error.message : 'Internal error'
        this.writeError(id, -32603, message)
      }
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params)
      case 'notifications/initialized':
        return {}
      case 'ping':
        return {}
      case 'tools/list':
        this.requireInitialized()
        return { tools: await this.options.backend.listTools(this.context()) }
      case 'tools/call':
        this.requireInitialized()
        return this.callTool(params)
      default:
        throw new CapabilityError('validation_error', `Method not found: ${method}`)
    }
  }

  private initialize(params: unknown): Record<string, unknown> {
    const value = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
    const clientInfo = value.clientInfo
    if (clientInfo && typeof clientInfo === 'object') {
      const name = (clientInfo as Record<string, unknown>).name
      if (typeof name === 'string' && name.trim()) this.clientId = name.trim().slice(0, 128)
    }
    this.initialized = true
    return {
      protocolVersion:
        typeof value.protocolVersion === 'string' && value.protocolVersion
          ? value.protocolVersion
          : FALLBACK_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: this.options.serverName ?? 'NexOffice',
        version: this.options.serverVersion ?? '0.1.0',
      },
    }
  }

  private async callTool(params: unknown): Promise<unknown> {
    const value = params && typeof params === 'object' ? (params as Record<string, unknown>) : null
    if (!value || typeof value.name !== 'string' || !value.name.trim()) {
      throw new CapabilityError('validation_error', 'tools/call requires a tool name')
    }
    const input = value.arguments
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
      throw new CapabilityError('validation_error', 'tools/call arguments must be an object')
    }
    try {
      const result = await this.options.backend.callTool(
        value.name,
        (input ?? {}) as Record<string, unknown>,
        this.context(),
      )
      return {
        content: [{ type: 'text', text: result.content }],
        structuredContent: {
          mutated: result.mutated,
          ...(result.revision === undefined ? {} : { revision: result.revision }),
        },
      }
    } catch (error) {
      return toolError(error)
    }
  }

  private context(): BridgeCallContext {
    return { clientId: this.clientId, signal: this.abortController.signal }
  }

  private requireInitialized(): void {
    if (!this.initialized) throw new CapabilityError('unauthorized', 'MCP initialize is required')
  }

  private idOf(request: JsonRpcRequest | null | undefined): JsonRpcId {
    const id = request?.id
    return typeof id === 'string' || typeof id === 'number' || id === null ? id : null
  }

  private writeResult(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  private writeError(id: JsonRpcId, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  private write(value: unknown): void {
    this.options.output.write(`${JSON.stringify(value)}\n`)
  }
}
