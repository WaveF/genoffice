import { describe, expect, it } from 'vitest'
import { type DocumentTarget } from '@genoffice/capabilities'
import { InMemoryWorkbookAdapter } from '../../sheets/src/domain/in-memory-workbook'
import { handleSheetsMcpRequest } from '../../sheets/src/renderer/mcp-adapter'
import {
  ShellMcpGateway,
  type DocumentTargetSource,
  type RendererMcpReader,
} from '../src/main/mcp/gateway'

function toolRequest(name: string, input: Record<string, unknown>) {
  return {
    clientId: 'sheets-e2e-client',
    requestId: `request-${name}`,
    method: 'tools/call' as const,
    params: { name, input },
    signal: new AbortController().signal,
  }
}

describe('ShellMcpGateway Sheets renderer route', () => {
  it('reads and writes through the bounded renderer adapter with permission and revision updates', async () => {
    const workbook = new InMemoryWorkbookAdapter({
      revision: 0,
      sheets: [{ id: 'sheet-1', name: 'Data', cells: { A1: { value: 'Before' } } }],
    })
    const document: DocumentTarget = {
      documentId: 'sheet-doc', kind: 'sheets', title: 'Data.xlsx', revision: 0,
      dirty: false, active: true, webContentsId: 99,
    }
    const source: DocumentTargetSource = {
      listDocumentTargets: async () => [document],
      findDocumentTarget: async (documentId) => documentId === document.documentId ? document : null,
      activateDocument: async () => document,
    }
    const renderer: RendererMcpReader = {
      request: async (_webContentsId, action, input) => {
        if (action === 'sheets.undo') {
          if (input.expectedRevision !== document.revision) throw new Error('Workbook changed since it was read')
          document.revision = workbook.undo().revision
          return { applied: true, revision: document.revision }
        }
        return Promise.resolve(handleSheetsMcpRequest(
          workbook,
          action,
          input,
          async (plan) => { document.revision = workbook.apply(plan).revision },
        ))
      },
    }
    const permissions: string[] = []
    const gateway = new ShellMcpGateway(source, undefined, {
      authorize: async (request) => { permissions.push(`${request.toolName}:${request.risk}`) },
    }, undefined, renderer)

    const read = await gateway.handle(toolRequest('sheets.read_range', {
      documentId: 'sheet-doc', sheetId: 'sheet-1', range: 'A1:A1',
    }))
    expect(JSON.parse((read as { content: string }).content)).toMatchObject({
      revision: 0, cells: [{ address: 'A1', value: 'Before' }],
    })

    const write = await gateway.handle(toolRequest('sheets.apply_operations', {
      documentId: 'sheet-doc', expectedRevision: 0, transactionId: 'set-a1', summary: 'Update A1',
      operations: [{ op: 'set_cell', sheetId: 'sheet-1', address: 'A1', value: 'After' }],
    }))
    expect(write).toMatchObject({ mutated: true, revision: 1 })
    expect(JSON.parse((write as { content: string }).content)).toMatchObject({ revision: 1, changes: { cells: 1 } })
    expect(permissions).toEqual(['sheets.apply_operations:write'])

    const updated = await gateway.handle(toolRequest('sheets.read_range', {
      documentId: 'sheet-doc', sheetId: 'sheet-1', range: 'A1:A1',
    }))
    expect(JSON.parse((updated as { content: string }).content)).toMatchObject({
      revision: 1, cells: [{ address: 'A1', value: 'After' }],
    })

    const formula = await gateway.handle(toolRequest('sheets.apply_operations', {
      documentId: 'sheet-doc', expectedRevision: 1, transactionId: 'formula-b1', summary: 'Calculate B1',
      operations: [{ op: 'set_formula', sheetId: 'sheet-1', address: 'B1', formula: '=A1' }],
    }))
    expect(formula).toMatchObject({ mutated: true, revision: 2 })
    const trace = await gateway.handle(toolRequest('sheets.trace_formula', {
      documentId: 'sheet-doc', sheetId: 'sheet-1', address: 'B1',
    }))
    expect(JSON.parse((trace as { content: string }).content)).toMatchObject({ formula: '=A1', precedents: ['A1'] })

    const undo = await gateway.handle(toolRequest('sheets.undo', {
      documentId: 'sheet-doc', expectedRevision: 2,
    }))
    expect(undo).toMatchObject({ mutated: true, revision: 3 })
    const afterUndo = await gateway.handle(toolRequest('sheets.trace_formula', {
      documentId: 'sheet-doc', sheetId: 'sheet-1', address: 'B1',
    }))
    expect(JSON.parse((afterUndo as { content: string }).content)).toMatchObject({ formula: null, precedents: [] })
    expect(permissions).toEqual([
      'sheets.apply_operations:write', 'sheets.apply_operations:write', 'sheets.undo:write',
    ])
  })
})
