import { describe, expect, it } from 'vitest'
import { CapabilityError, type DocumentTarget } from '@genoffice/capabilities'
import {
  ShellMcpGateway,
  type DocumentTargetSource,
  type McpDocumentFactory,
  type RendererMcpReader,
  type SlidesMcpReader,
} from '../src/main/mcp/gateway'
import type { McpPermissionGate } from '../src/main/mcp/permissions'
import type { McpAuditLogger } from '../src/main/mcp/audit'

const target: DocumentTarget = {
  documentId: 'doc-123',
  kind: 'slides',
  title: 'Quarterly review',
  revision: 3,
  dirty: true,
  active: false,
  webContentsId: 42,
}

function gatewayWith(
  documents: DocumentTarget[] = [target],
  permissions: McpPermissionGate = { authorize: async () => undefined },
  documentFactory?: McpDocumentFactory,
  audit?: McpAuditLogger,
): ShellMcpGateway {
  const source: DocumentTargetSource = {
    listDocumentTargets: async () => documents,
    findDocumentTarget: async (documentId) =>
      documents.find((candidate) => candidate.documentId === documentId) ?? null,
    activateDocument: async (documentId) => {
      const found = documents.find((candidate) => candidate.documentId === documentId) ?? null
      return found ? { ...found, active: true } : null
    },
  }
  const slides: SlidesMcpReader = {
    getDeckContext: () => ({ revision: 3, slideCount: 1, slides: [{ slideId: 's_1', index: 0 }] }),
    readSlide: (_webContentsId, slide) => ({ revision: 3, slide }),
    renderSlidePreview: async (_webContentsId, slide) => ({
      revision: 3,
      slide,
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
    }),
  }
  const renderer: RendererMcpReader = {
    request: async (_webContentsId, action, input) => ({ action, input, blocks: [] }),
  }
  return new ShellMcpGateway(
    source,
    {
      ...slides,
      opsRisk: () => 'write',
      applyOps: (_webContentsId, _ops, expectedRevision, dryRun) => ({
        applied: !dryRun,
        revision: expectedRevision + (dryRun ? 0 : 1),
      }),
      undo: (_webContentsId, expectedRevision) => ({
        applied: true,
        revision: expectedRevision + 1,
      }),
      redo: (_webContentsId, expectedRevision) => ({
        applied: true,
        revision: expectedRevision + 1,
      }),
      save: async (_webContentsId, expectedRevision) => ({
        saved: true,
        revision: expectedRevision,
      }),
      addSlide: (_webContentsId, _afterSlide, expectedRevision) => ({
        applied: true,
        revision: expectedRevision + 1,
      }),
      deleteSlide: (_webContentsId, _slide, expectedRevision) => ({
        applied: true,
        revision: expectedRevision + 1,
      }),
    },
    permissions,
    audit,
    renderer,
    documentFactory,
  )
}

function request(params: Record<string, unknown>) {
  return {
    clientId: 'test-client',
    requestId: 'test-request',
    method: 'tools/call' as const,
    params,
    signal: new AbortController().signal,
  }
}

