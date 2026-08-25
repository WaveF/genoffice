import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, send, fromId } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: { id: number } }, payload: unknown) => void>(),
  send: vi.fn(),
  fromId: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { on: (channel: string, handler: (event: { sender: { id: number } }, payload: unknown) => void) => handlers.set(channel, handler) },
  webContents: { fromId },
}))

import { RendererMcpBridge } from '../src/main/mcp/renderer-bridge'

describe('RendererMcpBridge', () => {
  beforeEach(() => {
    handlers.clear()
    send.mockReset()
    fromId.mockReset()
    fromId.mockReturnValue({ isDestroyed: () => false, send })
  })

  it('accepts a response only from the requested renderer', async () => {
    const bridge = new RendererMcpBridge()
    const pending = bridge.request(7, 'pdf.read_annotations', { page: 0 }, new AbortController().signal)
    const { requestId } = send.mock.calls[0]![1] as { requestId: string }
    handlers.get('mcp:renderer-response')!({ sender: { id: 8 } }, { requestId, ok: true, result: { bad: true } })
    handlers.get('mcp:renderer-response')!({ sender: { id: 7 } }, { requestId, ok: true, result: { ok: true } })
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it('cancels an in-flight renderer request', async () => {
    const bridge = new RendererMcpBridge()
    const controller = new AbortController()
    const pending = bridge.request(7, 'docs.get_context', {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('rejects a request when the document renderer was already destroyed', async () => {
    fromId.mockReturnValue({ isDestroyed: () => true, send })
    const bridge = new RendererMcpBridge()
    await expect(bridge.request(7, 'sheets.read_range', { sheetId: 's1', range: 'A1' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'renderer_unavailable' })
    expect(send).not.toHaveBeenCalled()
  })
})
