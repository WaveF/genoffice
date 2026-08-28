import { describe, expect, it, vi } from 'vitest'
import { handleMarkdownMcpRequest } from '../src/renderer/mcp-adapter'

function editor() {
  const insertContentAt = vi.fn()
  const setContent = vi.fn()
  const undo = vi.fn(() => true)
  const redo = vi.fn(() => true)
  return {
    getMarkdown: () => '# One\n\nTwo',
    state: { doc: { content: { size: 10 } } },
    commands: { insertContentAt, setContent, undo, redo },
    insertContentAt,
    setContent,
    undo,
    redo,
  } as any
}

describe('Markdown MCP adapter', () => {
  it('reads markdown blocks with bounded ranges', () => {
    expect(
      handleMarkdownMcpRequest(editor(), 'markdown.read_blocks', { start: 1, limit: 1 }),
    ).toMatchObject({ total: 2, blocks: [{ text: 'Two' }] })
  })
  it('uses explicit append or replacement commands', () => {
    const e = editor()
    handleMarkdownMcpRequest(e, 'markdown.insert_content', { content: 'Three' })
    handleMarkdownMcpRequest(e, 'markdown.replace_blocks', { content: '# New' })
    expect(e.insertContentAt).toHaveBeenCalledWith(10, '\n\nThree')
    expect(e.setContent).toHaveBeenCalledWith('# New', { contentType: 'markdown' })
  })
  it('only permits explicit bounded undo and redo commands', () => {
    const e = editor()
    handleMarkdownMcpRequest(e, 'markdown.apply_commands', {
      commands: [{ op: 'undo' }, { op: 'redo' }],
    })
    expect(e.undo).toHaveBeenCalledOnce()
    expect(e.redo).toHaveBeenCalledOnce()
    expect(() =>
      handleMarkdownMcpRequest(e, 'markdown.apply_commands', { commands: [{ op: 'setContent' }] }),
    ).toThrow('only explicit undo and redo commands are supported')
  })
})
