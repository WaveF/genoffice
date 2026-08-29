export interface SourceSelection {
  start: number
  end: number
}

export interface SourceEdit {
  value: string
  selection: SourceSelection
}

export type SourceInline = 'bold' | 'italic' | 'strike' | 'code'
export type SourceBlock = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'codeBlock'
export type SourceList = 'bullet' | 'ordered' | 'task'
export type SourceTableOperation =
  | 'add_row_before'
  | 'add_row_after'
  | 'delete_row'
  | 'add_column_left'
  | 'add_column_right'
  | 'delete_column'
  | 'delete_table'

const INLINE_MARKERS: Record<SourceInline, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
}

function clampSelection(value: string, selection: SourceSelection): SourceSelection {
  const start = Math.max(0, Math.min(value.length, selection.start))
  const end = Math.max(start, Math.min(value.length, selection.end))
  return { start, end }
}

function replace(value: string, selection: SourceSelection, text: string, next: SourceSelection): SourceEdit {
  const range = clampSelection(value, selection)
  return { value: value.slice(0, range.start) + text + value.slice(range.end), selection: next }
}

export function toggleInlineSource(
  value: string,
  selection: SourceSelection,
  kind: SourceInline,
): SourceEdit {
  const range = clampSelection(value, selection)
  const marker = INLINE_MARKERS[kind]
  if (range.start === range.end) {
    return replace(value, range, `${marker}${marker}`, {
      start: range.start + marker.length,
      end: range.start + marker.length,
    })
  }
  if (
    range.start >= marker.length &&
    value.slice(range.start - marker.length, range.start) === marker &&
    value.slice(range.end, range.end + marker.length) === marker
  ) {
    const unwrapped = value.slice(range.start, range.end)
    return replace(value, { start: range.start - marker.length, end: range.end + marker.length }, unwrapped, {
      start: range.start - marker.length,
      end: range.end - marker.length,
    })
  }
  const selected = value.slice(range.start, range.end)
  return replace(value, range, `${marker}${selected}${marker}`, {
    start: range.start + marker.length,
    end: range.end + marker.length,
  })
}

function lineBounds(value: string, selection: SourceSelection): { start: number; end: number } {
  const range = clampSelection(value, selection)
  const start = value.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1
  const endBreak = value.indexOf('\n', range.end)
  return { start, end: endBreak < 0 ? value.length : endBreak }
}

function editLines(
  value: string,
  selection: SourceSelection,
  transform: (line: string, index: number) => string,
): SourceEdit {
  const bounds = lineBounds(value, selection)
  const before = value.slice(0, bounds.start)
  const original = value.slice(bounds.start, bounds.end)
  const after = value.slice(bounds.end)
  const nextLines = original.split('\n').map(transform)
  const next = nextLines.join('\n')
  return {
    value: before + next + after,
    selection: { start: bounds.start, end: bounds.start + next.length },
  }
}

