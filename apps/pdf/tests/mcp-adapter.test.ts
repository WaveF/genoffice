import { describe, expect, it } from 'vitest'
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
})
