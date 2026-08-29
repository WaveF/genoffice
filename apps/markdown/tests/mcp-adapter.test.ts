import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { handleMarkdownMcpRequest } from '../src/renderer/mcp-adapter'
import { buildExtensions } from '../src/renderer/editor/extensions'

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
  it('parses complete source into supported Markdown structures', () => {
    const e = new Editor({
      extensions: buildExtensions({
        slashController: { onOpen: () => {}, onUpdate: () => {}, onKeyDown: () => false, onClose: () => {} },
        slashItems: () => [],
      }),
      content: '',
    })
    try {
      handleMarkdownMcpRequest(e, 'markdown.set_source', {
        source:
          '# Title\n\n- item\n\n> quote\n\n| Name | Value |\n| --- | --- |\n| a | 1 |\n\n- [ ] todo\n\n![diagram](assets/diagram.png)',
      })
      expect(e.getJSON()).toMatchObject({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'heading' }),
          expect.objectContaining({ type: 'bulletList' }),
          expect.objectContaining({ type: 'blockquote' }),
          expect.objectContaining({ type: 'table' }),
          expect.objectContaining({ type: 'taskList' }),
          expect.objectContaining({ type: 'image', attrs: expect.objectContaining({ src: 'assets/diagram.png' }) }),
        ]),
      })
    } finally {
      e.destroy()
    }
  })
  it('reads markdown blocks with bounded ranges', () => {
    expect(
      handleMarkdownMcpRequest(editor(), 'markdown.read_blocks', { start: 1, limit: 1 }),
    ).toMatchObject({ total: 2, blocks: [{ text: 'Two' }] })
  })
  it('keeps normal insertion literal and parses only explicit complete source replacement', () => {
    const e = editor()
    handleMarkdownMcpRequest(e, 'markdown.insert_content', { content: '# Three' })
    handleMarkdownMcpRequest(e, 'markdown.replace_blocks', { content: '# New' })
    handleMarkdownMcpRequest(e, 'markdown.set_source', { source: '# Source\n\n- one' })
    expect(e.insertContentAt).toHaveBeenCalledWith(10, '\n\n# Three')
    expect(e.setContent).toHaveBeenCalledWith('# New', { contentType: 'markdown' })
    expect(e.setContent).toHaveBeenLastCalledWith('# Source\n\n- one', {
      contentType: 'markdown',
    })
  })
  it('accepts an empty source but rejects oversized source before changing the editor', () => {
    const e = editor()
    handleMarkdownMcpRequest(e, 'markdown.set_source', { source: '' })
    expect(e.setContent).toHaveBeenCalledWith('', { contentType: 'markdown' })
    expect(() =>
      handleMarkdownMcpRequest(e, 'markdown.set_source', { source: 'x'.repeat(64 * 1024 + 1) }),
    ).toThrow('complete bounded Markdown source is required')
    expect(e.setContent).toHaveBeenCalledOnce()
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
