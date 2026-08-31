import type { TableRenderNode } from '@nexoffice/pptx-render'

export function tableLocalPointFromStage(
  stagePoint: { x: number; y: number },
  box: {
    x: number
    y: number
    w: number
    h: number
    rotationDeg?: number
    flipH?: boolean
    flipV?: boolean
  },
  bleed = 0,
): { x: number; y: number } {
  const px = stagePoint.x - bleed
  const py = stagePoint.y - bleed
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = px - cx
  const dy = py - cy
  const radians = ((box.rotationDeg ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  let x = dx * cos + dy * sin
  let y = -dx * sin + dy * cos
  if (box.flipH) x = -x
  if (box.flipV) y = -y
  return { x: x + box.w / 2, y: y + box.h / 2 }
}

export function tableCellAtPoint(
  table: Pick<TableRenderNode, 'cells'>,
  point: { x: number; y: number },
) {
  return table.cells.find(
    (cell) =>
      point.x >= cell.x &&
      point.x < cell.x + cell.w &&
      point.y >= cell.y &&
      point.y < cell.y + cell.h,
  )
}

export function tableCellOverlayBox(
  box: {
    x: number
    y: number
    w: number
    h: number
    rotationDeg?: number
    flipH?: boolean
    flipV?: boolean
  },
  cell: { x: number; y: number; w: number; h: number },
) {
  const radians = ((box.rotationDeg ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  let dx = cell.x + cell.w / 2 - box.w / 2
  let dy = cell.y + cell.h / 2 - box.h / 2
  if (box.flipH) dx = -dx
  if (box.flipV) dy = -dy
  return {
    x: box.x + box.w / 2 + dx * cos - dy * sin - cell.w / 2,
    y: box.y + box.h / 2 + dx * sin + dy * cos - cell.h / 2,
    w: cell.w,
    h: cell.h,
    rotationDeg: box.rotationDeg ?? 0,
    flipH: box.flipH ?? false,
    flipV: box.flipV ?? false,
  }
}
