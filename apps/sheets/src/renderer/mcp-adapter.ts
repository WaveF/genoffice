import type { InMemoryWorkbookAdapter } from '../domain/in-memory-workbook'
import { parseRange, rangeAddresses, rangeCellCount } from '../domain/cell-address'

const MAX_READ_CELLS = 2_000

/** Read-only MCP facade over the already-authoritative workbook adapter. */
export function handleSheetsMcpRequest(
  adapter: InMemoryWorkbookAdapter,
  action: 'sheets.get_workbook_context' | 'sheets.read_range',
  input: Record<string, unknown>,
): unknown {
  const snapshot = adapter.getSnapshot()
  if (action === 'sheets.get_workbook_context')
    return { revision: snapshot.revision, sheets: snapshot.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, cellCount: Object.keys(sheet.cells).length })) }
  const sheetId = input.sheetId
  const range = input.range
  if (typeof sheetId !== 'string' || typeof range !== 'string') throw new Error('sheetId and range are required')
  const sheet = snapshot.sheets.find((candidate) => candidate.id === sheetId)
  if (!sheet) throw new Error('Sheet is not present')
  const bounds = parseRange(range)
  const requestedCellCount = rangeCellCount(bounds)
  if (requestedCellCount > MAX_READ_CELLS) throw new Error(`range exceeds the ${MAX_READ_CELLS}-cell read limit`)
  return {
    revision: snapshot.revision,
    sheetId,
    range,
    cells: rangeAddresses(bounds).map((address) => ({ address, ...(sheet.cells[address] ?? { value: null }) })),
  }
}
