import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityError, type CapabilityErrorCode } from '@nexoffice/capabilities'

const MAX_BRIDGE_LINE_BYTES = 1024 * 1024

export interface McpBridgeDiscovery {
  version: 1
  transport: 'unix' | 'pipe'
  endpoint: string
  token: string
  /** Session-private directory where an authenticated MCP client may stage generated image files. */
  mediaImportDirectory?: string
  /** Packaged adapter path when Shell owns one; omitted for source-only runs. */
  adapterPath?: string
}

export interface McpBridgeRequest {
  clientId: string
  requestId: string
  method: 'tools/list' | 'tools/call'
  params: Record<string, unknown>
  signal: AbortSignal
}

export interface McpBridgeGateway {
  handle(request: McpBridgeRequest): Promise<unknown>
}

export interface LocalMcpBridgeOptions {
  userDataPath: string
  gateway: McpBridgeGateway
  platform?: NodeJS.Platform
  adapterPath?: string
  mediaImportDirectory?: string
}

interface WireRequest {
  id: string
  token: string
  clientId: string
  method: 'tools/list' | 'tools/call'
  params: Record<string, unknown>
}

interface WireFailure {
  id: string
  ok: false
  error: { code: CapabilityErrorCode; message: string; details?: Readonly<Record<string, unknown>> }
}

/**
 * Private, authenticated JSON-lines server shared by a running Shell and its
 * process-spawned MCP adapters. It deliberately has no HTTP listener.
 */
export class LocalMcpBridge {
  private readonly options: LocalMcpBridgeOptions
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()
  private readonly socketDir: string
  private readonly endpoint: string
  private readonly token = randomBytes(32).toString('base64url')
  private readonly platform: NodeJS.Platform
  private started = false

  constructor(options: LocalMcpBridgeOptions) {
    this.options = options
    this.platform = options.platform ?? process.platform
    this.socketDir = join(options.userDataPath, 'mcp')
    const instance = `${process.pid}-${randomBytes(12).toString('hex')}`
    this.endpoint =
      this.platform === 'win32'
        ? `\\\\.\\pipe\\nexoffice-mcp-${instance}`
        : // macOS limits Unix-domain socket paths to roughly 104 bytes. userData
          // paths are often longer (notably “Application Support/NexOffice Dev”),
          // so keep the ephemeral socket in the short system temp directory.
          join(tmpdir(), `nexoffice-mcp-${instance}.sock`)
  }

  get discoveryPath(): string {
    return join(this.socketDir, 'bridge.json')
  }

  get discovery(): McpBridgeDiscovery {
    return {
      version: 1,
      transport: this.platform === 'win32' ? 'pipe' : 'unix',
      endpoint: this.endpoint,
      token: this.token,
      ...(this.options.mediaImportDirectory
        ? { mediaImportDirectory: this.options.mediaImportDirectory }
        : {}),
      ...(this.options.adapterPath ? { adapterPath: this.options.adapterPath } : {}),
    }
  }

  async start(): Promise<void> {
    if (this.started) return
    await mkdir(this.socketDir, { recursive: true, mode: 0o700 })
    if (this.platform !== 'win32') await rm(this.endpoint, { force: true })
    const server = createServer((socket) => this.attach(socket))
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.endpoint)
    })
    this.server = server
    try {
      await this.writeDiscovery()
      this.started = true
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.started = false
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await rm(this.discoveryPath, { force: true })
    if (this.platform !== 'win32') await rm(this.endpoint, { force: true })
  }

  private async writeDiscovery(): Promise<void> {
    const temp = `${this.discoveryPath}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(this.discovery)}\n`, { encoding: 'utf8', mode: 0o600 })
    if (this.platform !== 'win32') await chmod(temp, 0o600)
    await rename(temp, this.discoveryPath)
    if (this.platform !== 'win32') await chmod(this.discoveryPath, 0o600)
  }

  private attach(socket: Socket): void {
    this.sockets.add(socket)
    // Permission grants are connection-scoped. Never let the adapter choose
    // this identity: a client-controlled name could reuse another client's grant.
    const connectionId = randomUUID()
    socket.setEncoding('utf8')
    let buffer = ''
    const controllers = new Set<AbortController>()
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer) > MAX_BRIDGE_LINE_BYTES) {
        socket.destroy()
        return
      }
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        void this.handleLine(socket, line, controllers, connectionId)
        newline = buffer.indexOf('\n')
      }
    })
    socket.once('close', () => {
      this.sockets.delete(socket)
      for (const controller of controllers) controller.abort()
      controllers.clear()
    })
    socket.on('error', () => {
      // The close listener owns cleanup. This handler prevents an unhandled event.
    })
  }

  private async handleLine(
    socket: Socket,
    line: string,
    controllers: Set<AbortController>,
    connectionId: string,
  ): Promise<void> {
    let request: WireRequest
    try {
      request = JSON.parse(line) as WireRequest
    } catch {
      socket.destroy()
      return
    }
    if (!this.validRequest(request)) {
      socket.destroy()
      return
    }
    if (request.token !== this.token) {
      this.write(socket, this.failure(request.id, 'unauthorized', 'Invalid MCP bridge token'))
      return
    }
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const result = await this.options.gateway.handle({
        clientId: connectionId,
        requestId: request.id,
        method: request.method,
        params: request.params,
        signal: controller.signal,
      })
      this.write(socket, { id: request.id, ok: true, result })
    } catch (error) {
      if (error instanceof CapabilityError) {
        this.write(socket, this.failure(request.id, error.code, error.message, error.details))
      } else {
        this.write(socket, this.failure(request.id, 'internal_error', 'MCP bridge request failed'))
      }
    } finally {
      controllers.delete(controller)
    }
  }

  private validRequest(value: unknown): value is WireRequest {
    if (!value || typeof value !== 'object') return false
    const request = value as Partial<WireRequest>
    return (
      typeof request.id === 'string' &&
      request.id.length > 0 &&
      request.id.length <= 128 &&
      typeof request.token === 'string' &&
      typeof request.clientId === 'string' &&
      request.clientId.length > 0 &&
      request.clientId.length <= 128 &&
      (request.method === 'tools/list' || request.method === 'tools/call') &&
      Boolean(request.params) &&
      typeof request.params === 'object' &&
      !Array.isArray(request.params)
    )
  }

  private failure(
    id: string,
    code: CapabilityErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): WireFailure {
    return { id, ok: false, error: { code, message, ...(details ? { details } : {}) } }
  }

  private write(socket: Socket, value: unknown): void {
    if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`)
  }
}
