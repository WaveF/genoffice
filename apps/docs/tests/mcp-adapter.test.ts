import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildBlankDocx, parseDocx, saveDocx } from '@genoffice/docx-engine'
import { handleDocsMcpRequest } from '../src/renderer/mcp-adapter'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'

function editor() {
  const insertContentAt = vi.fn()
  const undo = vi.fn(() => true)
  const redo = vi.fn(() => true)
  const forEach = (fn: (node: unknown, offset: number, index: number) => void) => {
    fn({ type: { name: 'paragraph' }, textContent: 'Alpha', nodeSize: 7 }, 0, 0)
    fn({ type: { name: 'heading' }, textContent: 'Beta', nodeSize: 6 }, 7, 1)
  }
  const nodeAt = (position: number) =>
    position === 0
      ? {
          type: { name: 'paragraph' },
          attrs: {},
          textContent: 'Alpha',
          nodeSize: 7,
          isTextblock: false,
        }
      : position === 7
        ? {
            type: { name: 'heading' },
            attrs: {},
            textContent: 'Beta',
            nodeSize: 6,
            isTextblock: false,
          }
        : null
  return {
    state: { doc: { content: { size: 12 }, textContent: 'AlphaBeta', forEach, nodeAt } },
    commands: { insertContentAt, undo, redo },
    insertContentAt,
    undo,
    redo,
  } as any
}

