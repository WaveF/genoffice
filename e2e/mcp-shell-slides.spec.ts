import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const MCP_ADAPTER = resolve(__dirname, '../packages/genoffice-mcp/dist/genoffice-mcp.mjs')
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

class StdioMcpClient {
  private readonly process: ChildProcessWithoutNullStreams
  private readonly pending = new Map<
    number,
    { resolve: (response: JsonRpcResponse) => void; reject: (error: Error) => void }
  >()
  private buffer = ''
  private nextId = 1

  constructor(discoveryPath: string) {
    this.process = spawn(process.execPath, [MCP_ADAPTER, '--discovery', discoveryPath], {
      stdio: 'pipe',
    })
    this.process.stdout.setEncoding('utf8')
    this.process.stdout.on('data', (chunk: string) => this.receive(chunk))
    this.process.once('error', (error) => this.rejectAll(error))
    this.process.once('close', () => this.rejectAll(new Error('MCP adapter closed')))
  }

  async request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++
    const response = new Promise<JsonRpcResponse>((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject })
    })
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return response
  }

  close(): void {
    this.process.kill()
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const response = JSON.parse(line) as JsonRpcResponse
      const pending = this.pending.get(response.id)
      if (pending) {
        this.pending.delete(response.id)
        pending.resolve(response)
      }
      newline = this.buffer.indexOf('\n')
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (
      await access(path)
        .then(() => true)
        .catch(() => false)
    )
      return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error(`Timed out waiting for ${path}`)
}

function resultText(response: JsonRpcResponse): string {
  expect(response.error).toBeUndefined()
  const result = response.result as { content?: Array<{ type: string; text: string }> }
  const text = result.content?.[0]?.text
  if (typeof text !== 'string') throw new Error('MCP tool did not return text content')
  return text
}

async function requestUntilRendererReady(
  client: StdioMcpClient,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const response = await client.request('tools/call', { name, arguments: arguments_ })
    const result = response.result as { isError?: boolean } | undefined
    if (!result?.isError) return response
    const detail = JSON.parse(resultText(response)) as { code?: string }
    if (detail.code !== 'renderer_unavailable' || Date.now() >= deadline) return response
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
}

