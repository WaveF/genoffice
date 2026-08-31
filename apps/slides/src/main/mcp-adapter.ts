import { webContents } from 'electron'
import { CapabilityError, type ToolRisk } from '@nexoffice/capabilities'
import { type RenderNode, type RenderTextLayout } from '@nexoffice/pptx-render'
import { elementDurableId, slideDurableId, type Op, runTxn } from './ops'
import { mcpOpsRisk, validateMcpOps } from './mcp-op-guard'
import {
  buildAllRenderSlides,
  journalOps,
  pushHistory,
  restoreSnapshot,
  scheduleDeckBroadcast,
  scheduleHistoryNotify,
  settleStaleHistoryBatch,
  sessions,
  takeSnapshot,
  type Session,
} from './session-state'

export interface SlidesMcpDeckContext {
  revision: number
  slideCount: number
  slides: Array<{ slideId: string; index: number; elementCount: number }>
}

export interface SlidesMcpSlide {
  revision: number
  slideId: string
  index: number
  /** Engine-native, JSON-safe editable element objects; byte/file payloads are excluded. */
  elements: unknown[]
}

type LayoutBounds = { x: number; y: number; width: number; height: number }

export interface SlidesMcpLayoutElement {
  /** Durable id when available, otherwise the engine source id accepted by Slides operations. */
  id: string
  sourceId: string
  type: RenderNode['type']
  /** CSS-style geometry in the logical slide coordinate system. */
  bounds: LayoutBounds
  /** Axis-aligned bounds after the element's own rotation; effects are intentionally excluded. */
  visualBounds: LayoutBounds
  transform: { rotationDeg: number; flipX: boolean; flipY: boolean }
  zIndex: number
  /** Group child coordinates are relative to the parent group; root elements use "slide". */
  coordinateSpace: 'slide' | 'parent'
  parentId?: string
  text?: {
    padding: { top: number; right: number; bottom: number; left: number }
    wrap: boolean
    verticalAlign: 'top' | 'middle' | 'bottom'
    autofit?: 'none' | 'shrink' | 'resize'
  }
  image?: {
    intrinsicSize?: { width: number; height: number }
    crop?: { top: number; right: number; bottom: number; left: number }
  }
  children?: SlidesMcpLayoutElement[]
}

export interface SlidesMcpLayoutContext {
  revision: number
  slideId: string
  index: number
  coordinateSystem: {
    unit: 'px'
    origin: 'top-left'
    dpi: 96
    cssEquivalent: string
    groupChildBounds: 'relative-to-parent'
  }
  slide: { width: number; height: number }
  elements: SlidesMcpLayoutElement[]
}

export interface SlidesMcpLayoutAudit {
  revision: number
  slideId: string
  index: number
  /** The audit is deterministic renderer geometry, not image/AI analysis. */
  coordinateSystem: { unit: 'px'; origin: 'top-left' }
  issues: Array<{
    code: 'text-horizontal-overflow'
    severity: 'warning'
    elementId: string
    sourceId: string
    bounds: LayoutBounds
    contentBounds: LayoutBounds
    overflow: { left: number; right: number }
    message: string
    parentGroupId?: string
    tableCell?: { row: number; col: number }
  }>
}

export interface SlidesMcpLayoutChange {
  slide: number | string
  elementId: string
  bounds: LayoutBounds
  rotationDeg?: number
  /** Required only when changing a direct child of a group. */
  parentGroupId?: string
}

export interface SlidesMcpApplyResult {
  applied: boolean
  dryRun?: boolean
  revision: number
  plan?: string[]
  records?: Array<{ op: string; slideId?: string; created?: string[] }>
  failures?: Array<{ index: number; error: string }>
}

export interface SlidesMcpHistoryResult {
  applied: boolean
  revision: number
}

export interface SlidesMcpPreview {
  revision: number
  slideId: string
  mimeType: 'image/png'
  base64: string
}

const MAX_READ_RESULT_BYTES = 512 * 1024
const SENSITIVE_OUTPUT_FIELDS = new Set(['archive', 'bytes', 'data', 'mediapath', 'path', 'source'])
const MCP_SESSION_READY_TIMEOUT_MS = 15_000
const MCP_SESSION_READY_POLL_MS = 25
/** Stable logical canvas width used by all MCP layout reads and writes. */
const MCP_LAYOUT_WIDTH_PX = 1280
const MAX_LAYOUT_MULTIPLIER = 8

