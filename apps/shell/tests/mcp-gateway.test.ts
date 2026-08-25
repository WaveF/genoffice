import { describe, expect, it } from 'vitest'
import { CapabilityError, type DocumentTarget } from '@genoffice/capabilities'
import { ShellMcpGateway, type DocumentTargetSource } from '../src/main/mcp/gateway'

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
  }
  return new ShellMcpGateway(source)
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
      request({ name: 'get_document_status', arguments: { documentId: 'doc-123' } }),
    )
    expect(result).toEqual({ content: JSON.stringify(target), mutated: false, revision: 3 })
  })

  it('rejects unknown, closed, and malformed document requests', async () => {
    await expect(gatewayWith().handle(request({ name: 'missing' }))).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<CapabilityError>)
    await expect(
      gatewayWith().handle(
        request({ name: 'get_document_status', arguments: { documentId: 'doc-closed' } }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<CapabilityError>)
    await expect(
      gatewayWith().handle(request({ name: 'list_open_documents', arguments: { extra: true } })),
    ).rejects.toMatchObject({ code: 'validation_error' } satisfies Partial<CapabilityError>)
  })
})
