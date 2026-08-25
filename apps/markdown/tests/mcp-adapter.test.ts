import { describe, expect, it, vi } from 'vitest'
import { handleMarkdownMcpRequest } from '../src/renderer/mcp-adapter'

function editor() {
  const insertContentAt = vi.fn()
  const setContent = vi.fn()
  return { getMarkdown: () => '# One\n\nTwo', state: { doc: { content: { size: 10 } } }, commands: { insertContentAt, setContent }, insertContentAt, setContent } as any
}

describe('Markdown MCP adapter', () => {
  it('reads markdown blocks with bounded ranges', () => {
    expect(handleMarkdownMcpRequest(editor(), 'markdown.read_blocks', { start: 1, limit: 1 })).toMatchObject({ total: 2, blocks: [{ text: 'Two' }] })
  })
  it('uses explicit append or replacement commands', () => {
    const e = editor()
    handleMarkdownMcpRequest(e, 'markdown.insert_content', { content: 'Three' })
    handleMarkdownMcpRequest(e, 'markdown.replace_blocks', { content: '# New' })
    expect(e.insertContentAt).toHaveBeenCalledWith(10, '\n\nThree')
    expect(e.setContent).toHaveBeenCalledWith('# New', { contentType: 'markdown' })
  })
})