function requireSession(webContentsId: number): Session {
  const session = sessions.get(webContentsId)
  if (!session)
    throw new CapabilityError('renderer_unavailable', 'Slides document is no longer available')
  return session
}

/**
 * A blank Slides deck is created by the renderer's `slides:new-blank` IPC
 * during mount. MCP document creation waits on this before returning its
 * documentId so the caller can immediately read or edit the new deck.
 */
export async function waitForSlidesMcpSession(webContentsId: number): Promise<void> {
  const deadline = Date.now() + MCP_SESSION_READY_TIMEOUT_MS
  while (!sessions.has(webContentsId)) {
    if (Date.now() >= deadline) {
      throw new CapabilityError(
        'renderer_unavailable',
        'Slides document did not become ready in time',
      )
    }
    await new Promise<void>((resolve) => setTimeout(resolve, MCP_SESSION_READY_POLL_MS))
  }
}

function jsonSafe(value: unknown, label: string): unknown {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new CapabilityError('internal_error', `${label} could not be serialized`)
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_READ_RESULT_BYTES) {
    throw new CapabilityError('validation_error', `${label} exceeds the MCP response size limit`)
  }
  return JSON.parse(encoded) as unknown
}

function stripSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveFields)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_OUTPUT_FIELDS.has(key.toLowerCase()))
      .map(([key, nested]) => [key, stripSensitiveFields(nested)]),
  )
}

function compactFailures(failures: Array<{ index: number; error: string }> | undefined) {
  return failures?.map(({ index, error }) => ({ index, error }))
}

function ensureExpectedRevision(session: Session, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new CapabilityError('validation_error', 'expectedRevision must be a non-negative integer')
  }
  const actual = session.revision ?? 0
  if (actual !== expectedRevision) {
    throw new CapabilityError('conflict', 'Slides document changed since it was read', {
      expectedRevision,
      actualRevision: actual,
    })
  }
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}

function layoutBounds(node: RenderNode): LayoutBounds {
  return {
    x: rounded(node.box.x),
    y: rounded(node.box.y),
    width: rounded(node.box.w),
    height: rounded(node.box.h),
  }
}

function rotatedBounds(node: RenderNode): LayoutBounds {
  const { x, y, w, h, centerX, centerY, rotationDeg } = node.box
  if (!rotationDeg) return layoutBounds(node)
  const radians = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const corners = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ].map(([pointX, pointY]) => ({
    x: centerX + (pointX - centerX) * cos - (pointY - centerY) * sin,
    y: centerY + (pointX - centerX) * sin + (pointY - centerY) * cos,
  }))
  const left = Math.min(...corners.map((corner) => corner.x))
  const top = Math.min(...corners.map((corner) => corner.y))
  const right = Math.max(...corners.map((corner) => corner.x))
  const bottom = Math.max(...corners.map((corner) => corner.y))
  return {
    x: rounded(left),
    y: rounded(top),
    width: rounded(right - left),
    height: rounded(bottom - top),
  }
}

function imageIntrinsicSize(
  dataUrl: string | undefined,
): { width: number; height: number } | undefined {
  if (!dataUrl) return undefined
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !/;base64$/i.test(dataUrl.slice(0, comma))) return undefined
  let bytes: Buffer
  try {
    bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64')
  } catch {
    return undefined
  }
  if (bytes.length >= 24 && bytes.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (
    bytes.length >= 10 &&
    (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let index = 2; index + 9 < bytes.length;) {
      if (bytes[index] !== 0xff) return undefined
      const marker = bytes[index + 1]!
      const length = bytes.readUInt16BE(index + 2)
      if (length < 2 || index + 2 + length > bytes.length) return undefined
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      )
        return { height: bytes.readUInt16BE(index + 5), width: bytes.readUInt16BE(index + 7) }
      index += 2 + length
    }
  }
  return undefined
}

