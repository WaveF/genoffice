import { test, expect } from '@playwright/test'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

async function requestSheetsRenderer(
  app: Parameters<typeof waitForPageWithUrl>[0],
  webContentsId: number,
  action: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const requestId = `e2e-mcp-${action}-${Date.now()}`
  return app.evaluate(({ ipcMain, webContents }, payload) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('mcp:renderer-response', listener)
      reject(new Error(`Timed out waiting for ${payload.action}`))
    }, 15_000)
    const listener = (event: Electron.IpcMainEvent, response: unknown) => {
      if (event.sender.id !== payload.webContentsId) return
      if (!response || typeof response !== 'object' || (response as { requestId?: unknown }).requestId !== payload.requestId) return
      clearTimeout(timeout)
      ipcMain.removeListener('mcp:renderer-response', listener)
      resolve(response)
    }
    ipcMain.on('mcp:renderer-response', listener)
    const target = webContents.fromId(payload.webContentsId)
    if (!target || target.isDestroyed()) {
      clearTimeout(timeout)
      ipcMain.removeListener('mcp:renderer-response', listener)
      reject(new Error('Sheets renderer is unavailable'))
      return
    }
    target.send('mcp:renderer-request', {
      requestId: payload.requestId,
      action: payload.action,
      input: payload.input,
    })
  }), { webContentsId, requestId, action, input }) as Promise<{ ok: boolean; result?: unknown; error?: string }>
}

test.describe('sheets: MCP renderer IPC', () => {
  test('routes bounded read and transactional write requests over the fixed Electron channel', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'sheets-mcp-renderer' })
    try {
      await launched.page.locator('.quick-card').nth(1).click()
      const sheets = await waitForPageWithUrl(launched.app, 'sheets/out')
      await sheets.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, { timeout: 30_000 })
      const webContentsId = await launched.app.evaluate(({ webContents }) =>
        webContents.getAllWebContents().find((contents) => contents.getURL().includes('sheets/out'))?.id,
      )
      if (!webContentsId) throw new Error('Sheets renderer was not found')

      const context = await requestSheetsRenderer(launched.app, webContentsId, 'sheets.get_workbook_context', {})
      expect(context).toMatchObject({ ok: true, result: { revision: 0, sheets: [{ name: 'Sheet1' }] } })

      const write = await requestSheetsRenderer(launched.app, webContentsId, 'sheets.apply_operations', {
        expectedRevision: 0,
        transactionId: 'e2e-set-a1',
        summary: 'Set A1 through MCP',
        operations: [{ op: 'set_cell', sheetId: 'sheet-1', address: 'A1', value: 'MCP' }],
      })
      expect(write).toMatchObject({ ok: true, result: { dryRun: false, changes: { cells: 1 } } })
      const revision = (write.result as { revision?: unknown } | undefined)?.revision
      expect(revision).toEqual(expect.any(Number))

      const read = await requestSheetsRenderer(launched.app, webContentsId, 'sheets.read_range', {
        sheetId: 'sheet-1', range: 'A1:A1',
      })
      expect(read).toMatchObject({ ok: true, result: { revision, cells: [{ address: 'A1', value: 'MCP' }] } })
    } finally {
      await closeAndSaveVideo(launched, 'sheets-mcp-renderer')
    }
  })
})
