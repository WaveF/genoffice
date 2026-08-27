import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, send, fromId } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: { id: number } }, payload: unknown) => void>(),
  send: vi.fn(),
  fromId: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: { sender: { id: number } }, payload: unknown) => void) =>
      handlers.set(channel, handler),
  },
  webContents: { fromId },
}))

import { RendererMcpBridge } from '../src/main/mcp/renderer-bridge'

describe('RendererMcpBridge', () => {
  beforeEach(() => {
    handlers.clear()
    send.mockReset()
    fromId.mockReset()
    fromId.mockReturnValue({
      id: 7,
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      once: vi.fn(),
      removeListener: vi.fn(),
      send,
    })
  })

  function markRendererReady(id = 7): void {
    handlers.get('mcp:renderer-ready')!({ sender: { id } }, undefined)
  }

  it('accepts a response only from the requested renderer', async () => {
    const bridge = new RendererMcpBridge()
    markRendererReady()
    const pending = bridge.request(
      7,
      'pdf.read_annotations',
      { page: 0 },
      new AbortController().signal,
    )
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const { requestId } = send.mock.calls[0]![1] as { requestId: string }
    handlers.get('mcp:renderer-response')!(
      { sender: { id: 8 } },
      { requestId, ok: true, result: { bad: true } },
    )
    handlers.get('mcp:renderer-response')!(
      { sender: { id: 7 } },
      { requestId, ok: true, result: { ok: true } },
    )
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it('cancels an in-flight PDF renderer request and ignores its late response', async () => {
    const bridge = new RendererMcpBridge()
    markRendererReady()
    const controller = new AbortController()
    const pending = bridge.request(7, 'pdf.search', { query: 'budget' }, controller.signal)
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const { requestId } = send.mock.calls[0]![1] as { requestId: string }
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    handlers.get('mcp:renderer-response')!(
      { sender: { id: 7 } },
      { requestId, ok: true, result: { stale: true } },
    )
  })

  it('rejects a request when the document renderer was already destroyed', async () => {
    fromId.mockReturnValue({ isDestroyed: () => true, send })
    const bridge = new RendererMcpBridge()
    await expect(
      bridge.request(
        7,
        'sheets.read_range',
        { sheetId: 's1', range: 'A1' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'renderer_unavailable' })
    expect(send).not.toHaveBeenCalled()
  })

  it('waits for a renderer-ready signal before sending a request', async () => {
    const bridge = new RendererMcpBridge()
    const pending = bridge.request(7, 'markdown.get_context', {}, new AbortController().signal)
    expect(send).not.toHaveBeenCalled()
    markRendererReady()
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const { requestId } = send.mock.calls[0]![1] as { requestId: string }
    handlers.get('mcp:renderer-response')!(
      { sender: { id: 7 } },
      { requestId, ok: true, result: {} },
    )
    await expect(pending).resolves.toEqual({})
  })
})