function toLayoutElement(
  node: RenderNode,
  zIndex: number,
  coordinateSpace: 'slide' | 'parent',
  parentId?: string,
): SlidesMcpLayoutElement {
  const id = node.durableId ?? node.sourceId
  const result: SlidesMcpLayoutElement = {
    id,
    sourceId: node.sourceId,
    type: node.type,
    bounds: layoutBounds(node),
    visualBounds: rotatedBounds(node),
    transform: {
      rotationDeg: rounded(node.box.rotationDeg),
      flipX: node.box.flipH,
      flipY: node.box.flipV,
    },
    zIndex,
    coordinateSpace,
    ...(parentId ? { parentId } : {}),
  }
  if ((node.type === 'shape' || node.type === 'text') && node.text) {
    result.text = {
      padding: {
        top: rounded(node.text.insets.t),
        right: rounded(node.text.insets.r),
        bottom: rounded(node.text.insets.b),
        left: rounded(node.text.insets.l),
      },
      wrap: node.text.wrap,
      verticalAlign: node.text.anchor,
      ...(node.text.autofit ? { autofit: node.text.autofit } : {}),
    }
  }
  if (node.type === 'picture') {
    const intrinsicSize = imageIntrinsicSize(node.dataUrl)
    result.image = {
      ...(intrinsicSize ? { intrinsicSize } : {}),
      ...(node.srcRect
        ? {
            crop: {
              top: node.srcRect.t,
              right: node.srcRect.r,
              bottom: node.srcRect.b,
              left: node.srcRect.l,
            },
          }
        : {}),
    }
  }
  if (node.type === 'group') {
    result.children = node.children.map((child, index) =>
      toLayoutElement(child, index, 'parent', id),
    )
  }
  return result
}

function validateLayoutBounds(
  bounds: LayoutBounds,
  slide: { width: number; height: number },
): void {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new CapabilityError(
      'validation_error',
      'bounds must contain finite x, y, width, and height numbers',
    )
  }
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new CapabilityError(
      'validation_error',
      'bounds width and height must be greater than zero',
    )
  }
  if (
    Math.abs(bounds.x) > slide.width * MAX_LAYOUT_MULTIPLIER ||
    Math.abs(bounds.y) > slide.height * MAX_LAYOUT_MULTIPLIER ||
    bounds.width > slide.width * MAX_LAYOUT_MULTIPLIER ||
    bounds.height > slide.height * MAX_LAYOUT_MULTIPLIER
  ) {
    throw new CapabilityError(
      'validation_error',
      'bounds exceed the supported logical slide coordinate range',
    )
  }
}

function textOverflow(
  text: RenderTextLayout,
  bounds: LayoutBounds,
): { contentBounds: LayoutBounds; left: number; right: number } | undefined {
  const contentBounds = {
    x: bounds.x + text.insets.l,
    y: bounds.y + text.insets.t,
    width: Math.max(0, bounds.width - text.insets.l - text.insets.r),
    height: Math.max(0, bounds.height - text.insets.t - text.insets.b),
  }
  const runs = text.lines.flatMap((line) => line.runs)
  if (!runs.length) return undefined
  const left = Math.min(...runs.map((run) => bounds.x + run.x))
  const right = Math.max(...runs.map((run) => bounds.x + run.x + run.widthPx))
  const tolerance = 1
  const leftOverflow = Math.max(0, contentBounds.x - left - tolerance)
  const rightOverflow = Math.max(0, right - (contentBounds.x + contentBounds.width) - tolerance)
  if (!leftOverflow && !rightOverflow) return undefined
  return {
    contentBounds: {
      x: rounded(contentBounds.x),
      y: rounded(contentBounds.y),
      width: rounded(contentBounds.width),
      height: rounded(contentBounds.height),
    },
    left: rounded(leftOverflow),
    right: rounded(rightOverflow),
  }
}

function notifyRenderer(webContentsId: number, session: Session): void {
  webContents.fromId(webContentsId)?.send('slides:deck-changed', {
    slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
    size: { cx: session.opened.deck.size.cx, cy: session.opened.deck.size.cy },
  })
}