describe('ShellMcpGateway', () => {
  it('returns the bridge-level tools/list array expected by the stdio adapter', async () => {
    const result = await gatewayWith().handle({
      clientId: 'test-client',
      requestId: 'list-request',
      method: 'tools/list',
      params: {},
      signal: new AbortController().signal,
    })
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'list_open_documents' }),
        expect.objectContaining({ name: 'create_document' }),
        expect.objectContaining({ name: 'slides.apply_ops' }),
        expect.objectContaining({ name: 'slides.render_preview' }),
        expect.objectContaining({ name: 'docs.get_context' }),
        expect.objectContaining({ name: 'markdown.read_blocks' }),
        expect.objectContaining({ name: 'sheets.read_range' }),
        expect.objectContaining({ name: 'pdf.read_page_context' }),
        expect.objectContaining({ name: 'pdf.search' }),
        expect.objectContaining({ name: 'pdf.read_annotations' }),
      ]),
    )
    const deleteSlide = (result as Array<{ name: string; description: string }>).find(
      (tool) => tool.name === 'slides.delete_slide',
    )
    expect(deleteSlide?.description).toContain('authenticated destructive-operation boundary')
    expect(deleteSlide?.description).not.toContain('confirmation')
    expect((result as Array<{ name: string }>).map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(['generate_image', 'images.generate', 'media.import', 'import_media']),
    )
  })

  it('does not expose arbitrary local-file access through the MCP tool surface', async () => {
    const tools = (await gatewayWith().handle({
      clientId: 'test-client',
      requestId: 'scope-request',
      method: 'tools/list',
      params: {},
      signal: new AbortController().signal,
    })) as Array<{ name: string; inputSchema: Record<string, unknown> }>

    expect(tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(['open_document', 'read_file', 'write_file']),
    )
    const createDocument = tools.find((tool) => tool.name === 'create_document')
    expect(createDocument?.inputSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { enum: ['docs', 'sheets', 'slides', 'markdown', 'pdf'] } },
    })
  })

  it('creates only one blank supported document and returns its opaque handle', async () => {
    const created = {
      ...target,
      documentId: 'doc-created',
      kind: 'markdown' as const,
      revision: 0,
      dirty: false,
      active: true,
    }
    const create = async (kind: DocumentTarget['kind']) => {
      expect(kind).toBe('markdown')
      return created
    }
    const result = await gatewayWith(
      [target],
      { authorize: async () => undefined },
      { create },
    ).handle(request({ name: 'create_document', input: { kind: 'markdown' } }))
    expect(result).toEqual({ content: JSON.stringify(created), mutated: true, revision: 0 })
    await expect(
      gatewayWith([target], { authorize: async () => undefined }, { create }).handle(
        request({ name: 'create_document', input: { kind: 'markdown', path: '/tmp/nope' } }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('lists opaque public document summaries without local paths', async () => {
    const result = await gatewayWith().handle(request({ name: 'list_open_documents' }))
    expect(result).toEqual({
      content: JSON.stringify([target]),
      mutated: false,
    })
    expect((result as { content: string }).content).not.toContain('/Users/')
  })

  it('gets a document status by explicit documentId', async () => {
    const result = await gatewayWith().handle(
      request({ name: 'get_document_status', input: { documentId: 'doc-123' } }),
    )
    expect(result).toEqual({ content: JSON.stringify(target), mutated: false, revision: 3 })
  })

  it('routes Slides reads through an explicit documentId, not the active tab', async () => {
    const context = await gatewayWith().handle(
      request({ name: 'slides.get_deck_context', input: { documentId: 'doc-123' } }),
    )
    const slide = await gatewayWith().handle(
      request({ name: 'slides.read_slide', input: { documentId: 'doc-123', slide: 's_1' } }),
    )
    expect(context).toMatchObject({ revision: 3, mutated: false })
    expect(JSON.parse((slide as { content: string }).content)).toEqual({
      revision: 3,
      slide: 's_1',
    })
  })

  it('routes Docs and Markdown reads through the fixed renderer bridge', async () => {
    const docsTarget = { ...target, kind: 'docs' as const }
    const markdownTarget = { ...target, documentId: 'doc-markdown', kind: 'markdown' as const }
    const docs = await gatewayWith([docsTarget, markdownTarget]).handle(
      request({ name: 'docs.get_context', input: { documentId: 'doc-123' } }),
    )
    const markdown = await gatewayWith([docsTarget, markdownTarget]).handle(
      request({
        name: 'markdown.read_blocks',
        input: { documentId: 'doc-markdown', start: 2, limit: 10 },
      }),
    )
    expect(JSON.parse((docs as { content: string }).content)).toMatchObject({
      action: 'docs.get_context',
    })
    expect(JSON.parse((markdown as { content: string }).content)).toMatchObject({
      action: 'markdown.read_blocks',
      input: { start: 2, limit: 10 },
    })
    await expect(
      gatewayWith([docsTarget]).handle(
        request({ name: 'markdown.get_context', input: { documentId: 'doc-123' } }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('routes bounded Sheets and PDF reads to their matching renderer targets', async () => {
    const sheetsTarget = { ...target, kind: 'sheets' as const }
    const pdfTarget = { ...target, documentId: 'doc-pdf', kind: 'pdf' as const }
    const sheets = await gatewayWith([sheetsTarget, pdfTarget]).handle(
      request({
        name: 'sheets.read_range',
        input: { documentId: 'doc-123', sheetId: 'sheet-1', range: 'A1:B2' },
      }),
    )
    const pdf = await gatewayWith([sheetsTarget, pdfTarget]).handle(
      request({ name: 'pdf.read_page_context', input: { documentId: 'doc-pdf', page: 0 } }),
    )
    expect(JSON.parse((sheets as { content: string }).content)).toMatchObject({
      action: 'sheets.read_range',
      input: { sheetId: 'sheet-1', range: 'A1:B2' },
    })
    expect(JSON.parse((pdf as { content: string }).content)).toMatchObject({
      action: 'pdf.read_page_context',
      input: { page: 0 },
    })
    await expect(
      gatewayWith([sheetsTarget]).handle(
        request({ name: 'pdf.get_document_context', input: { documentId: 'doc-123' } }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('routes a bounded PDF search through the fixed renderer bridge', async () => {
    const pdfTarget = { ...target, kind: 'pdf' as const }
    const result = await gatewayWith([pdfTarget]).handle(
      request({ name: 'pdf.search', input: { documentId: 'doc-123', query: 'revenue' } }),
    )
    expect(result).toMatchObject({ mutated: false, revision: 3 })
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'pdf.search',
      input: { query: 'revenue' },
    })
  })

  it('routes one explicit PDF annotation page through the fixed renderer bridge', async () => {
    const pdfTarget = { ...target, kind: 'pdf' as const }
    const result = await gatewayWith([pdfTarget]).handle(
      request({ name: 'pdf.read_annotations', input: { documentId: 'doc-123', page: 0 } }),
    )
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'pdf.read_annotations',
      input: { page: 0 },
    })
  })

  it('serializes renderer writes behind explicit revision and permission checks', async () => {
    const docsTarget = { ...target, kind: 'docs' as const }
    const result = await gatewayWith([docsTarget]).handle(
      request({
        name: 'docs.insert_content',
        input: { documentId: 'doc-123', expectedRevision: 3, content: 'Append this.' },
      }),
    )
    expect(result).toMatchObject({ mutated: true, revision: 3 })
    await expect(
      gatewayWith([docsTarget]).handle(
        request({
          name: 'docs.insert_content',
          input: { documentId: 'doc-123', expectedRevision: 2, content: 'Stale.' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('routes only bounded Docs undo/redo commands through the renderer write queue', async () => {
    const docsTarget = { ...target, kind: 'docs' as const }
    const result = await gatewayWith([docsTarget]).handle(
      request({
        name: 'docs.apply_commands',
        input: { documentId: 'doc-123', expectedRevision: 3, commands: [{ op: 'undo' }] },
      }),
    )
    expect(result).toMatchObject({ mutated: true, revision: 3 })
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'docs.apply_commands',
      input: { documentId: 'doc-123', expectedRevision: 3, commands: [{ op: 'undo' }] },
    })
    await expect(
      gatewayWith([docsTarget]).handle(
        request({
          name: 'docs.apply_commands',
          input: { documentId: 'doc-123', expectedRevision: 3, commands: [{ op: 'toggleBold' }] },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('routes only bounded Markdown undo/redo commands through the renderer write queue', async () => {
    const markdownTarget = { ...target, kind: 'markdown' as const }
    const result = await gatewayWith([markdownTarget]).handle(
      request({
        name: 'markdown.apply_commands',
        input: { documentId: 'doc-123', expectedRevision: 3, commands: [{ op: 'redo' }] },
      }),
    )
    expect(result).toMatchObject({ mutated: true, revision: 3 })
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'markdown.apply_commands',
      input: { documentId: 'doc-123', expectedRevision: 3, commands: [{ op: 'redo' }] },
    })
  })

  it('requires a Sheets revision and sends operation batches through the renderer write queue', async () => {
    const sheetsTarget = { ...target, kind: 'sheets' as const }
    const result = await gatewayWith([sheetsTarget]).handle(
      request({
        name: 'sheets.apply_operations',
        input: {
          documentId: 'doc-123',
          expectedRevision: 3,
          transactionId: 'tx-1',
          summary: 'Set B2',
          operations: [{ op: 'set_cell', sheetId: 'sheet-1', address: 'B2', value: 4 }],
          dryRun: true,
        },
      }),
    )
    expect(result).toMatchObject({ mutated: false, revision: 3 })
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'sheets.apply_operations',
      input: { expectedRevision: 3, transactionId: 'tx-1', dryRun: true },
    })
  })

  it('routes a revision-checked Sheets undo through write permission', async () => {
    const sheetsTarget = { ...target, kind: 'sheets' as const }
    const requests: unknown[] = []
    const result = await gatewayWith([sheetsTarget], {
      authorize: async (permission) => {
        requests.push(permission)
      },
    }).handle(
      request({ name: 'sheets.undo', input: { documentId: 'doc-123', expectedRevision: 3 } }),
    )

    expect(result).toMatchObject({ mutated: true, revision: 3 })
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'sheets.undo',
      input: { expectedRevision: 3 },
    })
    expect(requests).toEqual([expect.objectContaining({ toolName: 'sheets.undo', risk: 'write' })])
  })

  it('routes dry-run PDF annotations through the revision-checked renderer route', async () => {
    const pdfTarget = { ...target, kind: 'pdf' as const }
    const result = await gatewayWith([pdfTarget]).handle(
      request({
        name: 'pdf.apply_operations',
        input: {
          documentId: 'doc-123',
          expectedRevision: 3,
          dryRun: true,
          operations: [{ op: 'add_note', page: 0, x: 10, y: 10, contents: 'Review' }],
        },
      }),
    )
    expect(result).toMatchObject({ mutated: false, revision: 3 })
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'pdf.apply_operations',
    })
  })

  it('requires destructive permission when a PDF operation deletes a page', async () => {
    const authorize = async (request: Parameters<McpPermissionGate['authorize']>[0]) => {
      requests.push(request)
    }
    const requests: Parameters<McpPermissionGate['authorize']>[0][] = []
    const pdfTarget = { ...target, kind: 'pdf' as const }

    await gatewayWith([pdfTarget], { authorize }).handle(
      request({
        name: 'pdf.apply_operations',
        input: {
          documentId: 'doc-123',
          expectedRevision: 3,
          operations: [{ op: 'delete_page', page: 0 }],
        },
      }),
    )

    expect(requests).toEqual([
      expect.objectContaining({
        clientId: 'test-client',
        toolName: 'pdf.apply_operations',
        risk: 'destructive',
        document: expect.objectContaining({ documentId: 'doc-123' }),
      }),
    ])
  })

  it('renders a bounded Slides preview through the explicit document/slide route', async () => {
    const result = await gatewayWith().handle(
      request({ name: 'slides.render_preview', input: { documentId: 'doc-123', slide: 's_1' } }),
    )
    expect(result).toMatchObject({ mutated: false, revision: 3 })
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
    })
  })

  it('requires an expected revision and returns the post-write revision for Slides operations', async () => {
    const result = await gatewayWith().handle(
      request({
        name: 'slides.apply_ops',
        input: {
          documentId: 'doc-123',
          expectedRevision: 3,
          ops: [{ op: 'setFill' }],
        },
      }),
    )
    expect(result).toEqual({
      content: JSON.stringify({ applied: true, revision: 4 }),
      mutated: true,
      revision: 4,
    })
  })

  it('serializes Slides undo through the same explicit document/revision route', async () => {
    const result = await gatewayWith().handle(
      request({ name: 'undo', input: { documentId: 'doc-123', expectedRevision: 3 } }),
    )
    expect(result).toEqual({
      content: JSON.stringify({ applied: true, revision: 4 }),
      mutated: true,
      revision: 4,
    })
  })

  it('activates an explicit document only when its revision matches', async () => {
    const result = await gatewayWith().handle(
      request({ name: 'activate_document', input: { documentId: 'doc-123', expectedRevision: 3 } }),
    )
    expect(result).toMatchObject({ mutated: false, revision: 3 })
    await expect(
      gatewayWith().handle(
        request({
          name: 'activate_document',
          input: { documentId: 'doc-123', expectedRevision: 2 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('saves Slides through the file-risk capability path without exposing a local path', async () => {
    const result = await gatewayWith().handle(
      request({ name: 'save_document', input: { documentId: 'doc-123', expectedRevision: 3 } }),
    )
    expect(result).toEqual({
      content: JSON.stringify({ saved: true, revision: 3 }),
      mutated: false,
      revision: 3,
    })
  })

  it('routes explicit slide insertion and deletion with revisions', async () => {
    const added = await gatewayWith().handle(
      request({
        name: 'slides.add_slide',
        input: { documentId: 'doc-123', expectedRevision: 3, afterSlide: 0 },
      }),
    )
    const deleted = await gatewayWith().handle(
      request({
        name: 'slides.delete_slide',
        input: { documentId: 'doc-123', expectedRevision: 3, slide: 1 },
      }),
    )
    expect(added).toMatchObject({ mutated: true, revision: 4 })
    expect(deleted).toMatchObject({ mutated: true, revision: 4 })
  })

  it('uses destructive risk only for an explicit Slides deletion target', async () => {
    const requests: Parameters<McpPermissionGate['authorize']>[0][] = []
    const gateway = gatewayWith([target], {
      authorize: async (permission) => {
        requests.push(permission)
      },
    })

    await gateway.handle(
      request({
        name: 'slides.delete_slide',
        input: { documentId: 'doc-123', expectedRevision: 3, slide: 0 },
      }),
    )
    expect(requests).toEqual([
      expect.objectContaining({
        toolName: 'slides.delete_slide',
        risk: 'destructive',
        document: expect.objectContaining({ documentId: 'doc-123' }),
      }),
    ])
    await expect(
      gateway.handle(
        request({
          name: 'slides.delete_slide',
          input: { documentId: 'doc-123', expectedRevision: 3 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('audits only metadata after a write, never its operation payload', async () => {
    const events: unknown[] = []
    const audit: McpAuditLogger = { record: async (event) => void events.push(event) }
    await gatewayWith([target], { authorize: async () => undefined }, undefined, audit).handle(
      request({
        name: 'slides.apply_ops',
        input: {
          documentId: 'doc-123',
          expectedRevision: 3,
          ops: [{ op: 'setFill', target: { slide: 0, el: 'shape-1' }, fill: 'secret-content' }],
        },
      }),
    )
    expect(events).toEqual([
      expect.objectContaining({
        toolName: 'slides.apply_ops',
        documentId: 'doc-123',
        outcome: 'success',
        mutated: true,
        revision: 4,
      }),
    ])
    expect(JSON.stringify(events)).not.toContain('secret-content')
  })

  it('rejects unknown, closed, and malformed document requests', async () => {
    await expect(gatewayWith().handle(request({ name: 'missing' }))).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<CapabilityError>)
    await expect(
      gatewayWith().handle(
        request({ name: 'get_document_status', input: { documentId: 'doc-closed' } }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<CapabilityError>)
    await expect(
      gatewayWith().handle(request({ name: 'list_open_documents', input: { extra: true } })),
    ).rejects.toMatchObject({ code: 'validation_error' } satisfies Partial<CapabilityError>)
  })
})
