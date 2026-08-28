import type { Editor } from '@tiptap/core'

const MAX_BLOCKS = 100
const MAX_BLOCK_TEXT = 8 * 1024

function asRange(input: Record<string, unknown>): { start: number; limit: number } {
  const start = input.start ?? 0
  const limit = input.limit ?? 50
  if (
    typeof start !== 'number' ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_BLOCKS
  ) {
    throw new Error('start must be non-negative and limit must be between 1 and 100')
  }
  return { start, limit }
}

function blocks(editor: Editor) {
  return editor
    .getMarkdown()
    .split(/\n{2,}/)
    .filter((text) => text.trim().length > 0)
    .map((text, index) => ({ index, text: text.slice(0, MAX_BLOCK_TEXT) }))
}

/** Fixed, model-free Markdown capability adapter used only by the renderer bridge. */
export function handleMarkdownMcpRequest(
  editor: Editor,
  action:
    | 'markdown.get_context'
    | 'markdown.read_blocks'
    | 'markdown.insert_content'
    | 'markdown.replace_blocks'
    | 'markdown.apply_commands',
  input: Record<string, unknown>,
): unknown {
  const all = blocks(editor)
  if (action === 'markdown.get_context') {
    return {
      blockCount: all.length,
      characterCount: editor.getMarkdown().length,
      preview: all.slice(0, 8),
    }
  }
  if (action === 'markdown.insert_content') {
    const content = input.content
    if (typeof content !== 'string' || content.length === 0 || content.length > MAX_BLOCK_TEXT)
      throw new Error('content must be a non-empty string within the size limit')
    editor.commands.insertContentAt(editor.state.doc.content.size, `\n\n${content}`)
    return { applied: true, blockCount: blocks(editor).length }
  }
  if (action === 'markdown.replace_blocks') {
    const content = input.content
    if (typeof content !== 'string' || content.length > 64 * 1024)
      throw new Error('bounded markdown content is required')
    editor.commands.setContent(content, { contentType: 'markdown' })
    return { applied: true, blockCount: blocks(editor).length }
  }
  if (action === 'markdown.apply_commands') {
    const commands = input.commands
    if (!Array.isArray(commands) || commands.length === 0 || commands.length > 10)
      throw new Error('commands must contain between 1 and 10 bounded commands')
    for (const command of commands) {
      if (
        !command ||
        typeof command !== 'object' ||
        Array.isArray(command) ||
        Object.keys(command).length !== 1 ||
        !['undo', 'redo'].includes((command as { op?: unknown }).op as string)
      ) {
        throw new Error('only explicit undo and redo commands are supported')
      }
      const applied =
        (command as { op: 'undo' | 'redo' }).op === 'undo'
          ? editor.commands.undo()
          : editor.commands.redo()
      if (!applied) throw new Error(`unable to ${(command as { op: string }).op} document change`)
    }
    return { applied: true, blockCount: blocks(editor).length }
  }
  const { start, limit } = asRange(input)
  return { start, blocks: all.slice(start, start + limit), total: all.length }
}