/** Main-process Slides facade used by MCP only; it never accepts renderer IPC envelopes. */
export class SlidesMcpAdapter {
  constructor(
    private readonly saveOpenDocument?: (
      webContentsId: number,
    ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>,
    private readonly renderPreview?: (
      webContentsId: number,
      slideIndex: number,
    ) => Promise<{ pngBase64: string }>,
  ) {}

  opsRisk(rawOps: unknown): ToolRisk {
    try {
      return mcpOpsRisk(rawOps)
    } catch (error) {
      throw new CapabilityError(
        'validation_error',
        error instanceof Error ? error.message : 'Invalid slides operation payload',
      )
    }
  }

  getDeckContext(webContentsId: number): SlidesMcpDeckContext {
    const session = requireSession(webContentsId)
    return jsonSafe(
      {
        revision: session.revision ?? 0,
        slideCount: session.opened.deck.slides.length,
        slides: session.opened.deck.slides.map((slide, index) => ({
          slideId: slideDurableId(slide),
          index,
          elementCount: slide.elements.length,
        })),
      },
      'Deck context',
    ) as SlidesMcpDeckContext
  }

  readSlide(webContentsId: number, slideRef: number | string): SlidesMcpSlide {
    const session = requireSession(webContentsId)
    const index =
      typeof slideRef === 'number'
        ? slideRef
        : session.opened.deck.slides.findIndex((slide) => slideDurableId(slide) === slideRef)
    const slide = session.opened.deck.slides[index]
    if (!slide) throw new CapabilityError('not_found', 'Slide is not present in this document')
    const elements = slide.elements.map((element) =>
      stripSensitiveFields({ ...element, durableId: elementDurableId(element) }),
    )
    return jsonSafe(
      { revision: session.revision ?? 0, slideId: slideDurableId(slide), index, elements },
      'Slide response',
    ) as SlidesMcpSlide
  }

  getLayoutContext(webContentsId: number, slideRef: number | string): SlidesMcpLayoutContext {
    const session = requireSession(webContentsId)
    const index =
      typeof slideRef === 'number'
        ? slideRef
        : session.opened.deck.slides.findIndex((slide) => slideDurableId(slide) === slideRef)
    const slide = session.opened.deck.slides[index]
    if (!slide) throw new CapabilityError('not_found', 'Slide is not present in this document')
    const rendered = buildAllRenderSlides(session.opened, MCP_LAYOUT_WIDTH_PX)[index]
    if (!rendered) throw new CapabilityError('internal_error', 'Slide layout could not be built')
    return jsonSafe(
      {
        revision: session.revision ?? 0,
        slideId: slideDurableId(slide),
        index,
        coordinateSystem: {
          unit: 'px',
          origin: 'top-left',
          dpi: 96,
          cssEquivalent: 'position:absolute; left=x; top=y; width=width; height=height',
          groupChildBounds: 'relative-to-parent',
        },
        slide: { width: rounded(rendered.widthPx), height: rounded(rendered.heightPx) },
        elements: rendered.nodes.map((node, nodeIndex) =>
          toLayoutElement(node, nodeIndex, 'slide'),
        ),
      },
      'Slide layout context',
    ) as SlidesMcpLayoutContext
  }

  auditLayout(webContentsId: number, slideRef: number | string): SlidesMcpLayoutAudit {
    const session = requireSession(webContentsId)
    const index =
      typeof slideRef === 'number'
        ? slideRef
        : session.opened.deck.slides.findIndex((slide) => slideDurableId(slide) === slideRef)
    const slide = session.opened.deck.slides[index]
    if (!slide) throw new CapabilityError('not_found', 'Slide is not present in this document')
    const rendered = buildAllRenderSlides(session.opened, MCP_LAYOUT_WIDTH_PX)[index]
    if (!rendered) throw new CapabilityError('internal_error', 'Slide layout could not be built')
    const issues: SlidesMcpLayoutAudit['issues'] = []
    const inspect = (node: RenderNode, parentGroupId?: string): void => {
      const elementId = node.durableId ?? node.sourceId
      const bounds = layoutBounds(node)
      if ((node.type === 'shape' || node.type === 'text') && node.text) {
        const overflow = textOverflow(node.text, bounds)
        if (overflow) {
          issues.push({
            code: 'text-horizontal-overflow',
            severity: 'warning',
            elementId,
            sourceId: node.sourceId,
            bounds,
            contentBounds: overflow.contentBounds,
            overflow: { left: overflow.left, right: overflow.right },
            message: 'Laid-out text extends outside the horizontal content box.',
            ...(parentGroupId ? { parentGroupId } : {}),
          })
        }
      }
      if (node.type === 'table') {
        for (const cell of node.cells) {
          if (!cell.text) continue
          const cellBounds = {
            x: rounded(bounds.x + cell.x),
            y: rounded(bounds.y + cell.y),
            width: rounded(cell.w),
            height: rounded(cell.h),
          }
          const overflow = textOverflow(cell.text, cellBounds)
          if (overflow) {
            issues.push({
              code: 'text-horizontal-overflow',
              severity: 'warning',
              elementId,
              sourceId: node.sourceId,
              bounds: cellBounds,
              contentBounds: overflow.contentBounds,
              overflow: { left: overflow.left, right: overflow.right },
              message: 'Laid-out table cell text extends outside its horizontal content box.',
              ...(parentGroupId ? { parentGroupId } : {}),
              tableCell: { row: cell.row, col: cell.col },
            })
          }
        }
      }
      if (node.type === 'group') node.children.forEach((child) => inspect(child, elementId))
    }
    rendered.nodes.forEach((node) => inspect(node))
    return jsonSafe(
      {
        revision: session.revision ?? 0,
        slideId: slideDurableId(slide),
        index,
        coordinateSystem: { unit: 'px', origin: 'top-left' },
        issues,
      },
      'Slide layout audit',
    ) as SlidesMcpLayoutAudit
  }

  applyLayout(
    webContentsId: number,
    changes: SlidesMcpLayoutChange[],
    expectedRevision: number,
    dryRun = false,
  ): SlidesMcpApplyResult {
    const session = requireSession(webContentsId)
    ensureExpectedRevision(session, expectedRevision)
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > 50) {
      throw new CapabilityError(
        'validation_error',
        'changes must contain between 1 and 50 layout changes',
      )
    }
    const rendered = buildAllRenderSlides(session.opened, MCP_LAYOUT_WIDTH_PX)
    const emuPerLogicalPx = session.opened.deck.size.cx / MCP_LAYOUT_WIDTH_PX
    const ops: Op[] = changes.map((change, index) => {
      if (
        !change ||
        typeof change !== 'object' ||
        typeof change.elementId !== 'string' ||
        !change.elementId
      ) {
        throw new CapabilityError(
          'validation_error',
          `changes[${index}] requires a non-empty elementId`,
        )
      }
      const slideIndex =
        typeof change.slide === 'number'
          ? change.slide
          : session.opened.deck.slides.findIndex((slide) => slideDurableId(slide) === change.slide)
      const renderedSlide = rendered[slideIndex]
      if (!Number.isInteger(slideIndex) || !renderedSlide) {
        throw new CapabilityError(
          'not_found',
          `changes[${index}] references a slide that is not present`,
        )
      }
      validateLayoutBounds(change.bounds, {
        width: renderedSlide.widthPx,
        height: renderedSlide.heightPx,
      })
      if (
        change.rotationDeg !== undefined &&
        (!Number.isFinite(change.rotationDeg) || Math.abs(change.rotationDeg) > 3600)
      ) {
        throw new CapabilityError(
          'validation_error',
          `changes[${index}] rotationDeg must be a finite degree value`,
        )
      }
      const box = {
        x: Math.round(change.bounds.x * emuPerLogicalPx),
        y: Math.round(change.bounds.y * emuPerLogicalPx),
        cx: Math.round(change.bounds.width * emuPerLogicalPx),
        cy: Math.round(change.bounds.height * emuPerLogicalPx),
      }
      return {
        op: 'setTransform',
        target: { slide: slideIndex, el: change.elementId },
        ...(change.parentGroupId ? { group: change.parentGroupId, absBox: box } : { box }),
        ...(change.rotationDeg === undefined ? {} : { rotDeg: change.rotationDeg }),
      }
    })
    return this.applyOps(webContentsId, ops, expectedRevision, dryRun)
  }

