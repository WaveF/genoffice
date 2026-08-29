import { describe, expect, it } from 'vitest'
import {
  editSourceTable,
  hasSourceTableAt,
  insertLinkSource,
  insertTableSource,
  toggleBlockSource,
  toggleInlineSource,
  toggleListSource,
} from '../src/renderer/markdown/sourceCommands'

describe('Markdown source editing commands', () => {
  it('wraps and unwraps inline selections without using the rich-text editor', () => {
    const wrapped = toggleInlineSource('hello', { start: 0, end: 5 }, 'bold')
    expect(wrapped).toEqual({ value: '**hello**', selection: { start: 2, end: 7 } })
    expect(toggleInlineSource(wrapped.value, wrapped.selection, 'bold')).toEqual({
      value: 'hello',
      selection: { start: 0, end: 5 },
    })
  })

  it('changes selected lines into Markdown blocks and lists', () => {
    expect(toggleBlockSource('one\ntwo', { start: 0, end: 7 }, 'h2').value).toBe('## one\n## two')
    expect(toggleBlockSource('> quote', { start: 0, end: 7 }, 'paragraph').value).toBe('quote')
    expect(toggleListSource('one\ntwo', { start: 0, end: 7 }, 'task').value).toBe(
      '- [ ] one\n- [ ] two',
    )
    expect(toggleListSource('- [ ] one\n- [ ] two', { start: 0, end: 19 }, 'task').value).toBe(
      'one\ntwo',
    )
  })

  it('inserts link and a default 3x3 GFM table at the source selection', () => {
    expect(insertLinkSource('name', { start: 0, end: 4 }, 'https://example.test').value).toBe(
      '[name](https://example.test)',
    )
    const table = insertTableSource('start', { start: 5, end: 5 })
    expect(table.value).toContain('| Column 1 | Column 2 | Column 3 |')
    expect(table.value).toContain('| --- | --- | --- |')
  })

  it('edits the GFM table that contains the source caret', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
    const selection = { start: source.indexOf('1'), end: source.indexOf('1') }
    expect(hasSourceTableAt(source, selection)).toBe(true)
    const row = editSourceTable(source, selection, 'add_row_after')!
    expect(row.value).toContain('| 1 | 2 |\n|  |  |\n| 3 | 4 |')
    const column = editSourceTable(row.value, { start: row.value.indexOf('1'), end: row.value.indexOf('1') }, 'add_column_right')!
    expect(column.value).toContain('| A |  | B |')
    const insertedColumn = column.value.indexOf('| A |  | B |') + '| A | '.length
    const deleted = editSourceTable(
      column.value,
      { start: insertedColumn, end: insertedColumn },
      'delete_column',
    )!
    expect(deleted.value).toContain('| A | B |')
  })
})
