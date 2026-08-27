/**
 * Read-only workbook views exposed through the Sheets MCP adapter.
 *
 * These deliberately live in a neutral renderer module: they are local
 * plumbing for an external MCP client, not an in-process agent tool layer.
 */
import type { InMemoryWorkbookAdapter } from '../domain/in-memory-workbook'
import type { CellFormatState, CellScalar } from '../domain/workbook.types'
import { toSelectionFormat } from './selection-format'
import { lazyCellReader } from './univer-sync'
import type { LazyWorkbookState, UniverRuntime } from './univer-state'

/** The App refs the MCP readers need; passed per call so they never go stale. */
export interface McpWorkbookReadContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  adapterRef: { readonly current: InMemoryWorkbookAdapter }
}

/** Return only explicit formatting, keeping the MCP payload compact. */
export function readMcpFormats(
  ctx: McpWorkbookReadContext,
  addresses: readonly string[],
  sheetId?: string,
): Record<string, CellFormatState> {
  const workbook = ctx.univerRef.current?.univerAPI.getActiveWorkbook()
  const worksheet =
    sheetId === undefined ? workbook?.getActiveSheet() : workbook?.getSheetBySheetId(sheetId)
  if (!worksheet) return {}
  const result: Record<string, CellFormatState> = {}
  for (const address of addresses) {
    const range = worksheet.getRange(address)
    let pattern = ''
    try {
      pattern = range.getNumberFormat()
    } catch {
      // Number-format resolution can fail on never-touched cells.
    }
    const echo = toSelectionFormat(range.getCellStyleData() ?? {}, pattern)
    const format: Record<string, unknown> = {}
    if (echo.bold) format.bold = true
    if (echo.italic) format.italic = true
    if (echo.underline) format.underline = true
    if (echo.strike) format.strikethrough = true
    if (echo.fontFamily) format.fontFamily = echo.fontFamily
    if (echo.fontSize) format.fontSize = echo.fontSize
    if (echo.fontColor) format.fontColor = echo.fontColor
    if (echo.fillColor) format.fillColor = echo.fillColor
    if (echo.numberFormat && echo.numberFormat !== 'General') format.numberFormat = echo.numberFormat
    if (
      echo.horizontalAlignment === 'left' ||
      echo.horizontalAlignment === 'center' ||
      echo.horizontalAlignment === 'right'
    ) {
      format.horizontalAlign = echo.horizontalAlignment
    }
    if (
      echo.verticalAlignment === 'top' ||
      echo.verticalAlignment === 'center' ||
      echo.verticalAlignment === 'bottom'
    ) {
      format.verticalAlign = echo.verticalAlignment
    }
    if (echo.wrap) format.wrapText = true
    if (Object.keys(format).length > 0) result[address] = format as CellFormatState
  }
  return result
}

export function readMcpCells(
  ctx: McpWorkbookReadContext,
  addresses: readonly string[],
  sheetId?: string,
): Record<string, { value: CellScalar; formula?: string }> {
  const result: Record<string, { value: CellScalar; formula?: string }> = {}
  const workbook = ctx.univerRef.current?.univerAPI.getActiveWorkbook()
  const state = ctx.lazyWorkbookRef.current
  if (state) {
    const worksheet =
      sheetId === undefined ? workbook?.getActiveSheet() : workbook?.getSheetBySheetId(sheetId)
    if (!worksheet) return result
    const reader = lazyCellReader(worksheet)
    for (const address of addresses) {
      const cell = reader(address)
      result[address] = cell.formula
        ? { value: cell.value, formula: cell.formula }
        : { value: cell.value }
    }
    return result
  }
  const sheets = ctx.adapterRef.current.getSnapshot().sheets
  const targetId = sheetId ?? workbook?.getActiveSheet()?.getSheetId()
  const sheet = sheets.find((entry) => entry.id === targetId) ?? (sheetId === undefined ? sheets[0] : undefined)
  if (!sheet) return result
  const worksheet =
    sheetId === undefined ? workbook?.getActiveSheet() : workbook?.getSheetBySheetId(sheetId)
  for (const address of addresses) {
    const cell = sheet.cells[address] ?? { value: null }
    if (cell.formula) {
      let computed = cell.value
      if (computed === null && worksheet) {
        try {
          computed = worksheet.getRange(address).getValue() ?? null
        } catch {
          // Fall back to the persisted value when the grid cannot resolve it.
        }
      }
      result[address] = { value: computed, formula: cell.formula }
    } else {
      result[address] = { value: cell.value }
    }
  }
  return result
}
