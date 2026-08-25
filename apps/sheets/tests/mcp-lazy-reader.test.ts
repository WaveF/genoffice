import { describe, expect, it, vi } from 'vitest'
import type { CellState } from '../src/domain/workbook.types'
import { handleLazySheetsMcpReadRequest } from '../src/renderer/mcp-lazy-reader'

function deps(preloadComplete = false) {
  const ensureRangeLoaded = vi.fn().mockResolvedValue(true)
  return {
    ensureRangeLoaded,
    value: {
      getState: () => ({
        preloadComplete,
        sheets: [{ id: 'import-1', name: 'Imported', rowCount: 10, columnCount: 4 }],
      }),
      getWorksheet: (sheetId: string) => sheetId === 'import-1' ? { id: sheetId } : null,
      getRevision: () => 12,
      ensureRangeLoaded,
      readCells: (): Record<string, CellState> => ({ A1: { value: 'Live' }, B1: { value: 3 } }),
      readFormats: () => ({ A1: { bold: true } }),
    },
  }
}

describe('handleLazySheetsMcpReadRequest', () => {
  it('loads an explicit imported range before returning live cell data', async () => {
    const { value, ensureRangeLoaded } = deps()

    await expect(handleLazySheetsMcpReadRequest(value, 'sheets.read_range', {
      sheetId: 'import-1', range: 'A1:B1',
    })).resolves.toMatchObject({
      revision: 12,
      cells: [{ address: 'A1', value: 'Live', format: { bold: true } }, { address: 'B1', value: 3 }],
    })
    expect(ensureRangeLoaded).toHaveBeenCalledWith({ id: 'import-1' }, {
      startRow: 0, endRow: 0, startColumn: 0, endColumn: 1,
    })
  })

  it('rejects an unavailable streamed range instead of reporting it as blank', async () => {
    const { value, ensureRangeLoaded } = deps()
    ensureRangeLoaded.mockResolvedValue(false)

    await expect(handleLazySheetsMcpReadRequest(value, 'sheets.read_range', {
      sheetId: 'import-1', range: 'A1:B1',
    })).rejects.toThrow('not available yet')
  })

  it('does not load a fully preloaded workbook before tracing a formula', async () => {
    const { value, ensureRangeLoaded } = deps(true)
    value.readCells = () => ({ C1: { value: null, formula: '=A1+B1' } })

    await expect(handleLazySheetsMcpReadRequest(value, 'sheets.trace_formula', {
      sheetId: 'import-1', address: 'C1',
    })).resolves.toMatchObject({ formula: '=A1+B1', precedents: ['A1', 'B1'] })
    expect(ensureRangeLoaded).not.toHaveBeenCalled()
  })
})