describe('Docs MCP adapter', () => {
  it('reads bounded explicit block ranges', () => {
    const e = editor()
    expect(handleDocsMcpRequest(e, 'docs.read_blocks', { start: 1, limit: 1 })).toMatchObject({
      total: 2,
      blocks: [{ index: 1, text: 'Beta' }],
    })
  })
  it('writes without using the current selection', () => {
    const e = editor()
    handleDocsMcpRequest(e, 'docs.replace_blocks', { start: 0, end: 1, content: 'Replacement' })
    expect(e.insertContentAt).toHaveBeenCalledWith({ from: 0, to: 13 }, 'Replacement')
  })
  it('only permits explicit bounded undo and redo commands', () => {
    const e = editor()
    handleDocsMcpRequest(e, 'docs.apply_commands', { commands: [{ op: 'undo' }, { op: 'redo' }] })
    expect(e.undo).toHaveBeenCalledOnce()
    expect(e.redo).toHaveBeenCalledOnce()
    expect(() =>
      handleDocsMcpRequest(e, 'docs.apply_commands', { commands: [{ op: 'toggleBold' }] }),
    ).toThrow('only explicit undo and redo commands are supported')
  })

  it('creates and reads native rich blocks without interpreting Markdown', () => {
    const e = new Editor({
      extensions: editorExtensions,
      content: { type: 'doc', content: [{ type: 'docParagraph' }] },
    })
    e.storage.listNumbering.defs = new Map([
      [
        '1',
        {
          numId: '1',
          abstractNumId: '0',
          levels: { 0: { numFmt: 'bullet', lvlText: '', start: 1 } },
          startOverrides: {},
        },
      ],
      [
        '2',
        {
          numId: '2',
          abstractNumId: '1',
          levels: { 0: { numFmt: 'decimal', lvlText: '%1.', start: 1 } },
          startOverrides: {},
        },
      ],
    ])
    try {
      const dryRun = handleDocsMcpRequest(e, 'docs.apply_operations', {
        dryRun: true,
        operations: [
          {
            op: 'insert_blocks',
            id: 'report',
            blocks: [
              {
                type: 'heading',
                headingLevel: 1,
                runs: [{ text: 'Report', style: { bold: true, color: '336699' } }],
              },
              {
                type: 'paragraph',
                runs: [{ text: '# literal Markdown' }],
              },
              {
                type: 'bullet_list',
                runs: [{ text: 'First item', style: { italic: true, highlight: 'yellow' } }],
              },
            ],
          },
        ],
      }) as { dryRun: boolean; applied: boolean }
      expect(dryRun).toMatchObject({ dryRun: true, applied: false })
      expect(e.state.doc.textContent).toBe('')

      handleDocsMcpRequest(e, 'docs.apply_operations', {
        operations: [
          {
            op: 'insert_blocks',
            id: 'report',
            blocks: [
              {
                type: 'heading',
                headingLevel: 1,
                runs: [{ text: 'Report', style: { bold: true, color: '336699' } }],
              },
              { type: 'paragraph', runs: [{ text: '# literal Markdown' }] },
              {
                type: 'bullet_list',
                runs: [{ text: 'First item', style: { italic: true, highlight: 'yellow' } }],
              },
            ],
          },
          {
            op: 'format_text',
            target: { resultId: 'report', blockIndex: 1 },
            start: 0,
            end: 1,
            style: { underline: true, fontSizePt: 14 },
          },
          {
            op: 'set_block',
            target: { resultId: 'report', blockIndex: 1 },
            paragraph: { align: 'center', indentLeftTwips: 240 },
          },
        ],
      })
      const read = handleDocsMcpRequest(e, 'docs.read_blocks', {}) as {
        blocks: Array<Record<string, unknown>>
      }
      expect(read.blocks).toEqual([
        expect.objectContaining({ type: 'heading', headingLevel: 1, text: 'Report' }),
        expect.objectContaining({
          type: 'paragraph',
          text: '# literal Markdown',
          paragraph: { align: 'center', indentLeftTwips: 240 },
        }),
        expect.objectContaining({ type: 'bullet_list', text: 'First item' }),
      ])
      expect(read.blocks[0].runs).toEqual([
        { text: 'Report', style: { bold: true, color: '336699' } },
      ])
      expect(read.blocks[1].runs).toEqual([
        { text: '#', style: { underline: true, fontSizePt: 14 } },
        { text: ' literal Markdown' },
      ])
      expect(read.blocks[2].runs).toEqual([
        { text: 'First item', style: { italic: true, highlight: 'yellow' } },
      ])
      const beforeRejectedBatch = e.getJSON()
      expect(() =>
        handleDocsMcpRequest(e, 'docs.apply_operations', {
          operations: [
            {
              op: 'format_text',
              target: { blockId: read.blocks[0].blockId },
              start: 0,
              end: 1,
              style: { italic: true },
            },
            {
              op: 'format_text',
              target: { blockId: read.blocks[0].blockId },
              start: 99,
              end: 100,
              style: { bold: true },
            },
          ],
        }),
      ).toThrow('start/end')
      expect(e.getJSON()).toEqual(beforeRejectedBatch)
    } finally {
      e.destroy()
    }
  })

  it('keeps rich headings, runs, and lists after DOCX save and reopen', async () => {
    const parsed = await parseDocx(await buildBlankDocx())
    const e = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: blocksToPmDoc(parsed.blocks) as never,
    })
    e.storage.listNumbering.defs = parsed.numbering
    try {
      handleDocsMcpRequest(e, 'docs.apply_operations', {
        operations: [
          {
            op: 'insert_blocks',
            blocks: [
              {
                type: 'heading',
                headingLevel: 2,
                runs: [{ text: 'Saved heading', style: { color: '1F4E79', bold: true } }],
              },
              {
                type: 'bullet_list',
                runs: [{ text: 'Bullet item', style: { italic: true, highlight: 'yellow' } }],
              },
              {
                type: 'ordered_list',
                runs: [{ text: 'Ordered item', style: { underline: true, fontSizePt: 14 } }],
              },
            ],
          },
        ],
      })
      const plan = pmDocToSavePlan(e.getJSON() as PmNode, parsed.blocks)
      const reopened = await parseDocx(await saveDocx(parsed, plan.saveBlocks))
      expect(reopened.blocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'heading',
            level: 2,
            runs: [expect.objectContaining({ text: 'Saved heading', color: '1F4E79', bold: true })],
          }),
          expect.objectContaining({
            type: 'listItem',
            list: expect.objectContaining({ kind: 'bullet' }),
            runs: [
              expect.objectContaining({ text: 'Bullet item', italic: true, highlight: 'yellow' }),
            ],
          }),
          expect.objectContaining({
            type: 'listItem',
            list: expect.objectContaining({ kind: 'ordered' }),
            runs: [
              expect.objectContaining({
                text: 'Ordered item',
                underline: true,
                sizeHalfPoints: 28,
              }),
            ],
          }),
        ]),
      )
    } finally {
      e.destroy()
    }
  })
})
