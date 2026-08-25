import type { InMemoryWorkbookAdapter } from '../domain/in-memory-workbook'

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
  if (typeof sheetId !== 'string') throw new Error('sheetId is required')
  const sheet = snapshot.sheets.find((candidate) => candidate.id === sheetId)
  if (!sheet) throw new Error('Sheet is not present')
  return { revision: snapshot.revision, sheetId, cells: Object.entries(sheet.cells).slice(0, 2000).map(([address, cell]) => ({ address, ...cell })) }
}
