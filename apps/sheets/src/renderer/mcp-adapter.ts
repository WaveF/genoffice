import type { InMemoryWorkbookAdapter } from '../domain/in-memory-workbook'
import { parseRange, rangeAddresses, rangeCellCount } from '../domain/cell-address'
import type { CellFormatState, CellState, ChangePlan } from '../domain/workbook.types'

const MAX_READ_CELLS = 2_000

export type SheetsMcpReadAction =
  | 'sheets.get_workbook_context'
  | 'sheets.read_range'
  | 'sheets.find'
  | 'sheets.aggregate'
  | 'sheets.trace_formula'

export interface SheetsMcpReadView {
  revision: number
  sheets: readonly { id: string; name: string; cellCount?: number; rowCount?: number; columnCount?: number }[]
  readCells(sheetId: string, addresses: readonly string[]): Record<string, CellState>
  readFormats(sheetId: string, addresses: readonly string[]): Record<string, CellFormatState>
}

/** Read-only MCP facade over the already-authoritative workbook adapter. */
export function handleSheetsMcpRequest(
  adapter: InMemoryWorkbookAdapter,
  action: 'sheets.get_workbook_context' | 'sheets.read_range' | 'sheets.find' | 'sheets.aggregate' | 'sheets.trace_formula' | 'sheets.apply_operations',
  input: Record<string, unknown>,
  applyPlan?: (plan: ChangePlan) => Promise<void>,
): unknown | Promise<unknown> {
  const snapshot = adapter.getSnapshot()
  if (action === 'sheets.apply_operations') {
    const expectedRevision = input.expectedRevision
    const transactionId = input.transactionId
    const summary = input.summary
    const operations = input.operations
    const dryRun = input.dryRun === true
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw new Error('expectedRevision is required')
    if (typeof transactionId !== 'string' || typeof summary !== 'string' || !Array.isArray(operations)) throw new Error('transactionId, summary, and operations are required')
    const plan = adapter.plan({ dslVersion: 1, transactionId, baseRevision: expectedRevision, summary, operations })
    const result = {
      revision: snapshot.revision,
      dryRun,
      transactionId: plan.transactionId,
      changes: {
        cells: plan.cellChanges.length,
        formats: plan.formatChanges.length,
        sheets: plan.sheetRenames.length,
        structural: plan.structuralChanges.length,
      },
      warnings: plan.warnings,
    }
    if (dryRun) return result
    if (!applyPlan) throw new Error('Workbook apply handler is unavailable')
    return applyPlan(plan).then(() => ({ ...result, dryRun: false, revision: adapter.getSnapshot().revision }))
  }
  return handleSheetsMcpReadRequest({
    revision: snapshot.revision,
    sheets: snapshot.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, cellCount: Object.keys(sheet.cells).length })),
    readCells: (sheetId, addresses) => {
      const sheet = snapshot.sheets.find((candidate) => candidate.id === sheetId)
      if (!sheet) throw new Error('Sheet is not present')
      return Object.fromEntries(addresses.map((address) => [address, sheet.cells[address] ?? { value: null }]))
    },
    readFormats: (sheetId, addresses) => {
      const sheet = snapshot.sheets.find((candidate) => candidate.id === sheetId)
      if (!sheet) throw new Error('Sheet is not present')
      return Object.fromEntries(addresses.flatMap((address) => sheet.styles?.[address] ? [[address, sheet.styles[address]]] : []))
    },
  }, action, input)
}

/** Bounded MCP reader shared by the demo adapter and imported workbooks. */
export function handleSheetsMcpReadRequest(
  view: SheetsMcpReadView,
  action: SheetsMcpReadAction,
  input: Record<string, unknown>,
): unknown {
  if (action === 'sheets.get_workbook_context') {
    return {
      revision: view.revision,
      sheets: view.sheets.map(({ id, name, cellCount, rowCount, columnCount }) => ({
        id, name, ...(cellCount === undefined ? {} : { cellCount }),
        ...(rowCount === undefined ? {} : { rowCount }),
        ...(columnCount === undefined ? {} : { columnCount }),
      })),
    }
  }
  const sheetId = input.sheetId
  const range = input.range
  if (typeof sheetId !== 'string') throw new Error('sheetId is required')
  if (!view.sheets.some((candidate) => candidate.id === sheetId)) throw new Error('Sheet is not present')
  if (action === 'sheets.trace_formula') {
    const address = input.address
    if (typeof address !== 'string') throw new Error('sheetId and address are required')
    const formula = view.readCells(sheetId, [address])[address]?.formula
    if (!formula) return { revision: view.revision, sheetId, address, formula: null, precedents: [] }
    const precedents = [...new Set(formula.match(/(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)?!?\$?[A-Z]{1,3}\$?[1-9][0-9]*/g) ?? [])].slice(0, 100)
    return { revision: view.revision, sheetId, address, formula, precedents, truncated: precedents.length >= 100 }
  }
  if (typeof range !== 'string') throw new Error('sheetId and range are required')
  const bounds = parseRange(range)
  const requestedCellCount = rangeCellCount(bounds)
  if (requestedCellCount > MAX_READ_CELLS) throw new Error(`range exceeds the ${MAX_READ_CELLS}-cell read limit`)
  const addresses = rangeAddresses(bounds)
  const values = view.readCells(sheetId, addresses)
  const formats = view.readFormats(sheetId, addresses)
  const cells = addresses.map((address) => ({
    address,
    ...(values[address] ?? { value: null }),
    ...(formats[address] ? { format: formats[address] } : {}),
  }))
  if (action === 'sheets.find') {
    const query = input.query
    if (typeof query !== 'string' || query.length === 0 || query.length > 256) throw new Error('A bounded query is required')
    const needle = query.toLocaleLowerCase()
    return { revision: view.revision, sheetId, range, matches: cells.filter((cell) => String(cell.formula ?? cell.value ?? '').toLocaleLowerCase().includes(needle)).slice(0, 200) }
  }
  if (action === 'sheets.aggregate') {
    const operation = input.operation
    if (operation !== 'sum' && operation !== 'count' && operation !== 'average') throw new Error('operation must be sum, count, or average')
    const numbers = cells.map((cell) => cell.value).filter((value): value is number => typeof value === 'number')
    const value = operation === 'count' ? numbers.length : operation === 'sum' ? numbers.reduce((total, number) => total + number, 0) : numbers.length === 0 ? null : numbers.reduce((total, number) => total + number, 0) / numbers.length
    return { revision: view.revision, sheetId, range, operation, value, numericCellCount: numbers.length }
  }
  return {
    revision: view.revision,
    sheetId,
    range,
    cells,
  }
}
