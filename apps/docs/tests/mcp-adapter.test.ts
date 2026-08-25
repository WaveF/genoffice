import { describe, expect, it, vi } from 'vitest'
import { handleDocsMcpRequest } from '../src/renderer/mcp-adapter'

function editor() {
  const insertContentAt = vi.fn()
  return {
    state: { doc: { content: { size: 12 }, textContent: 'AlphaBeta', forEach: (fn: Function) => { fn({ type: { name: 'paragraph' }, textContent: 'Alpha', nodeSize: 7 }, 0, 0); fn({ type: { name: 'heading' }, textContent: 'Beta', nodeSize: 6 }, 7, 1) } } },
    commands: { insertContentAt },
    insertContentAt,
  } as any
}

describe('Docs MCP adapter', () => {
  it('reads bounded explicit block ranges', () => {
    const e = editor()
    expect(handleDocsMcpRequest(e, 'docs.read_blocks', { start: 1, limit: 1 })).toMatchObject({ total: 2, blocks: [{ index: 1, text: 'Beta' }] })
  })
  it('writes without using the current selection', () => {
    const e = editor()
    handleDocsMcpRequest(e, 'docs.replace_blocks', { start: 0, end: 1, content: 'Replacement' })
    expect(e.insertContentAt).toHaveBeenCalledWith({ from: 0, to: 13 }, 'Replacement')
  })
})
