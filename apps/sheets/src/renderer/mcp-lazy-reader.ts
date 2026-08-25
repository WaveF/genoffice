import { parseRange } from '../domain/cell-address'
import type { CellFormatState, CellState } from '../domain/workbook.types'
import { handleSheetsMcpReadRequest, type SheetsMcpReadAction } from './mcp-adapter'

interface LazySheetMetadata {
  id: string
  name: string
  rowCount: number
  columnCount: number
}

interface LazyWorkbookMcpState {
  preloadComplete: boolean
  sheets: readonly LazySheetMetadata[]
}

/** Renderer dependencies are injected so the lazy MCP route is independently testable. */
export interface LazySheetsMcpReaderDeps<Worksheet> {
  getState(): LazyWorkbookMcpState | null
  getWorksheet(sheetId: string): Worksheet | null
  getRevision(): number
  ensureRangeLoaded(worksheet: Worksheet, range: ReturnType<typeof parseRange>): Promise<boolean>
  readCells(sheetId: string, addresses: readonly string[]): Record<string, CellState>
  readFormats(sheetId: string, addresses: readonly string[]): Record<string, CellFormatState>
}

/**
 * Read an imported workbook through its live Univer view. A requested range is
 * loaded before it is inspected so streaming gaps never appear as blank cells.
 */
export async function handleLazySheetsMcpReadRequest<Worksheet>(
  deps: LazySheetsMcpReaderDeps<Worksheet>,
  action: SheetsMcpReadAction,
  input: Record<string, unknown>,
): Promise<unknown> {
  const state = deps.getState()
  if (!state) throw new Error('Workbook is not ready')
  const sheetId = typeof input.sheetId === 'string' ? input.sheetId : undefined
  const requestedRange =
    action === 'sheets.trace_formula'
      ? typeof input.address === 'string' ? input.address : undefined
      : typeof input.range === 'string' ? input.range : undefined
  if (sheetId && requestedRange && !state.preloadComplete && state.sheets.some((sheet) => sheet.id === sheetId)) {
    const worksheet = deps.getWorksheet(sheetId)
    if (!worksheet) throw new Error('Sheet is not present')
    let loaded = false
    try {
      loaded = await deps.ensureRangeLoaded(worksheet, parseRange(requestedRange))
    } catch {
      throw new Error('Requested workbook range could not be loaded')
    }
    if (!loaded) throw new Error('Requested workbook range is not available yet')
  }
  return handleSheetsMcpReadRequest({
    revision: deps.getRevision(),
    sheets: state.sheets.map((sheet) => ({ ...sheet })),
    readCells: deps.readCells,
    readFormats: deps.readFormats,
  }, action, input)
}