  async renderSlidePreview(
    webContentsId: number,
    slideRef: number | string,
  ): Promise<SlidesMcpPreview> {
    const session = requireSession(webContentsId)
    if (!this.renderPreview)
      throw new CapabilityError('not_running', 'Slides preview support is unavailable')
    const index =
      typeof slideRef === 'number'
        ? slideRef
        : session.opened.deck.slides.findIndex((slide) => slideDurableId(slide) === slideRef)
    const slide = session.opened.deck.slides[index]
    if (!slide) throw new CapabilityError('not_found', 'Slide is not present in this document')
    try {
      const { pngBase64 } = await this.renderPreview(webContentsId, index)
      if (pngBase64.length > 384 * 1024)
        throw new Error('Preview exceeds the MCP response size limit')
      return {
        revision: session.revision ?? 0,
        slideId: slideDurableId(slide),
        mimeType: 'image/png',
        base64: pngBase64,
      }
    } catch (error) {
      throw new CapabilityError(
        'renderer_unavailable',
        error instanceof Error ? error.message : 'Preview renderer is unavailable',
      )
    }
  }

  applyOps(
    webContentsId: number,
    rawOps: unknown,
    expectedRevision: number,
    dryRun = false,
  ): SlidesMcpApplyResult {
    const session = requireSession(webContentsId)
    ensureExpectedRevision(session, expectedRevision)
    let ops: Op[]
    try {
      ops = validateMcpOps(rawOps)
    } catch (error) {
      throw new CapabilityError(
        'validation_error',
        error instanceof Error ? error.message : 'Invalid slides operation payload',
      )
    }
    const plan = runTxn(session.opened, { ops, dryRun: true })
    if (dryRun) {
      return {
        applied: false,
        dryRun: true,
        revision: session.revision ?? 0,
        plan: plan.plan ?? [],
        failures: compactFailures(plan.failures),
      }
    }
    if (plan.failures?.length) {
      return {
        applied: false,
        revision: session.revision ?? 0,
        failures: compactFailures(plan.failures),
      }
    }
    pushHistory(session)
    const result = runTxn(session.opened, { ops })
    if (!result.applied) {
      session.undoStack.pop()
      return {
        applied: false,
        revision: session.revision ?? 0,
        failures: compactFailures(result.failures),
      }
    }
    journalOps(session, 'mcp', result.records ?? [])
    scheduleDeckBroadcast(session)
    notifyRenderer(webContentsId, session)
    return {
      applied: true,
      revision: session.revision ?? 0,
      records: result.records?.map((record) => ({
        op: record.op.op,
        ...(record.slideId ? { slideId: record.slideId } : {}),
        ...(record.created ? { created: record.created } : {}),
      })),
    }
  }

