import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { CapabilityError, type CapabilityErrorCode, type ToolResult } from '@genoffice/capabilities'

const MAX_BRIDGE_LINE_BYTES = 1024 * 1024

export interface BridgeDiscovery {
  version: 1
  transport: 'unix' | 'pipe'
  endpoint: string
  token: string
}

interface BridgeSuccess {
  id: string
  ok: true
  result: unknown
}

interface BridgeFailure {
  id: string
  ok: false
  error: { code: CapabilityErrorCode; message: string; details?: Record<string, unknown> }
}

type BridgeResponse = BridgeSuccess | BridgeFailure

export interface BridgeToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface BridgeCallContext {
  clientId: string
  signal: AbortSignal
}

function invalidDiscovery(message: string): CapabilityError {
  return new CapabilityError('not_running', `GenOffice MCP discovery is invalid: ${message}`)
}

export async function readBridgeDiscovery(path: string): Promise<BridgeDiscovery> {
  let raw: string
  try {
    const file = await stat(path)
    if (!file.isFile()) throw invalidDiscovery('path is not a file')
    if (process.platform !== 'win32' && (file.mode & 0o077) !== 0) {
      throw invalidDiscovery('discovery file permissions are too broad')
    }
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof CapabilityError) throw error
    throw new CapabilityError('not_running', 'GenOffice is not running or MCP is not enabled')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw invalidDiscovery('not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object') throw invalidDiscovery('payload is not an object')
  const value = parsed as Record<string, unknown>
  if (value.version !== 1) throw invalidDiscovery('unsupported version')
  if (value.transport !== 'unix' && value.transport !== 'pipe') throw invalidDiscovery('unsupported transport')
  if (typeof value.endpoint !== 'string' || !value.endpoint) throw invalidDiscovery('missing endpoint')
  if (typeof value.token !== 'string' || value.token.length < 32)
    throw invalidDiscovery('missing token')
  return {
    version: 1,
    transport: value.transport,
    endpoint: value.endpoint,
    token: value.token,
  }
}

/** JSON-lines client for the private adapter ↔ Electron-main bridge. */
export class LocalBridgeClient {
  private readonly discovery: BridgeDiscovery
  private socket: Socket | null = null
  private buffer = ''
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >()

  constructor(discovery: BridgeDiscovery) {
    this.discovery = discovery
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return
    const socket = await new Promise<Socket>((resolve, reject) => {
      const next = connect({ path: this.discovery.endpoint })
      const onError = (error: Error) => {
        next.removeListener('connect', onConnect)
        reject(new CapabilityError('not_running', `Could not connect to GenOffice: ${error.message}`))
      }
      const onConnect = () => {
        next.removeListener('error', onError)
        resolve(next)
      }
      next.once('error', onError)
      next.once('connect', onConnect)
    })
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.receive(chunk))
    socket.on('close', () => this.rejectAll(new CapabilityError('not_running', 'GenOffice MCP bridge closed')))
    socket.on('error', () => {
      // The close handler rejects pending requests. Keeping this listener prevents an unhandled event.
    })
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
    this.rejectAll(new CapabilityError('cancelled', 'MCP adapter closed'))
  }

  async listTools(context: BridgeCallContext): Promise<BridgeToolDefinition[]> {
    const result = await this.request('tools/list', {}, context)
    if (!Array.isArray(result)) throw new CapabilityError('internal_error', 'Invalid tools/list response')
    return result.map((tool) => {
      if (!tool || typeof tool !== 'object') throw new CapabilityError('internal_error', 'Invalid tool')
      const value = tool as Record<string, unknown>
      if (
        typeof value.name !== 'string' ||
        typeof value.description !== 'string' ||
        !value.inputSchema ||
        typeof value.inputSchema !== 'object'
      ) {
        throw new CapabilityError('internal_error', 'Invalid tool definition')
      }
      return {
        name: value.name,
        description: value.description,
        inputSchema: value.inputSchema as Record<string, unknown>,
      }
    })
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    context: BridgeCallContext,
  ): Promise<ToolResult> {
    const result = await this.request('tools/call', { name, input }, context)
    if (!result || typeof result !== 'object') throw new CapabilityError('internal_error', 'Invalid tools/call response')
    const value = result as Record<string, unknown>
    if (typeof value.content !== 'string' || typeof value.mutated !== 'boolean') {
      throw new CapabilityError('internal_error', 'Invalid tool result')
    }
    if (value.revision !== undefined && (!Number.isInteger(value.revision) || Number(value.revision) < 0)) {
      throw new CapabilityError('internal_error', 'Invalid tool revision')
    }
    return {
      content: value.content,
      mutated: value.mutated,
      ...(value.revision === undefined ? {} : { revision: Number(value.revision) }),
    }
  }

  private request(
    method: 'tools/list' | 'tools/call',
    params: Record<string, unknown>,
    context: BridgeCallContext,
  ): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.destroyed) {
      return Promise.reject(new CapabilityError('not_running', 'GenOffice MCP bridge is unavailable'))
    }
    if (context.signal.aborted) return Promise.reject(new CapabilityError('cancelled', 'Request cancelled'))
    const id = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id)
        reject(new CapabilityError('cancelled', 'Request cancelled'))
      }
      context.signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (value) => {
          context.signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: (reason) => {
          context.signal.removeEventListener('abort', onAbort)
          reject(reason)
        },
      })
      socket.write(
        `${JSON.stringify({
          id,
          token: this.discovery.token,
          clientId: context.clientId,
          method,
          params,
        })}\n`,
      )
    })
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > MAX_BRIDGE_LINE_BYTES) {
      this.close()
      return
    }
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let response: BridgeResponse
    try {
      response = JSON.parse(line) as BridgeResponse
    } catch {
      this.close()
      return
    }
    if (!response || typeof response.id !== 'string' || typeof response.ok !== 'boolean') {
      this.close()
      return
    }
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.ok) pending.resolve(response.result)
    else {
      pending.reject(
        new CapabilityError(
          response.error.code,
          response.error.message,
          response.error.details,
        ),
      )
    }
  }

  private rejectAll(reason: unknown): void {
    for (const pending of this.pending.values()) pending.reject(reason)
    this.pending.clear()
  }
}
