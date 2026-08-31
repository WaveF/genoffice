import { describe, expect, it } from 'vitest'
import { tableCellAtPoint, tableCellOverlayBox, tableLocalPointFromStage } from '../src/renderer/table-hit'

const table = { cells: [{ row: 0, col: 0, x: 0, y: 0, w: 100, h: 50 }] } as never

describe('rotated table hit testing', () => {
  it('maps a rotated stage point into its table-local cell', () => {
    const box = { x: 100, y: 100, w: 100, h: 50, rotationDeg: 90 }
    const local = tableLocalPointFromStage({ x: 175, y: 125 }, box)
    expect(tableCellAtPoint(table, local)).toMatchObject({ row: 0, col: 0 })
  })

  it('keeps the edit overlay aligned with the transformed table cell', () => {
    expect(tableCellOverlayBox({ x: 100, y: 100, w: 100, h: 50, rotationDeg: 90 }, table.cells[0]!)).toMatchObject({
      x: 100,
      y: 100,
      rotationDeg: 90,
    })
  })
})
