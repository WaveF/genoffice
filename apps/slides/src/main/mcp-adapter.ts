import { webContents } from 'electron'
import { CapabilityError, type ToolRisk } from '@genoffice/capabilities'
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

const MAX_READ_RESULT_BYTES = 512 * 1024
const SENSITIVE_OUTPUT_FIELDS = new Set(['archive', 'bytes', 'data', 'mediapath', 'path', 'source'])

function requireSession(webContentsId: number): Session {
  const session = sessions.get(webContentsId)
  if (!session)
    throw new CapabilityError('renderer_unavailable', 'Slides document is no longer available')
  return session
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

function notifyRenderer(webContentsId: number, session: Session): void {
  webContents.fromId(webContentsId)?.send('slides:deck-changed', {
    slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
    size: { cx: session.opened.deck.size.cx, cy: session.opened.deck.size.cy },
  })
}

/** Main-process Slides facade used by MCP only; it never accepts renderer IPC envelopes. */
export class SlidesMcpAdapter {
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

  undo(webContentsId: number, expectedRevision: number): SlidesMcpHistoryResult {
    const session = requireSession(webContentsId)
    ensureExpectedRevision(session, expectedRevision)
    if (session.masterEdit) {
      throw new CapabilityError('validation_error', 'Undo is unavailable while editing a master slide')
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
      throw new CapabilityError('validation_error', 'Redo is unavailable while editing a master slide')
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
}