export function toggleBlockSource(
  value: string,
  selection: SourceSelection,
  block: SourceBlock,
): SourceEdit {
  if (block === 'codeBlock') {
    const bounds = lineBounds(value, selection)
    const selected = value.slice(bounds.start, bounds.end)
    const fenced = selected.startsWith('```\n') && selected.endsWith('\n```')
    const next = fenced ? selected.slice(4, -4) : `\`\`\`\n${selected}\n\`\`\``
    return replace(value, bounds, next, { start: bounds.start, end: bounds.start + next.length })
  }
  const prefix = block === 'quote' ? '> ' : block === 'paragraph' ? '' : `${'#'.repeat(Number(block.slice(1)))} `
  return editLines(value, selection, (line) => {
    const withoutBlock = line.replace(/^(?:#{1,6}\s+|>\s?)/, '')
    return prefix ? `${prefix}${withoutBlock}` : withoutBlock
  })
}

export function toggleListSource(
  value: string,
  selection: SourceSelection,
  list: SourceList,
): SourceEdit {
  const prefix = list === 'bullet' ? '- ' : list === 'ordered' ? '1. ' : '- [ ] '
  const marker = /^(?:- \[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/
  const bounds = lineBounds(value, selection)
  const allMarked = value
    .slice(bounds.start, bounds.end)
    .split('\n')
    .filter((line) => line.trim())
    .every((line) => marker.test(line))
  return editLines(value, selection, (line) => {
    if (!line.trim()) return line
    const without = line.replace(marker, '')
    return allMarked ? without : `${prefix}${without}`
  })
}

export function insertSourceText(
  value: string,
  selection: SourceSelection,
  text: string,
  selectInserted = false,
): SourceEdit {
  const range = clampSelection(value, selection)
  return replace(value, range, text, {
    start: range.start + text.length,
    end: selectInserted ? range.start + text.length : range.start + text.length,
  })
}

export function insertLinkSource(value: string, selection: SourceSelection, url: string): SourceEdit {
  const range = clampSelection(value, selection)
  const label = value.slice(range.start, range.end) || 'link text'
  const link = `[${label}](${url})`
  const labelStart = range.start + 1
  return replace(value, range, link, { start: labelStart, end: labelStart + label.length })
}

export function insertTableSource(value: string, selection: SourceSelection): SourceEdit {
  const range = clampSelection(value, selection)
  const table = '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |'
  const beforeBreak = range.start > 0 && value[range.start - 1] !== '\n' ? '\n\n' : ''
  const afterBreak = range.end < value.length && value[range.end] !== '\n' ? '\n\n' : ''
  const replacement = `${beforeBreak}${table}${afterBreak}`
  const firstCell = range.start + beforeBreak.length + '| Column 1 | '.length
  return replace(value, range, replacement, { start: firstCell, end: firstCell })
}

interface TableRange {
  start: number
  end: number
  lineStarts: number[]
  lines: string[]
  header: number
  divider: number
  last: number
  activeLine: number
  activeColumn: number
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isDivider(line: string): boolean {
  const parts = cells(line)
  return parts.length > 0 && parts.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isTableLine(line: string): boolean {
  return /\|/.test(line) && cells(line).length > 1
}

function renderCells(nextCells: string[]): string {
  return `| ${nextCells.join(' | ')} |`
}

function tableRange(value: string, selection: SourceSelection): TableRange | null {
  const range = clampSelection(value, selection)
  const lines = value.split('\n')
  const lineStarts: number[] = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }
  const activeLine = Math.max(
    0,
    lines.findIndex((line, index) => range.start >= lineStarts[index] && range.start <= lineStarts[index] + line.length),
  )
  for (let header = Math.min(activeLine, lines.length - 2); header >= 0; header--) {
    if (!isTableLine(lines[header]) || !isDivider(lines[header + 1])) continue
    let last = header + 1
    while (last + 1 < lines.length && isTableLine(lines[last + 1])) last++
    if (activeLine < header || activeLine > last) continue
    const local = Math.max(0, range.start - lineStarts[activeLine])
    const before = lines[activeLine].slice(0, local)
    const activeColumn = Math.max(0, before.split('|').length - 2)
    return {
      start: lineStarts[header],
      end: lineStarts[last] + lines[last].length,
      lineStarts,
      lines,
      header,
      divider: header + 1,
      last,
      activeLine,
      activeColumn,
    }
  }
  return null
}

export function hasSourceTableAt(value: string, selection: SourceSelection): boolean {
  return tableRange(value, selection) !== null
}

export function editSourceTable(
  value: string,
  selection: SourceSelection,
  operation: SourceTableOperation,
): SourceEdit | null {
  const table = tableRange(value, selection)
  if (!table) return null
  const next = [...table.lines]
  const columnCount = cells(next[table.header]).length
  const dataLine = Math.max(table.divider + 1, table.activeLine)
  const replaceTable = (last = table.last) => {
    const rebuilt = next.slice(table.header, last + 1).join('\n')
    return replace(value, { start: table.start, end: table.end }, rebuilt, {
      start: table.start,
      end: table.start,
    })
  }
  if (operation === 'delete_table') {
    return replace(value, { start: table.start, end: table.end }, '', {
      start: table.start,
      end: table.start,
    })
  }
  if (operation === 'add_row_before' || operation === 'add_row_after') {
    const at = operation === 'add_row_before' ? dataLine : Math.min(table.last + 1, dataLine + 1)
    next.splice(at, 0, renderCells(Array.from({ length: columnCount }, () => '')))
    return replaceTable(table.last + 1)
  }
  if (operation === 'delete_row') {
    if (table.activeLine <= table.divider) return null
    if (table.last === table.divider + 1) return editSourceTable(value, selection, 'delete_table')
    next.splice(table.activeLine, 1)
    return replaceTable()
  }
  const column = Math.min(columnCount - 1, table.activeColumn)
  if (operation === 'delete_column' && columnCount === 1)
    return editSourceTable(value, selection, 'delete_table')
  for (let index = table.header; index <= table.last; index++) {
    const row = cells(next[index])
    const at = operation === 'add_column_left' ? column : column + 1
    if (operation === 'add_column_left' || operation === 'add_column_right') {
      row.splice(at, 0, index === table.divider ? '---' : '')
    } else if (operation === 'delete_column') {
      row.splice(column, 1)
    }
    next[index] = renderCells(row)
  }
  return replaceTable()
}
