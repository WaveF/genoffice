import { describe, expect, it } from 'vitest'
import { InMemoryWorkbookAdapter } from '../src/domain/in-memory-workbook'
import { handleSheetsMcpRequest } from '../src/renderer/mcp-adapter'

const adapter = new InMemoryWorkbookAdapter({
  revision: 7,
  sheets: [{ id: 'sheet-1', name: 'Data', cells: { A1: { value: 'Name' }, B1: { value: 42 }, A2: { formula: '=B1*2', value: null } } }],
})

describe('handleSheetsMcpRequest', () => {
  it('returns compact workbook metadata without cell contents', () => {
    expect(handleSheetsMcpRequest(adapter, 'sheets.get_workbook_context', {})).toEqual({
      revision: 7,
      sheets: [{ id: 'sheet-1', name: 'Data', cellCount: 3 }],
    })
  })

  it('reads only an explicit rectangular range and includes blank cells', () => {
    expect(handleSheetsMcpRequest(adapter, 'sheets.read_range', { sheetId: 'sheet-1', range: 'A1:B2' })).toEqual({
      revision: 7,
      sheetId: 'sheet-1',
      range: 'A1:B2',
      cells: [
        { address: 'A1', value: 'Name' }, { address: 'B1', value: 42 },
        { address: 'A2', formula: '=B1*2', value: null }, { address: 'B2', value: null },
      ],
    })
  })

  it('finds bounded case-insensitive matches only in the requested range', () => {
    expect(handleSheetsMcpRequest(adapter, 'sheets.find', { sheetId: 'sheet-1', range: 'A1:B2', query: 'name' })).toMatchObject({
      revision: 7,
      matches: [{ address: 'A1', value: 'Name' }],
    })
  })

  it('rejects oversized or malformed range requests', () => {
    expect(() => handleSheetsMcpRequest(adapter, 'sheets.read_range', { sheetId: 'sheet-1', range: 'A1:A2001' })).toThrow('2000')
    expect(() => handleSheetsMcpRequest(adapter, 'sheets.read_range', { sheetId: 'sheet-1' })).toThrow('sheetId and range')
  })

  it('dry-runs and applies a revision-checked operation batch', async () => {
    const input = {
      expectedRevision: 7,
      transactionId: 'mcp-cell-edit',
      summary: 'Set a value',
      operations: [{ op: 'set_cell', sheetId: 'sheet-1', address: 'B2', value: 'Done' }],
    }
    await expect(Promise.resolve(handleSheetsMcpRequest(adapter, 'sheets.apply_operations', { ...input, dryRun: true }))).resolves.toMatchObject({
      revision: 7, dryRun: true, changes: { cells: 1 },
    })
    await expect(handleSheetsMcpRequest(adapter, 'sheets.apply_operations', input, async (plan) => { adapter.apply(plan) })).resolves.toMatchObject({
      revision: 8, dryRun: false,
    })
  })
})
