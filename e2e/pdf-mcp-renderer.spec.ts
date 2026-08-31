import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication } from '@playwright/test'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

function minimalPdf(): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefStart = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

async function requestPdfRenderer(
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
          reject(new Error('PDF renderer is unavailable'))
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

test.describe('pdf: MCP renderer IPC', () => {
  test('routes document context, bounded annotation write, and annotation read over Electron IPC', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexoffice-pdf-mcp-'))
    const pdfPath = join(directory, 'document.pdf')
    await writeFile(pdfPath, minimalPdf())
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'pdf-mcp-renderer',
      openFile: pdfPath,
    })
    try {
      const pdf = await waitForPageWithUrl(launched.app, 'pdf/out')
      await expect(pdf.locator('.pdf-page').first()).toBeVisible()
      const webContentsId = await launched.app.evaluate(
        ({ webContents }) =>
          webContents.getAllWebContents().find((contents) => contents.getURL().includes('pdf/out'))
            ?.id,
      )
      if (!webContentsId) throw new Error('PDF renderer was not found')

      const context = await requestPdfRenderer(
        launched.app,
        webContentsId,
        'pdf.get_document_context',
        {},
      )
      expect(context).toMatchObject({ ok: true, result: { pageCount: 1, pages: [{ index: 0 }] } })

      const write = await requestPdfRenderer(launched.app, webContentsId, 'pdf.apply_operations', {
        expectedRevision: 0,
        operations: [{ op: 'add_note', page: 0, x: 100, y: 100, contents: 'MCP review' }],
      })
      expect(write).toMatchObject({
        ok: true,
        result: { dryRun: false, revision: 1, changes: { notes: 1 } },
      })
      await pdf.waitForTimeout(100)

      const annotations = await requestPdfRenderer(
        launched.app,
        webContentsId,
        'pdf.read_annotations',
        { page: 0 },
      )
      expect(annotations).toMatchObject({
        ok: true,
        result: {
          revision: 1,
          page: 0,
          annotations: [
            expect.objectContaining({ kind: 'note', contents: 'MCP review', pending: true }),
          ],
        },
      })

      await launched.app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = (async () => ({
          canceled: true,
          filePaths: [],
        })) as typeof dialog.showOpenDialog
      })
      const canceledReplace = await requestPdfRenderer(
        launched.app,
        webContentsId,
        'pdf.apply_operations',
        {
          expectedRevision: 1,
          operations: [{ op: 'replace_pages', pages: [0] }],
        },
      )
      expect(canceledReplace).toMatchObject({ ok: false, error: 'Page replacement was cancelled' })

      const split = await requestPdfRenderer(launched.app, webContentsId, 'pdf.apply_operations', {
        expectedRevision: 1,
        operations: [{ op: 'split_pages', perPage: 2 }],
      })
      expect(split).toMatchObject({
        ok: true,
        result: { dryRun: false, revision: 2, changes: { pageFiles: 1 } },
      })

      const merge = await requestPdfRenderer(launched.app, webContentsId, 'pdf.apply_operations', {
        expectedRevision: 2,
        operations: [{ op: 'merge_pages', perSheet: 2, direction: 'vertical', separator: false }],
      })
      expect(merge).toMatchObject({
        ok: true,
        result: { dryRun: false, revision: 3, changes: { pageFiles: 1 } },
      })
    } finally {
      await closeAndSaveVideo(launched, 'pdf-mcp-renderer')
    }
  })
})