  addSlide(
    webContentsId: number,
    afterSlide: number | string,
    expectedRevision: number,
  ): SlidesMcpApplyResult {
    return this.applyOps(
      webContentsId,
      [{ op: 'addBlankSlide', target: { slide: afterSlide } }],
      expectedRevision,
    )
  }

  deleteSlide(
    webContentsId: number,
    slide: number | string,
    expectedRevision: number,
  ): SlidesMcpApplyResult {
    return this.applyOps(
      webContentsId,
      [{ op: 'deleteSlide', target: { slide } }],
      expectedRevision,
    )
  }

  undo(webContentsId: number, expectedRevision: number): SlidesMcpHistoryResult {
    const session = requireSession(webContentsId)
    ensureExpectedRevision(session, expectedRevision)
    if (session.masterEdit) {
      throw new CapabilityError(
        'validation_error',
        'Undo is unavailable while editing a master slide',
      )
    }
    settleStaleHistoryBatch(session)
    const snapshot = session.undoStack.pop()
    if (!snapshot) return { applied: false, revision: session.revision ?? 0 }
    session.redoStack.push(takeSnapshot(session))
    restoreSnapshot(session, snapshot)
    scheduleHistoryNotify(session)
    scheduleDeckBroadcast(session)
    notifyRenderer(webContentsId, session)
    return { applied: true, revision: session.revision ?? 0 }
  }

  redo(webContentsId: number, expectedRevision: number): SlidesMcpHistoryResult {
    const session = requireSession(webContentsId)
    ensureExpectedRevision(session, expectedRevision)
    if (session.masterEdit) {
      throw new CapabilityError(
        'validation_error',
        'Redo is unavailable while editing a master slide',
      )
    }
    settleStaleHistoryBatch(session)
    const snapshot = session.redoStack.pop()
    if (!snapshot) return { applied: false, revision: session.revision ?? 0 }
    session.undoStack.push(takeSnapshot(session))
    restoreSnapshot(session, snapshot)
    scheduleHistoryNotify(session)
    scheduleDeckBroadcast(session)
    notifyRenderer(webContentsId, session)
    return { applied: true, revision: session.revision ?? 0 }
  }

  async save(
    webContentsId: number,
    expectedRevision: number,
  ): Promise<{ saved: boolean; revision: number }> {
    const session = requireSession(webContentsId)
    ensureExpectedRevision(session, expectedRevision)
    if (!this.saveOpenDocument) {
      throw new CapabilityError('not_running', 'Slides save support is unavailable')
    }
    const result = await this.saveOpenDocument(webContentsId)
    if (!result.ok)
      throw new CapabilityError('internal_error', `Slides save failed: ${result.error}`)
    return { saved: true, revision: session.revision ?? 0 }
  }
}
