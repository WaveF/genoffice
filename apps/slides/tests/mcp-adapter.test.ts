import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankPptx, openPptx } from '@nexoffice/pptx-engine'

const send = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  webContents: { fromId: () => ({ send }) },
}))
vi.mock('../src/main/fonts', () => ({
  createSystemFontMetrics: () => ({
    metrics: () => ({ ascent: 16, descent: 4, lineGap: 0 }),
    measure: (text: string) => text.length * 8,
  }),
}))

import { SlidesMcpAdapter, waitForSlidesMcpSession } from '../src/main/mcp-adapter'
import { journalOps, sessions, type Session } from '../src/main/session-state'

const WEB_CONTENTS_ID = 901

describe('SlidesMcpAdapter', () => {
  let adapter: SlidesMcpAdapter
  let session: Session

  beforeEach(async () => {
    send.mockClear()
    adapter = new SlidesMcpAdapter(undefined, async () => ({ pngBase64: 'iVBORw0KGgo=' }))
    session = {
      path: '',
      opened: await openPptx(await createBlankPptx()),
      fitWidthPx: 1280,
      undoStack: [],
      redoStack: [],
    }
    sessions.set(WEB_CONTENTS_ID, session)
  })

  afterEach(() => {
    sessions.delete(WEB_CONTENTS_ID)
  })

  it('uses a real session for dry-run, mutation, conflict detection, undo and redo', () => {
    const before = { ...session.opened.deck.size }
    const ops = [{ op: 'setSlideSize', cx: before.cx + 1000, cy: before.cy + 1000 }]

    expect(adapter.getDeckContext(WEB_CONTENTS_ID)).toMatchObject({ revision: 0, slideCount: 1 })
    expect(adapter.readSlide(WEB_CONTENTS_ID, 0)).toMatchObject({ revision: 0, index: 0 })

    expect(adapter.applyOps(WEB_CONTENTS_ID, ops, 0, true)).toMatchObject({
      applied: false,
      dryRun: true,
      revision: 0,
    })
    expect(session.opened.deck.size).toEqual(before)

    expect(adapter.applyOps(WEB_CONTENTS_ID, ops, 0)).toMatchObject({ applied: true, revision: 1 })
    expect(session.opened.deck.size).toEqual({ cx: before.cx + 1000, cy: before.cy + 1000 })
    expect(() => adapter.applyOps(WEB_CONTENTS_ID, ops, 0)).toThrow(/changed since it was read/)

    expect(adapter.undo(WEB_CONTENTS_ID, 1)).toEqual({ applied: true, revision: 2 })
    expect(session.opened.deck.size).toEqual(before)
    expect(adapter.redo(WEB_CONTENTS_ID, 2)).toEqual({ applied: true, revision: 3 })
    expect(session.opened.deck.size).toEqual({ cx: before.cx + 1000, cy: before.cy + 1000 })
  })

  it('rejects a stale MCP write after a manually journaled editor transaction', () => {
    const before = { ...session.opened.deck.size }
    const ops = [{ op: 'setSlideSize', cx: before.cx + 1000, cy: before.cy + 1000 }]

    // The editor's normal transaction path journals every successful manual edit.
    journalOps(session, 'edit', [{ op: { op: 'setSlideSize', cx: before.cx, cy: before.cy } }])
    expect(session.revision).toBe(1)

    try {
      adapter.applyOps(WEB_CONTENTS_ID, ops, 0)
      throw new Error('A stale MCP mutation unexpectedly succeeded')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'conflict',
        details: { expectedRevision: 0, actualRevision: 1 },
      })
    }
  })

  it('renders a slide preview through the injected renderer-only callback', async () => {
    const preview = await adapter.renderSlidePreview(WEB_CONTENTS_ID, 0)
    expect(preview).toMatchObject({
      revision: 0,
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
    })
  })

  it('exposes and applies stable CSS-style logical layout geometry', () => {
    const inserted = adapter.applyOps(
      WEB_CONTENTS_ID,
      [
        {
          op: 'addElement',
          target: { slide: 0 },
          kind: 'textbox',
          offset: { x: 914400, y: 457200, cx: 1828800, cy: 457200 },
          paragraphs: [{ runs: [{ text: 'Layout title', fontSize: 24 }] }],
        },
      ],
      0,
    )
    const elementId = inserted.records?.[0]?.created?.[0]
    expect(elementId).toBeTruthy()

    const layout = adapter.getLayoutContext(WEB_CONTENTS_ID, 0)
    expect(layout).toMatchObject({
      revision: 1,
      coordinateSystem: { unit: 'px', origin: 'top-left', dpi: 96 },
      slide: { width: 1280, height: 720 },
    })
    const element = layout.elements.find((candidate) => candidate.sourceId === elementId)
    expect(element).toMatchObject({
      bounds: { x: 96, y: 48, width: 192, height: 48 },
      text: { wrap: true },
    })

    const changed = adapter.applyLayout(
      WEB_CONTENTS_ID,
      [
        {
          slide: layout.slideId,
          elementId: element!.id,
          bounds: { x: 120, y: 90, width: 400, height: 100 },
          rotationDeg: 15,
        },
      ],
      1,
    )
    expect(changed).toMatchObject({ applied: true, revision: 2 })
    expect(
      adapter
        .getLayoutContext(WEB_CONTENTS_ID, 0)
        .elements.find((candidate) => candidate.sourceId === elementId),
    ).toMatchObject({
      bounds: { x: 120, y: 90, width: 400, height: 100 },
      transform: { rotationDeg: 15 },
    })
  })

  it('reports laid-out horizontal text overflow without an AI or image pass', () => {
    const inserted = adapter.applyOps(
      WEB_CONTENTS_ID,
      [
        {
          op: 'addElement',
          target: { slide: 0 },
          kind: 'textbox',
          offset: { x: 914400, y: 457200, cx: 457200, cy: 457200 },
          bodyPr: { wrap: false },
          paragraphs: [
            { runs: [{ text: 'unbreakable-layout-token-that-is-deliberately-too-wide' }] },
          ],
        },
      ],
      0,
    )
    const sourceId = inserted.records?.[0]?.created?.[0]
    const audit = adapter.auditLayout(WEB_CONTENTS_ID, 0)
    expect(audit).toMatchObject({ revision: 1, coordinateSystem: { unit: 'px' } })
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'text-horizontal-overflow',
          sourceId,
          overflow: expect.objectContaining({ right: expect.any(Number) }),
        }),
      ]),
    )
  })

  it('supports explicit slide lifecycle and application-controlled save callbacks', async () => {
    expect(adapter.addSlide(WEB_CONTENTS_ID, 0, 0)).toMatchObject({ applied: true, revision: 1 })
    expect(session.opened.deck.slides).toHaveLength(2)
    expect(adapter.deleteSlide(WEB_CONTENTS_ID, 1, 1)).toMatchObject({ applied: true, revision: 2 })
    expect(session.opened.deck.slides).toHaveLength(1)

    const save = vi.fn(async () => ({ ok: true as const, path: '/not-exposed.pptx' }))
    const savingAdapter = new SlidesMcpAdapter(save)
    await expect(savingAdapter.save(WEB_CONTENTS_ID, 2)).resolves.toEqual({
      saved: true,
      revision: 2,
    })
    expect(save).toHaveBeenCalledWith(WEB_CONTENTS_ID)
  })

  it('maps renderer preview failures to the standard renderer-unavailable error', async () => {
    const unavailable = new SlidesMcpAdapter(undefined, async () => {
      throw new Error('renderer reloaded')
    })
    await expect(unavailable.renderSlidePreview(WEB_CONTENTS_ID, 0)).rejects.toMatchObject({
      code: 'renderer_unavailable',
    })
  })

  it('waits until a newly mounted Slides renderer registers its session', async () => {
    const pendingWebContentsId = WEB_CONTENTS_ID + 1
    const ready = waitForSlidesMcpSession(pendingWebContentsId)
    queueMicrotask(() => sessions.set(pendingWebContentsId, session))
    await expect(ready).resolves.toBeUndefined()
    sessions.delete(pendingWebContentsId)
  })
})
