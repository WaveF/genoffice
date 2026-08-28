import { describe, expect, it, vi } from 'vitest'
import { handleDocsMcpRequest } from '../src/renderer/mcp-adapter'

function editor() {
  const insertContentAt = vi.fn()
  const undo = vi.fn(() => true)
  const redo = vi.fn(() => true)
  const forEach = (fn: (node: unknown, offset: number, index: number) => void) => {
    fn({ type: { name: 'paragraph' }, textContent: 'Alpha', nodeSize: 7 }, 0, 0)
    fn({ type: { name: 'heading' }, textContent: 'Beta', nodeSize: 6 }, 7, 1)
  }
  return {
    state: { doc: { content: { size: 12 }, textContent: 'AlphaBeta', forEach } },
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
})
