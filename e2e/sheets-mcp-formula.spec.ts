import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication } from '@playwright/test'
import { buildEditFixture } from '../apps/sheets/tests/fixture-builder'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

async function requestSheetsRenderer(
  app: ElectronApplication,
  webContentsId: number,
  action: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const requestId = `e2e-mcp-${action}-${Date.now()}`
  return app.evaluate(
    ({ ipcMain, webContents }, payload) =>
      new Promise((resolve, reject) => {
        const listener = (event: Electron.IpcMainEvent, response: unknown) => {
          if (event.sender.id !== payload.webContentsId) return
          if (
            !response ||
            typeof response !== 'object' ||
            (response as { requestId?: unknown }).requestId !== payload.requestId
          )
            return
          clearTimeout(timeout)
          ipcMain.removeListener('mcp:renderer-response', listener)
          resolve(response)
        }
        const timeout = setTimeout(() => {
          ipcMain.removeListener('mcp:renderer-response', listener)
          reject(new Error(`Timed out waiting for ${payload.action}`))
        }, 15_000)
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
      }),
    { webContentsId, requestId, action, input },
  ) as Promise<{ ok: boolean; result?: unknown; error?: string }>
}

test.describe('sheets: imported workbook MCP formulas', () => {
  test('writes a formula and reads its recalculated live value over Electron IPC', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexoffice-sheets-mcp-formula-'))
    const workbookPath = join(directory, 'formula.xlsx')
    await writeFile(workbookPath, await buildEditFixture())
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-mcp-formula',
      openFile: workbookPath,
    })
    try {
      const sheets = await waitForPageWithUrl(launched.app, 'sheets/out')
      await sheets.waitForFunction(() => document.body.textContent?.includes('Data'), null, {
        timeout: 30_000,
      })
      const webContentsId = await launched.app.evaluate(
        ({ webContents }) =>
          webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().includes('sheets/out'))?.id,
      )
      if (!webContentsId) throw new Error('Sheets renderer was not found')

      await expect
        .poll(
          async () => {
            const result = await requestSheetsRenderer(
              launched.app,
              webContentsId,
              'sheets.get_workbook_context',
              {},
            )
            return (result.result as { sheets?: Array<{ name?: unknown }> } | undefined)
              ?.sheets?.[0]?.name
          },
          { timeout: 30_000 },
        )
        .toBe('Data')
      const context = await requestSheetsRenderer(
        launched.app,
        webContentsId,
        'sheets.get_workbook_context',
        {},
      )
      expect(context).toMatchObject({
        ok: true,
        result: { revision: 0, sheets: [{ name: 'Data' }] },
      })
      const sheetId = (context.result as { sheets?: Array<{ id?: unknown }> } | undefined)
        ?.sheets?.[0]?.id
      if (typeof sheetId !== 'string') throw new Error('Imported sheet id is unavailable')

      const formatted = await requestSheetsRenderer(
        launched.app,
        webContentsId,
        'sheets.read_range',
        {
          sheetId,
          range: 'A1:A1',
        },
      )
      expect(formatted).toMatchObject({
        ok: true,
        result: { cells: [{ address: 'A1', value: 'Hello', format: { bold: true } }] },
      })

      const write = await requestSheetsRenderer(
        launched.app,
        webContentsId,
        'sheets.apply_operations',
        {
          expectedRevision: 0,
          transactionId: 'e2e-formula-b1',
          summary: 'Calculate B1 from C1',
          operations: [{ op: 'set_formula', sheetId, address: 'B1', formula: '=C1*2' }],
        },
      )
      expect(write).toMatchObject({ ok: true, result: { dryRun: false, changes: { cells: 1 } } })
      const revision = (write.result as { revision?: unknown } | undefined)?.revision
      expect(revision).toEqual(expect.any(Number))

      await expect
        .poll(
          async () => {
            const read = await requestSheetsRenderer(
              launched.app,
              webContentsId,
              'sheets.read_range',
              {
                sheetId,
                range: 'B1:B1',
              },
            )
            return (read.result as { cells?: Array<{ value?: unknown }> } | undefined)?.cells?.[0]
              ?.value
          },
          { timeout: 10_000 },
        )
        .toBe(10)
      const read = await requestSheetsRenderer(launched.app, webContentsId, 'sheets.read_range', {
        sheetId,
        range: 'B1:B1',
      })
      expect(read).toMatchObject({
        ok: true,
        result: { revision, cells: [{ address: 'B1', formula: '=C1*2', value: 10 }] },
      })
    } finally {
      await closeAndSaveVideo(launched, 'sheets-mcp-formula')
    }
  })
})
