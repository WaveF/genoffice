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
  const result: Array<{ index: number; type: string; text: string }> = []
  editor.state.doc.forEach((node, _offset, index) => {
    result.push({ index, type: node.type.name, text: node.textContent.slice(0, MAX_BLOCK_TEXT) })
  })
  return result
}

/** Fixed, model-free Docs capability adapter used only by the renderer bridge. */
export function handleDocsMcpRequest(
  editor: Editor,
  action:
    | 'docs.get_context'
    | 'docs.read_blocks'
    | 'docs.insert_content'
    | 'docs.replace_blocks'
    | 'docs.apply_commands',
  input: Record<string, unknown>,
): unknown {
  const all = blocks(editor)
  if (action === 'docs.get_context') {
    return {
      blockCount: all.length,
      characterCount: editor.state.doc.textContent.length,
      preview: all.slice(0, 8),
    }
  }
  if (action === 'docs.insert_content') {
    const content = input.content
    if (typeof content !== 'string' || content.length === 0 || content.length > MAX_BLOCK_TEXT)
      throw new Error('content must be a non-empty string within the size limit')
    editor.commands.insertContentAt(editor.state.doc.content.size, content)
    return { applied: true, blockCount: blocks(editor).length }
  }
  if (action === 'docs.replace_blocks') {
    const start = input.start
    const end = input.end
    const content = input.content
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= all.length ||
      typeof content !== 'string' ||
      content.length > MAX_BLOCK_TEXT
    )
      throw new Error('start/end and bounded content are required')
    let from = 0
    let to = 0
    editor.state.doc.forEach((node, offset, index) => {
      if (index === start) from = offset
      if (index === end) to = offset + node.nodeSize
    })
    editor.commands.insertContentAt({ from, to }, content)
    return { applied: true, blockCount: blocks(editor).length }
  }
  if (action === 'docs.apply_commands') {
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
