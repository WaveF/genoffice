import { describe, expect, it, vi } from 'vitest'
import { handlePdfMcpRequest } from '../src/renderer/mcp-adapter'

describe('handlePdfMcpRequest', () => {
  const state = {
    pageCount: 2,
    sizes: [{ width: 600, height: 800 }, { width: 600, height: 900 }],
    pageBlocks: new Map([[0, [{ lines: [{ text: 'First' }, { text: 'page' }] }]]]),
  }

  it('returns bounded page metadata', () => {
    expect(handlePdfMcpRequest('pdf.get_document_context', {}, state)).toEqual({
      pageCount: 2,
      pages: [{ index: 0, width: 600, height: 800 }, { index: 1, width: 600, height: 900 }],
      outline: [], forms: [], annotations: { pendingMarkups: 0, pendingNotes: 0, savedMarkups: 0, savedNotes: 0 },
    })
  })

  it('returns text only for one explicit page', () => {
    expect(handlePdfMcpRequest('pdf.read_page_context', { page: 0 }, state)).toEqual({
      page: 0, size: { width: 600, height: 800 }, blocks: [{ text: 'First\npage' }],
    })
  })

  it('rejects pages outside the open document', () => {
    expect(() => handlePdfMcpRequest('pdf.read_page_context', { page: 2 }, state)).toThrow('valid page')
  })

  it('dry-runs and applies bounded annotation operations with revisions', async () => {
    const input = { expectedRevision: 4, operations: [{ op: 'add_note', page: 0, x: 20, y: 30, contents: 'Review this' }] }
    const revisioned = { ...state, revision: 4 }
    await expect(Promise.resolve(handlePdfMcpRequest('pdf.apply_operations', { ...input, dryRun: true }, revisioned))).resolves.toMatchObject({
      revision: 4, dryRun: true, changes: { notes: 1, markups: 0 },
    })
    const apply = vi.fn(async () => undefined)
    await expect(handlePdfMcpRequest('pdf.apply_operations', input, revisioned, apply)).resolves.toMatchObject({ revision: 5, dryRun: false })
    expect(apply).toHaveBeenCalledWith(input.operations)
  })

  it('accepts bounded form field values in the same revision-checked batch', async () => {
    const result = handlePdfMcpRequest('pdf.apply_operations', {
      expectedRevision: 4,
      operations: [{ op: 'set_form_value', name: 'Customer', kind: 'text', value: 'Ada' }],
      dryRun: true,
    }, { ...state, revision: 4 })
    await expect(Promise.resolve(result)).resolves.toMatchObject({ dryRun: true, changes: { forms: 1 } })
  })
})
