import { randomUUID } from 'node:crypto'
import { ipcMain, webContents } from 'electron'
import type { WebContents } from 'electron'
import { CapabilityError } from '@genoffice/capabilities'

const REQUEST_CHANNEL = 'mcp:renderer-request'
const RESPONSE_CHANNEL = 'mcp:renderer-response'
const REVISION_CHANNEL = 'mcp:renderer-revision'
const MAX_RENDERER_RESULT_BYTES = 512 * 1024
const RENDERER_TIMEOUT_MS = 15_000
const revisions = new Map<number, number>()

async function waitForRendererLoad(contents: WebContents): Promise<void> {
  if (!contents.isLoadingMainFrame()) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(
        new CapabilityError(
          'renderer_unavailable',
          'Document renderer did not finish loading in time',
        ),
      )
    }, RENDERER_TIMEOUT_MS)
    const onLoad = () => {
      cleanup()
      resolve()
    }
    const onDestroyed = () => {
      cleanup()
      reject(new CapabilityError('renderer_unavailable', 'Document renderer is unavailable'))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      contents.removeListener('did-finish-load', onLoad)
      contents.removeListener('destroyed', onDestroyed)
    }
    contents.once('did-finish-load', onLoad)
    contents.once('destroyed', onDestroyed)
  })
}

export function rendererMcpRevision(webContentsId: number): number {
  return revisions.get(webContentsId) ?? 0
}

export type RendererMcpAction =
  | 'docs.get_context'
  | 'docs.read_blocks'
  | 'docs.insert_content'
  | 'docs.replace_blocks'
  | 'docs.apply_commands'
  | 'markdown.get_context'
  | 'markdown.read_blocks'
  | 'markdown.insert_content'
  | 'markdown.replace_blocks'
  | 'markdown.set_source'
  | 'markdown.apply_commands'
  | 'markdown.insert_image'
  | 'sheets.get_workbook_context'
  | 'sheets.read_range'
  | 'sheets.find'
  | 'sheets.aggregate'
  | 'sheets.trace_formula'
  | 'sheets.apply_operations'
  | 'sheets.undo'
  | 'pdf.get_document_context'
  | 'pdf.read_page_context'
  | 'pdf.search'
  | 'pdf.read_annotations'
  | 'pdf.apply_operations'

interface PendingRequest {
  webContentsId: number
  resolve: (result: unknown) => void
  reject: (error: CapabilityError) => void
  timer: ReturnType<typeof setTimeout>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Main-process broker for a small, fixed renderer capability surface.
 * It intentionally uses no generic `invoke(channel, args)` escape hatch.
 */
export class RendererMcpBridge {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly readyWebContents = new Set<number>()
  private readonly readyWaiters = new Map<number, Set<() => void>>()

  constructor() {
    ipcMain.on(RESPONSE_CHANNEL, (event, response: unknown) =>
      this.receive(event.sender.id, response),
    )
    ipcMain.on(REVISION_CHANNEL, (event, revision: unknown) => {
      if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0) {
        // A renderer reload recreates its local tracker at zero while the
        // document (and its opaque MCP ID) remains alive. Never let that
        // lifecycle event make a previously valid CAS revision reusable.
        revisions.set(event.sender.id, Math.max(revisions.get(event.sender.id) ?? 0, revision))
      }
    })
    ipcMain.on('mcp:renderer-ready', (event) => {
      const webContentsId = event.sender.id
      this.readyWebContents.add(webContentsId)
      for (const resolve of this.readyWaiters.get(webContentsId) ?? []) resolve()
      this.readyWaiters.delete(webContentsId)
    })
  }

  async request(
    webContentsId: number,
    action: RendererMcpAction,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw new CapabilityError('cancelled', 'MCP request was cancelled')
    const contents = webContents.fromId(webContentsId)
    if (!contents || contents.isDestroyed()) {
      throw new CapabilityError('renderer_unavailable', 'Document renderer is unavailable')
    }
    await waitForRendererLoad(contents)
    await this.waitUntilReady(contents, signal)
    if (contents.isDestroyed()) {
      throw new CapabilityError('renderer_unavailable', 'Document renderer is unavailable')
    }
    const requestId = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const abort = () => this.reject(requestId, 'cancelled', 'MCP request was cancelled')
      const timer = setTimeout(
        () =>
          this.reject(
            requestId,
            'renderer_unavailable',
            'Document renderer did not respond in time',
          ),
        RENDERER_TIMEOUT_MS,
      )
      this.pending.set(requestId, {
        webContentsId,
        resolve: (result) => {
          signal.removeEventListener('abort', abort)
          resolve(result)
        },
        reject: (error) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        },
        timer,
      })
      signal.addEventListener('abort', abort, { once: true })
      try {
        contents.send(REQUEST_CHANNEL, { requestId, action, input })
      } catch {
        this.reject(requestId, 'renderer_unavailable', 'Document renderer is unavailable')
      }
    })
  }

  private async waitUntilReady(contents: WebContents, signal: AbortSignal): Promise<void> {
    if (this.readyWebContents.has(contents.id)) return
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          cleanup(
            new CapabilityError(
              'renderer_unavailable',
              'Document renderer did not become MCP-ready in time',
            ),
          ),
        RENDERER_TIMEOUT_MS,
      )
      const onAbort = () => cleanup(new CapabilityError('cancelled', 'MCP request was cancelled'))
      const onDestroyed = () =>
        cleanup(new CapabilityError('renderer_unavailable', 'Document renderer is unavailable'))
      const onReady = () => cleanup()
      const cleanup = (error?: CapabilityError) => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
        contents.removeListener('destroyed', onDestroyed)
        this.readyWaiters.get(contents.id)?.delete(onReady)
        if (error) reject(error)
        else resolve()
      }
      const waiters = this.readyWaiters.get(contents.id) ?? new Set<() => void>()
      waiters.add(onReady)
      this.readyWaiters.set(contents.id, waiters)
      signal.addEventListener('abort', onAbort, { once: true })
      contents.once('destroyed', onDestroyed)
    })
  }

  private receive(senderId: number, response: unknown): void {
    if (!isRecord(response) || typeof response.requestId !== 'string') return
    const request = this.pending.get(response.requestId)
    if (!request || request.webContentsId !== senderId) return
    if (response.ok !== true) {
      this.reject(
        response.requestId,
        'renderer_unavailable',
        typeof response.error === 'string'
          ? response.error
          : 'Document renderer rejected the request',
      )
      return
    }
    let encoded: string
    try {
      encoded = JSON.stringify(response.result)
    } catch {
      this.reject(
        response.requestId,
        'validation_error',
        'Document renderer returned an invalid result',
      )
      return
    }
    if (Buffer.byteLength(encoded, 'utf8') > MAX_RENDERER_RESULT_BYTES) {
      this.reject(
        response.requestId,
        'validation_error',
        'Document renderer response exceeds the MCP size limit',
      )
      return
    }
    if (
      isRecord(response.result) &&
      typeof response.result.revision === 'number' &&
      Number.isSafeInteger(response.result.revision) &&
      response.result.revision >= 0
    ) {
      revisions.set(senderId, Math.max(revisions.get(senderId) ?? 0, response.result.revision))
    }
    this.pending.delete(response.requestId)
    clearTimeout(request.timer)
    request.resolve(response.result)
  }

  private reject(
    requestId: string,
    code: 'cancelled' | 'renderer_unavailable' | 'validation_error',
    message: string,
  ): void {
    const request = this.pending.get(requestId)
    if (!request) return
    this.pending.delete(requestId)
    clearTimeout(request.timer)
    request.reject(new CapabilityError(code, message))
  }
}
