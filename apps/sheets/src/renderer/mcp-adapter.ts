import type { InMemoryWorkbookAdapter } from '../domain/in-memory-workbook'
import { parseRange, rangeAddresses, rangeCellCount } from '../domain/cell-address'
import type { ChangePlan } from '../domain/workbook.types'

const MAX_READ_CELLS = 2_000

/** Read-only MCP facade over the already-authoritative workbook adapter. */
export function handleSheetsMcpRequest(
  adapter: InMemoryWorkbookAdapter,
  action: 'sheets.get_workbook_context' | 'sheets.read_range' | 'sheets.find' | 'sheets.aggregate' | 'sheets.apply_operations',
  input: Record<string, unknown>,
  applyPlan?: (plan: ChangePlan) => Promise<void>,
): unknown | Promise<unknown> {
  const snapshot = adapter.getSnapshot()
  if (action === 'sheets.get_workbook_context')
    return { revision: snapshot.revision, sheets: snapshot.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, cellCount: Object.keys(sheet.cells).length })) }
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
  const sheetId = input.sheetId
  const range = input.range
  if (typeof sheetId !== 'string' || typeof range !== 'string') throw new Error('sheetId and range are required')
  const sheet = snapshot.sheets.find((candidate) => candidate.id === sheetId)
  if (!sheet) throw new Error('Sheet is not present')
  const bounds = parseRange(range)
  const requestedCellCount = rangeCellCount(bounds)
  if (requestedCellCount > MAX_READ_CELLS) throw new Error(`range exceeds the ${MAX_READ_CELLS}-cell read limit`)
  const cells = rangeAddresses(bounds).map((address) => ({ address, ...(sheet.cells[address] ?? { value: null }) }))
  if (action === 'sheets.find') {
    const query = input.query
    if (typeof query !== 'string' || query.length === 0 || query.length > 256) throw new Error('A bounded query is required')
    const needle = query.toLocaleLowerCase()
    return { revision: snapshot.revision, sheetId, range, matches: cells.filter((cell) => String(cell.formula ?? cell.value ?? '').toLocaleLowerCase().includes(needle)).slice(0, 200) }
  }
  if (action === 'sheets.aggregate') {
    const operation = input.operation
    if (operation !== 'sum' && operation !== 'count' && operation !== 'average') throw new Error('operation must be sum, count, or average')
    const numbers = cells.map((cell) => cell.value).filter((value): value is number => typeof value === 'number')
    const value = operation === 'count' ? numbers.length : operation === 'sum' ? numbers.reduce((total, number) => total + number, 0) : numbers.length === 0 ? null : numbers.reduce((total, number) => total + number, 0) / numbers.length
    return { revision: snapshot.revision, sheetId, range, operation, value, numericCellCount: numbers.length }
  }
  return {
    revision: snapshot.revision,
    sheetId,
    range,
    cells,
  }
}
