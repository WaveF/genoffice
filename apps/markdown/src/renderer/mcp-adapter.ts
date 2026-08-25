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
  action: 'markdown.get_context' | 'markdown.read_blocks',
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
  const { start, limit } = asRange(input)
  return { start, blocks: all.slice(start, start + limit), total: all.length }
}
