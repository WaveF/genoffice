import { describe, expect, it } from 'vitest'
import { CapabilityError, type DocumentTarget } from '@nexoffice/capabilities'
import {
  ShellMcpGateway,
  type DocumentTargetSource,
  type McpDocumentFactory,
  type MarkdownMcpImageWriter,
  type McpSkillSource,
  type RendererMcpReader,
  type SlidesMcpReader,
} from '../src/main/mcp/gateway'
import type { McpPermissionGate } from '../src/main/mcp/permissions'
import type { McpAuditLogger } from '../src/main/mcp/audit'
import type { McpMediaImportStore } from '../src/main/mcp/media-import'

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
  media?: McpMediaImportStore,
  markdownImages?: MarkdownMcpImageWriter,
  skills?: McpSkillSource,
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
    getLayoutContext: (_webContentsId, slide) => ({
      revision: 3,
      slide,
      coordinateSystem: { unit: 'px' },
      slideSize: { width: 1280, height: 720 },
      elements: [],
    }),
    auditLayout: (_webContentsId, slide) => ({ revision: 3, slide, issues: [] }),
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
      applyLayout: (_webContentsId, _changes, expectedRevision, dryRun) => ({
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
    media,
    markdownImages,
    skills,
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
        expect.objectContaining({ name: 'skills.list' }),
        expect.objectContaining({ name: 'skills.read' }),
        expect.objectContaining({ name: 'skills.create' }),
        expect.objectContaining({ name: 'skills.replace_content' }),
        expect.objectContaining({ name: 'create_document' }),
        expect.objectContaining({ name: 'slides.apply_ops' }),
        expect.objectContaining({ name: 'slides.apply_layout' }),
        expect.objectContaining({ name: 'slides.get_layout_context' }),
        expect.objectContaining({ name: 'slides.audit_layout' }),
        expect.objectContaining({ name: 'slides.render_preview' }),
        expect.objectContaining({ name: 'docs.get_context' }),
        expect.objectContaining({ name: 'docs.apply_operations' }),
        expect.objectContaining({ name: 'markdown.read_blocks' }),
        expect.objectContaining({ name: 'markdown.set_source' }),
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

  it('lists and reads only enabled skills without using document access', async () => {
    const skills: McpSkillSource = {
      list: async () => [
        {
          id: 'slides-guide',
          name: 'Slides guide',
          description: '',
          appliesTo: ['slides'],
          source: 'builtin',
          enabled: true,
        },
      ],
      read: async (id) => ({
        summary: {
          id,
          name: 'Slides guide',
          description: '',
          appliesTo: ['slides'],
          source: 'builtin',
          enabled: true,
        },
        content: '# Slides guide',
        revision: 'a'.repeat(64),
      }),
      createFromMcp: async (name, content) => ({
        summary: {
          id: 'skill-123',
          name,
          description: '',
          appliesTo: [],
          source: 'custom' as const,
          enabled: true,
        },
        content,
        revision: 'b'.repeat(64),
      }),
      replaceContent: async (id, _expectedRevision, content) => ({
        summary: {
          id,
          name: 'Updated guide',
          description: '',
          appliesTo: [],
          source: 'custom' as const,
          enabled: true,
        },
        content,
        revision: 'c'.repeat(64),
      }),
    }
    const gateway = gatewayWith(
      [target],
      { authorize: async () => undefined },
      undefined,
      undefined,
      undefined,
      undefined,
      skills,
    )

    await expect(
      gateway.handle(request({ name: 'skills.list', input: {} })),
    ).resolves.toMatchObject({
      content: JSON.stringify(await skills.list(false)),
      mutated: false,
    })
    await expect(
      gateway.handle(request({ name: 'skills.read', input: { skillId: 'slides-guide' } })),
    ).resolves.toMatchObject({
      content: JSON.stringify(await skills.read('slides-guide', false)),
      mutated: false,
    })
  })

  it('creates and replaces complete custom skills without accepting file paths', async () => {
    const calls: Array<{ name: string; value: string }> = []
    const skills: McpSkillSource = {
      list: async () => [],
      read: async () => {
        throw new Error('not used')
      },
      createFromMcp: async (name, content) => {
        calls.push({ name, value: content })
        return {
          summary: {
            id: 'skill-123',
            name,
            description: '',
            appliesTo: [],
            source: 'custom',
            enabled: true,
          },
          content,
          revision: 'd'.repeat(64),
        }
      },
      replaceContent: async (id, expectedRevision, content) => {
        calls.push({ name: `${id}:${expectedRevision}`, value: content })
        return {
          summary: {
            id,
            name: 'Agent guide',
            description: '',
            appliesTo: [],
            source: 'custom',
            enabled: true,
          },
          content,
          revision: 'e'.repeat(64),
        }
      },
    }
    const gateway = gatewayWith(
      [target],
      { authorize: async () => undefined },
      undefined,
      undefined,
      undefined,
      undefined,
      skills,
    )
    const content = '---\nname: Agent guide\n---\n\n# Agent guide'

    await expect(
      gateway.handle(request({ name: 'skills.create', input: { name: 'Agent guide', content } })),
    ).resolves.toMatchObject({
      mutated: true,
      content: expect.stringContaining('skill-123'),
    })
    await expect(
      gateway.handle(
        request({
          name: 'skills.replace_content',
          input: { skillId: 'skill-123', expectedRevision: 'd'.repeat(64), content },
        }),
      ),
    ).resolves.toMatchObject({ mutated: true })
    expect(calls).toEqual([
      { name: 'Agent guide', value: content },
      { name: `skill-123:${'d'.repeat(64)}`, value: content },
    ])
    await expect(
      gateway.handle(
        request({
          name: 'skills.create',
          input: { name: 'Agent guide', content, path: '/tmp/nope.md' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
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
    const layout = await gatewayWith().handle(
      request({
        name: 'slides.get_layout_context',
        input: { documentId: 'doc-123', slide: 's_1' },
      }),
    )
    const audit = await gatewayWith().handle(
      request({ name: 'slides.audit_layout', input: { documentId: 'doc-123', slide: 's_1' } }),
    )
    expect(context).toMatchObject({ revision: 3, mutated: false })
    expect(JSON.parse((slide as { content: string }).content)).toEqual({
      revision: 3,
      slide: 's_1',
    })
    expect(JSON.parse((layout as { content: string }).content)).toMatchObject({
      coordinateSystem: { unit: 'px' },
      slideSize: { width: 1280, height: 720 },
    })
    expect(JSON.parse((audit as { content: string }).content)).toEqual({
      revision: 3,
      slide: 's_1',
      issues: [],
    })
  })

  it('routes bounded CSS-style layout writes through the normal write boundary', async () => {
    const result = await gatewayWith().handle(
      request({
        name: 'slides.apply_layout',
        input: {
          documentId: 'doc-123',
          expectedRevision: 3,
          changes: [
            {
              slide: 's_1',
              elementId: 'e_title',
              bounds: { x: 80, y: 60, width: 640, height: 80 },
            },
          ],
        },
      }),
    )
    expect(result).toMatchObject({ mutated: true, revision: 4 })
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

  it('routes native Docs operation batches with revision, permission, and dry-run boundaries', async () => {
    const docsTarget = { ...target, kind: 'docs' as const }
    const permissions: unknown[] = []
    const gateway = gatewayWith([docsTarget], {
      authorize: async (request) => {
        permissions.push(request)
      },
    })
    const input = {
      documentId: 'doc-123',
      expectedRevision: 3,
      operations: [
        {
          op: 'insert_blocks',
          blocks: [{ type: 'heading', headingLevel: 1, runs: [{ text: 'Report' }] }],
        },
      ],
    }
    const result = await gateway.handle(request({ name: 'docs.apply_operations', input }))
    expect(result).toMatchObject({ mutated: true, revision: 3 })
    expect(permissions).toHaveLength(1)
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'docs.apply_operations',
      input,
    })

    const dryRun = await gateway.handle(
      request({ name: 'docs.apply_operations', input: { ...input, dryRun: true } }),
    )
    expect(dryRun).toMatchObject({ mutated: false, revision: 3 })
    expect(permissions).toHaveLength(1)
    await expect(
      gateway.handle(
        request({
          name: 'docs.apply_operations',
          input: { ...input, expectedRevision: 2 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
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

  it('replaces complete Markdown source through the revision-checked write boundary', async () => {
    const markdownTarget = { ...target, kind: 'markdown' as const }
    const permissionRequests: Parameters<McpPermissionGate['authorize']>[0][] = []
    const result = await gatewayWith([markdownTarget], {
      authorize: async (permission) => permissionRequests.push(permission),
    }).handle(
      request({
        name: 'markdown.set_source',
        input: { documentId: 'doc-123', expectedRevision: 3, source: '# Source\n\n- item' },
      }),
    )
    expect(result).toMatchObject({ mutated: true, revision: 3 })
    expect(JSON.parse((result as { content: string }).content)).toMatchObject({
      action: 'markdown.set_source',
      input: { documentId: 'doc-123', expectedRevision: 3, source: '# Source\n\n- item' },
    })
    expect(permissionRequests).toEqual([
      expect.objectContaining({ toolName: 'markdown.set_source', risk: 'write' }),
    ])
    await expect(
      gatewayWith([markdownTarget]).handle(
        request({
          name: 'markdown.set_source',
          input: { documentId: 'doc-123', expectedRevision: 2, source: '# stale' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      gatewayWith([markdownTarget]).handle(
        request({
          name: 'markdown.set_source',
          input: {
            documentId: 'doc-123',
            expectedRevision: 3,
            source: '# invalid',
            start: 0,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('stages opaque media and inserts it only through the saved Markdown image writer', async () => {
    const markdownTarget = { ...target, kind: 'markdown' as const }
    const stage = (clientId: string, fileName: unknown) => {
      expect(clientId).toBe('test-client')
      expect(fileName).toBe('agent-image.png')
      return { handle: 'media-123', fileName: 'agent-image.png', mimeType: 'image/png' as const }
    }
    const consume = (clientId: string, handle: unknown) => {
      expect(clientId).toBe('test-client')
      expect(handle).toBe('media-123')
      return {
        handle: 'media-123',
        fileName: 'agent-image.png',
        mimeType: 'image/png' as const,
        bytes: Buffer.from('image'),
      }
    }
    const markdownImages: MarkdownMcpImageWriter = {
      insertImage: async (webContentsId, fileName, bytes) => {
        expect(webContentsId).toBe(42)
        expect(fileName).toBe('agent-image.png')
        expect(bytes).toEqual(Buffer.from('image'))
        return 'assets/agent-image.png'
      },
    }
    const gateway = gatewayWith(
      [markdownTarget],
      { authorize: async () => undefined },
      undefined,
      undefined,
      { stage, consume } as unknown as McpMediaImportStore,
      markdownImages,
    )
    const staged = await gateway.handle(
      request({ name: 'media.stage_image', input: { fileName: 'agent-image.png' } }),
    )
    expect(JSON.parse((staged as { content: string }).content)).toEqual({
      mediaHandle: 'media-123',
      fileName: 'agent-image.png',
      mimeType: 'image/png',
    })
    const inserted = await gateway.handle(
      request({
        name: 'markdown.insert_image',
        input: {
          documentId: 'doc-123',
          expectedRevision: 3,
          mediaHandle: 'media-123',
          alt: 'Generated image',
        },
      }),
    )
    expect(JSON.parse((inserted as { content: string }).content)).toMatchObject({
      action: 'markdown.insert_image',
      input: { src: 'assets/agent-image.png', alt: 'Generated image' },
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
