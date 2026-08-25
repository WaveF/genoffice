import { describe, expect, it } from 'vitest'
import { CapabilityError, type DocumentTarget } from '@genoffice/capabilities'
import {
  ShellMcpGateway,
  type DocumentTargetSource,
  type SlidesMcpReader,
} from '../src/main/mcp/gateway'

const target: DocumentTarget = {
  documentId: 'doc-123',
  kind: 'slides',
  title: 'Quarterly review',
  revision: 3,
  dirty: true,
  active: false,
  webContentsId: 42,
}

function gatewayWith(documents: DocumentTarget[] = [target]): ShellMcpGateway {
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
  }
  return new ShellMcpGateway(source, {
    ...slides,
    opsRisk: () => 'write',
    applyOps: (_webContentsId, _ops, expectedRevision, dryRun) => ({
      applied: !dryRun,
      revision: expectedRevision + (dryRun ? 0 : 1),
    }),
    undo: (_webContentsId, expectedRevision) => ({ applied: true, revision: expectedRevision + 1 }),
    redo: (_webContentsId, expectedRevision) => ({ applied: true, revision: expectedRevision + 1 }),
    save: async (_webContentsId, expectedRevision) => ({ saved: true, revision: expectedRevision }),
  }, {
    authorize: async () => undefined,
  })
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
        expect.objectContaining({ name: 'slides.apply_ops' }),
      ]),
    )
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
    expect(JSON.parse((slide as { content: string }).content)).toEqual({ revision: 3, slide: 's_1' })
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
        request({ name: 'activate_document', input: { documentId: 'doc-123', expectedRevision: 2 } }),
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