async function waitForDocumentRevision(
  client: StdioMcpClient,
  documentId: string,
  afterRevision: number,
): Promise<number> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const response = await client.request('tools/call', {
      name: 'get_document_status',
      arguments: { documentId },
    })
    const revision = (JSON.parse(resultText(response)) as { revision: number }).revision
    if (revision > afterRevision) return revision
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${documentId} revision after ${afterRevision}`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
}

test.describe('MCP stdio adapter + Shell bridge', () => {
  test('runs the complete Slides MCP flow against an inactive document through the real local bridge', async () => {
    const saveDir = await mkdtemp(join(tmpdir(), 'genoffice-mcp-slides-save-'))
    const launched = await launchShell({
      onboardingSeen: true,
      defaultSaveDir: saveDir,
      videoDir: 'mcp-shell-slides',
    })
    const discoveryPath = join(launched.userDataDir, 'mcp', 'bridge.json')
    let client: StdioMcpClient | undefined
    let competingClient: StdioMcpClient | undefined
    try {
      await waitForFile(discoveryPath)
      client = new StdioMcpClient(discoveryPath)

      const initialized = await client.request('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'genoffice-e2e' },
      })
      expect(initialized.result).toMatchObject({ serverInfo: { name: 'GenOffice' } })

      const tools = await client.request('tools/list', {})
      expect(tools.result).toMatchObject({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'create_document' }),
          expect.objectContaining({ name: 'slides.add_slide' }),
          expect.objectContaining({ name: 'undo' }),
          expect.objectContaining({ name: 'save_document' }),
        ]),
      })

      const primary = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'create_document',
            arguments: { kind: 'slides' },
          }),
        ),
      ) as { documentId: string; revision: number }
      expect(primary).toMatchObject({ documentId: expect.any(String), revision: 0 })

      // Creating another deck deliberately makes the target deck inactive. Every
      // subsequent read/write must still use primary.documentId, never the active tab.
      const secondary = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'create_document',
            arguments: { kind: 'slides' },
          }),
        ),
      ) as { documentId: string; revision: number }
      expect(secondary).toMatchObject({ documentId: expect.any(String), revision: 0 })
      expect(secondary.documentId).not.toBe(primary.documentId)

      const openDocuments = JSON.parse(
        resultText(
          await client.request('tools/call', { name: 'list_open_documents', arguments: {} }),
        ),
      ) as Array<{ documentId: string; active: boolean; kind: string }>
      expect(openDocuments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentId: primary.documentId,
            kind: 'slides',
            active: false,
          }),
          expect.objectContaining({
            documentId: secondary.documentId,
            kind: 'slides',
            active: true,
          }),
        ]),
      )

      const read = await client.request('tools/call', {
        name: 'slides.read_slide',
        arguments: { documentId: primary.documentId, slide: 0 },
      })
      expect(JSON.parse(resultText(read))).toMatchObject({ revision: 0, index: 0 })

      const dryRun = await client.request('tools/call', {
        name: 'slides.apply_ops',
        arguments: {
          documentId: primary.documentId,
          expectedRevision: 0,
          dryRun: true,
          ops: [{ op: 'setSlideSize', cx: 12192000, cy: 6858000 }],
        },
      })
      expect(JSON.parse(resultText(dryRun))).toMatchObject({
        applied: false,
        dryRun: true,
        revision: 0,
      })

      competingClient = new StdioMcpClient(discoveryPath)
      const competingInitialized = await competingClient.request('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'genoffice-e2e-competing-client' },
      })
      expect(competingInitialized.result).toMatchObject({ serverInfo: { name: 'GenOffice' } })

      const addSlideRequest = {
        name: 'slides.add_slide',
        arguments: { documentId: primary.documentId, expectedRevision: 0, afterSlide: 0 },
      }
      const addResults = await Promise.all([
        client.request('tools/call', addSlideRequest),
        competingClient.request('tools/call', addSlideRequest),
      ])
      const successfulAdds = addResults.filter(
        (response) => !(response.result as { isError?: boolean } | undefined)?.isError,
      )
      const conflictedAdds = addResults.filter(
        (response) => (response.result as { isError?: boolean } | undefined)?.isError,
      )
      expect(successfulAdds).toHaveLength(1)
      expect(JSON.parse(resultText(successfulAdds[0]))).toMatchObject({
        applied: true,
        revision: 1,
      })
      expect(conflictedAdds).toHaveLength(1)
      expect(conflictedAdds[0].result).toMatchObject({ isError: true })
      expect(JSON.parse(resultText(conflictedAdds[0]))).toMatchObject({ code: 'conflict' })

      const editedDeck = await client.request('tools/call', {
        name: 'slides.get_deck_context',
        arguments: { documentId: primary.documentId },
      })
      expect(JSON.parse(resultText(editedDeck))).toMatchObject({ revision: 1, slideCount: 2 })

      const untouchedDeck = await client.request('tools/call', {
        name: 'slides.get_deck_context',
        arguments: { documentId: secondary.documentId },
      })
      expect(JSON.parse(resultText(untouchedDeck))).toMatchObject({ revision: 0, slideCount: 1 })

      const undone = await client.request('tools/call', {
        name: 'undo',
        arguments: { documentId: primary.documentId, expectedRevision: 1 },
      })
      expect(JSON.parse(resultText(undone))).toMatchObject({ applied: true, revision: 2 })

      const restoredDeck = await client.request('tools/call', {
        name: 'slides.get_deck_context',
        arguments: { documentId: primary.documentId },
      })
      expect(JSON.parse(resultText(restoredDeck))).toMatchObject({ revision: 2, slideCount: 1 })

      const redone = await client.request('tools/call', {
        name: 'redo',
        arguments: { documentId: primary.documentId, expectedRevision: 2 },
      })
      expect(JSON.parse(resultText(redone))).toMatchObject({ applied: true, revision: 3 })

      const saved = await client.request('tools/call', {
        name: 'save_document',
        arguments: { documentId: primary.documentId, expectedRevision: 3 },
      })
      expect(JSON.parse(resultText(saved))).toMatchObject({ saved: true, revision: 3 })
      expect((await readdir(saveDir)).some((name) => name.endsWith('.pptx'))).toBe(true)
    } finally {
      competingClient?.close()
      client?.close()
      await closeAndSaveVideo(launched, 'mcp-shell-slides')
    }
  })

  test('routes each other declared document type through the real stdio adapter', async () => {
    const saveDir = await mkdtemp(join(tmpdir(), 'genoffice-mcp-documents-save-'))
    const launched = await launchShell({
      onboardingSeen: true,
      defaultSaveDir: saveDir,
      videoDir: 'mcp-shell-documents',
    })
    const discoveryPath = join(launched.userDataDir, 'mcp', 'bridge.json')
    let client: StdioMcpClient | undefined
    const rendererErrors: string[] = []
    launched.app.on('window', (page) => {
      page.on('pageerror', (error) => rendererErrors.push(error.message))
    })
    try {
      await waitForFile(discoveryPath)
      client = new StdioMcpClient(discoveryPath)
      await client.request('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'genoffice-e2e-document-types' },
      })

      const checks = [
        ['docs', 'docs.get_context', 'docs/out'],
        ['markdown', 'markdown.get_context', 'markdown/out'],
        ['sheets', 'sheets.get_workbook_context', 'sheets/out'],
        ['pdf', 'pdf.get_document_context', 'pdf/out'],
      ] as const
      for (const [kind, toolName, urlPart] of checks) {
        const created = JSON.parse(
          resultText(
            await client.request('tools/call', {
              name: 'create_document',
              arguments: { kind },
            }),
          ),
        ) as { documentId: string; kind: string }
        expect(created).toMatchObject({ documentId: expect.any(String), kind })

        const status = await client.request('tools/call', {
          name: 'get_document_status',
          arguments: { documentId: created.documentId },
        })
        expect(JSON.parse(resultText(status))).toMatchObject({
          documentId: created.documentId,
          kind,
        })

        const renderer = await waitForPageWithUrl(launched.app, urlPart)
        await expect(renderer.locator('body')).toBeVisible()
        if (kind === 'markdown') {
          try {
            await expect(renderer.locator('.doc-editor')).toBeVisible()
          } catch {
            throw new Error(
              `Markdown editor did not mount: ${JSON.stringify({
                body: await renderer.locator('body').innerText(),
                rendererErrors,
              })}`,
            )
          }
        }

        const context = await requestUntilRendererReady(client, toolName, {
          documentId: created.documentId,
        })
        if ((context.result as { isError?: boolean } | undefined)?.isError) {
          throw new Error(`${kind} context request failed: ${resultText(context)}`)
        }
        expect(JSON.parse(resultText(context))).toEqual(expect.any(Object))
      }
    } finally {
      client?.close()
      await closeAndSaveVideo(launched, 'mcp-shell-documents')
    }
  })

  test('applies Docs text edits and bounded undo/redo through the real bridge', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'mcp-shell-docs-write' })
    const discoveryPath = join(launched.userDataDir, 'mcp', 'bridge.json')
    let client: StdioMcpClient | undefined
    try {
      await waitForFile(discoveryPath)
      client = new StdioMcpClient(discoveryPath)
      await client.request('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'genoffice-e2e-docs-write' },
      })
      const created = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'create_document',
            arguments: { kind: 'docs' },
          }),
        ),
      ) as { documentId: string; revision: number }
      await waitForPageWithUrl(launched.app, 'docs/out')
      await requestUntilRendererReady(client, 'docs.get_context', {
        documentId: created.documentId,
      })
      const initialStatus = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'get_document_status',
            arguments: { documentId: created.documentId },
          }),
        ),
      ) as { revision: number }

      const inserted = await requestUntilRendererReady(client, 'docs.insert_content', {
        documentId: created.documentId,
        expectedRevision: initialStatus.revision,
        content: 'MCP Docs text',
      })
      const insertedRevision = JSON.parse(resultText(inserted)) as { revision: number }
      expect(insertedRevision, 'Docs insert response').toMatchObject({
        revision: expect.any(Number),
      })
      expect(insertedRevision.revision).toBeGreaterThan(created.revision)

      const stale = await client.request('tools/call', {
        name: 'docs.insert_content',
        arguments: {
          documentId: created.documentId,
          expectedRevision: initialStatus.revision,
          content: 'Stale text',
        },
      })
      expect(stale.result).toMatchObject({ isError: true })
      expect(JSON.parse(resultText(stale))).toMatchObject({ code: 'conflict' })

      const undone = await client.request('tools/call', {
        name: 'docs.apply_commands',
        arguments: {
          documentId: created.documentId,
          expectedRevision: insertedRevision.revision,
          commands: [{ op: 'undo' }],
        },
      })
      const undoneRevision = JSON.parse(resultText(undone)) as { revision: number }
      expect(undoneRevision.revision).toBeGreaterThan(insertedRevision.revision)

      const redone = await client.request('tools/call', {
        name: 'docs.apply_commands',
        arguments: {
          documentId: created.documentId,
          expectedRevision: undoneRevision.revision,
          commands: [{ op: 'redo' }],
        },
      })
      const redoneRevision = JSON.parse(resultText(redone)) as { revision: number }
      const blocks = await client.request('tools/call', {
        name: 'docs.read_blocks',
        arguments: { documentId: created.documentId },
      })
      expect(redoneRevision.revision).toBeGreaterThan(undoneRevision.revision)
      expect(JSON.parse(resultText(blocks))).toMatchObject({
        blocks: expect.arrayContaining([expect.objectContaining({ text: 'MCP Docs text' })]),
      })
    } finally {
      client?.close()
      await closeAndSaveVideo(launched, 'mcp-shell-docs-write')
    }
  })

  test('applies Markdown text edits and bounded undo/redo through the real bridge', async () => {
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'mcp-shell-markdown-write',
    })
    const discoveryPath = join(launched.userDataDir, 'mcp', 'bridge.json')
    let client: StdioMcpClient | undefined
    try {
      await waitForFile(discoveryPath)
      client = new StdioMcpClient(discoveryPath)
      await client.request('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'genoffice-e2e-markdown-write' },
      })
      const created = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'create_document',
            arguments: { kind: 'markdown' },
          }),
        ),
      ) as { documentId: string }
      await waitForPageWithUrl(launched.app, 'markdown/out')
      await requestUntilRendererReady(client, 'markdown.get_context', {
        documentId: created.documentId,
      })
      const initialStatus = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'get_document_status',
            arguments: { documentId: created.documentId },
          }),
        ),
      ) as { revision: number }

      const inserted = await client.request('tools/call', {
        name: 'markdown.insert_content',
        arguments: {
          documentId: created.documentId,
          expectedRevision: initialStatus.revision,
          content: 'MCP Markdown text',
        },
      })
      const insertedRevision = JSON.parse(resultText(inserted)) as { revision: number }
      expect(insertedRevision.revision).toBeGreaterThan(initialStatus.revision)

      const stale = await client.request('tools/call', {
        name: 'markdown.insert_content',
        arguments: {
          documentId: created.documentId,
          expectedRevision: initialStatus.revision,
          content: 'Stale text',
        },
      })
      expect(stale.result).toMatchObject({ isError: true })
      expect(JSON.parse(resultText(stale))).toMatchObject({ code: 'conflict' })

      const undone = await client.request('tools/call', {
        name: 'markdown.apply_commands',
        arguments: {
          documentId: created.documentId,
          expectedRevision: insertedRevision.revision,
          commands: [{ op: 'undo' }],
        },
      })
      const undoneRevision = JSON.parse(resultText(undone)) as { revision: number }
      const redone = await client.request('tools/call', {
        name: 'markdown.apply_commands',
        arguments: {
          documentId: created.documentId,
          expectedRevision: undoneRevision.revision,
          commands: [{ op: 'redo' }],
        },
      })
      const redoneRevision = JSON.parse(resultText(redone)) as { revision: number }
      const blocks = await client.request('tools/call', {
        name: 'markdown.read_blocks',
        arguments: { documentId: created.documentId },
      })
      expect(redoneRevision.revision).toBeGreaterThan(undoneRevision.revision)
      expect(JSON.parse(resultText(blocks))).toMatchObject({
        blocks: expect.arrayContaining([expect.objectContaining({ text: 'MCP Markdown text' })]),
      })
    } finally {
      client?.close()
      await closeAndSaveVideo(launched, 'mcp-shell-markdown-write')
    }
  })

  test('replaces complete Markdown source through the real bridge and preserves it after save/reload', async () => {
    const saveDir = await mkdtemp(join(tmpdir(), 'genoffice-mcp-markdown-source-save-'))
    const launched = await launchShell({
      onboardingSeen: true,
      defaultSaveDir: saveDir,
      videoDir: 'mcp-shell-markdown-source',
    })
    const discoveryPath = join(launched.userDataDir, 'mcp', 'bridge.json')
    let client: StdioMcpClient | undefined
    try {
      await waitForFile(discoveryPath)
      client = new StdioMcpClient(discoveryPath)
      await client.request('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'genoffice-e2e-markdown-source' },
      })
      const created = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'create_document',
            arguments: { kind: 'markdown' },
          }),
        ),
      ) as { documentId: string }
      const markdown = await waitForPageWithUrl(launched.app, 'markdown/out')
      await requestUntilRendererReady(client, 'markdown.get_context', {
        documentId: created.documentId,
      })
      const initial = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'get_document_status',
            arguments: { documentId: created.documentId },
          }),
        ),
      ) as { revision: number }
      const source =
        '# Source title\n\n- first item\n- second item\n\n> source quote\n\n| Name | Value |\n| --- | --- |\n| source | 1 |\n\n- [ ] follow up'
      const replaced = await client.request('tools/call', {
        name: 'markdown.set_source',
        arguments: {
          documentId: created.documentId,
          expectedRevision: initial.revision,
          source,
        },
      })
      const replacedRevision = JSON.parse(resultText(replaced)) as { revision: number }
      expect(replacedRevision.revision).toBeGreaterThan(initial.revision)

      const stale = await client.request('tools/call', {
        name: 'markdown.set_source',
        arguments: { documentId: created.documentId, expectedRevision: initial.revision, source: '# stale' },
      })
      expect(stale.result).toMatchObject({ isError: true })
      expect(JSON.parse(resultText(stale))).toMatchObject({ code: 'conflict' })

      const undone = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'markdown.apply_commands',
            arguments: {
              documentId: created.documentId,
              expectedRevision: replacedRevision.revision,
              commands: [{ op: 'undo' }],
            },
          }),
        ),
      ) as { revision: number }
      const redone = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'markdown.apply_commands',
            arguments: {
              documentId: created.documentId,
              expectedRevision: undone.revision,
              commands: [{ op: 'redo' }],
            },
          }),
        ),
      ) as { revision: number }
      expect(redone.revision).toBeGreaterThan(undone.revision)

      await markdown.keyboard.press('ControlOrMeta+s')
      const savedFile = (await readdir(saveDir)).find((file) => file.endsWith('.md'))
      expect(savedFile).toBeDefined()
      const saved = await readFile(join(saveDir, savedFile!), 'utf8')
      expect(saved).toContain('# Source title')
      expect(saved).toContain('- first item')
      expect(saved).toContain('- [ ] follow up')

      // Source mode deliberately owns unsynchronized raw text. The renderer
      // rejects all MCP access instead of applying a change behind the user's
      // textarea, and leaving source mode restores normal MCP availability.
      await markdown.getByLabel('Edit Markdown source').click()
      await expect(markdown.getByLabel('Markdown source')).toHaveValue(/# Source title/)
      const blocked = await client.request('tools/call', {
        name: 'markdown.insert_content',
        arguments: {
          documentId: created.documentId,
          expectedRevision: redone.revision,
          content: 'must not be inserted',
        },
      })
      expect(blocked.result).toMatchObject({ isError: true })
      expect(JSON.parse(resultText(blocked))).toMatchObject({
        code: 'renderer_unavailable',
        message: expect.stringContaining('source mode'),
      })
      await expect(markdown.getByLabel('Markdown source')).toHaveValue(/# Source title/)
      await markdown.getByLabel('Switch to rich text').click()

      await markdown.reload()
      const deadline = Date.now() + 15_000
      let reloaded: JsonRpcResponse | undefined
      for (;;) {
        const candidate = await requestUntilRendererReady(client, 'markdown.read_blocks', {
          documentId: created.documentId,
        })
        const parsed = JSON.parse(resultText(candidate)) as { blocks?: unknown[] }
        if (parsed.blocks?.length || Date.now() >= deadline) {
          reloaded = candidate
          break
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      }
      expect(JSON.parse(resultText(reloaded!))).toMatchObject({
        blocks: expect.arrayContaining([
          expect.objectContaining({ text: '# Source title' }),
          expect.objectContaining({ text: '- first item\n- second item' }),
        ]),
      })
      const statusAfterReload = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'get_document_status',
            arguments: { documentId: created.documentId },
          }),
        ),
      ) as { revision: number }
      expect(statusAfterReload.revision).toBe(redone.revision)
    } finally {
      client?.close()
      await closeAndSaveVideo(launched, 'mcp-shell-markdown-source')
    }
  })

  test('imports one staged image into Markdown owned assets through the real bridge', async () => {
    const saveDir = await mkdtemp(join(tmpdir(), 'genoffice-mcp-markdown-media-save-'))
    const launched = await launchShell({
      onboardingSeen: true,
      defaultSaveDir: saveDir,
      videoDir: 'mcp-shell-markdown-media',
    })
    const discoveryPath = join(launched.userDataDir, 'mcp', 'bridge.json')
    let client: StdioMcpClient | undefined
    try {
      await waitForFile(discoveryPath)
      const discovery = JSON.parse(await readFile(discoveryPath, 'utf8')) as {
        mediaImportDirectory?: string
      }
      expect(discovery.mediaImportDirectory).toEqual(expect.any(String))
      const importDirectory = discovery.mediaImportDirectory!
      const stagedPath = join(importDirectory, 'agent-image.png')
      await writeFile(stagedPath, PNG_1PX)

      client = new StdioMcpClient(discoveryPath)
      await client.request('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'genoffice-e2e-markdown-media' },
      })
      const staged = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'media.stage_image',
            arguments: { fileName: 'agent-image.png' },
          }),
        ),
      ) as { mediaHandle: string; mimeType: string }
      expect(staged).toMatchObject({ mediaHandle: expect.any(String), mimeType: 'image/png' })
      await expect(access(stagedPath)).rejects.toThrow()

      const created = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'create_document',
            arguments: { kind: 'markdown' },
          }),
        ),
      ) as { documentId: string }
      const markdown = await waitForPageWithUrl(launched.app, 'markdown/out')
      await requestUntilRendererReady(client, 'markdown.get_context', {
        documentId: created.documentId,
      })
      const status = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'get_document_status',
            arguments: { documentId: created.documentId },
          }),
        ),
      ) as { revision: number }
      const inserted = await client.request('tools/call', {
        name: 'markdown.insert_image',
        arguments: {
          documentId: created.documentId,
          expectedRevision: status.revision,
          mediaHandle: staged.mediaHandle,
          alt: 'Generated image',
        },
      })
      expect(JSON.parse(resultText(inserted))).toMatchObject({
        src: expect.stringMatching(/^assets\//),
      })
      await expect(markdown.locator('.doc-editor img[alt="Generated image"]')).toBeVisible()
      const insertedRevision = await waitForDocumentRevision(
        client,
        created.documentId,
        status.revision,
      )
      await markdown.keyboard.press('ControlOrMeta+s')

      const files = await readdir(saveDir)
      const markdownFile = files.find((file) => file.endsWith('.md'))
      expect(markdownFile).toBeDefined()
      const markdownText = await readFile(join(saveDir, markdownFile!), 'utf8')
      expect(markdownText).toContain('![Generated image](assets/')
      const assets = await readdir(join(saveDir, 'assets'))
      expect(assets.some((file) => file.endsWith('.png'))).toBe(true)

      // Re-open the renderer from the saved document. The image source must
      // remain relative to this document's owned assets directory, never to
      // the one-shot MCP staging directory.
      await markdown.reload()
      await expect(markdown.locator('.doc-editor img[alt="Generated image"]')).toBeVisible()
      const reloaded = await requestUntilRendererReady(client, 'markdown.get_context', {
        documentId: created.documentId,
      })
      expect(JSON.parse(resultText(reloaded))).toMatchObject({
        revision: expect.any(Number),
        preview: expect.arrayContaining([
          expect.objectContaining({ text: '![Generated image](assets/agent-image.png)' }),
        ]),
      })
      const reloadedStatus = JSON.parse(
        resultText(
          await client.request('tools/call', {
            name: 'get_document_status',
            arguments: { documentId: created.documentId },
          }),
        ),
      ) as { revision: number }
      expect(reloadedStatus.revision).toBe(insertedRevision)
    } finally {
      client?.close()
      await closeAndSaveVideo(launched, 'mcp-shell-markdown-media')
    }
  })
})
