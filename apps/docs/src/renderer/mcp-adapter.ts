import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PmNode, type Schema } from '@tiptap/pm/model'

const MAX_BLOCKS = 100
const MAX_BLOCK_TEXT = 8 * 1024
const MAX_OPERATIONS = 32
const MAX_RUNS_PER_BLOCK = 128
const MAX_TOTAL_TEXT = 64 * 1024
const HIGHLIGHT_VALUES = new Set([
  'yellow',
  'green',
  'cyan',
  'magenta',
  'blue',
  'red',
  'darkBlue',
  'darkCyan',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'darkGray',
  'lightGray',
  'black',
  'white',
])

type McpAction =
  | 'docs.get_context'
  | 'docs.read_blocks'
  | 'docs.insert_content'
  | 'docs.replace_blocks'
  | 'docs.apply_commands'
  | 'docs.apply_operations'

type TextStyle = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string | null
  highlight?: string | null
  font?: string | null
  fontSizePt?: number | null
}

type ParagraphStyle = {
  align?: 'left' | 'center' | 'right' | 'justify' | null
  indentLeftTwips?: number | null
  indentRightTwips?: number | null
  indentFirstLineTwips?: number | null
}

interface SnapshotBlock {
  id: string
  index: number
  from: number
  to: number
  type: string
  text: string
}

interface InsertedBlock {
  from: number
  to: number
  mappingIndex: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function blockId(index: number, node: PmNode): string {
  return `block-${index}-${fnv1a(`${node.type.name}\\u0000${node.textContent}`)}`
}

function snapshotBlocks(editor: Editor): SnapshotBlock[] {
  const result: SnapshotBlock[] = []
  editor.state.doc.forEach((node, offset, index) => {
    result.push({
      id: blockId(index, node),
      index,
      from: offset,
      to: offset + node.nodeSize,
      type: node.type.name,
      text: node.textContent.slice(0, MAX_BLOCK_TEXT),
    })
  })
  return result
}

function textStyleFromMarks(node: PmNode): TextStyle | undefined {
  const mark = (name: string) => node.marks.find((item) => item.type.name === name)
  const docStyle = mark('docTextStyle')
  const result: TextStyle = {}
  if (mark('bold')) result.bold = true
  if (mark('italic')) result.italic = true
  if (mark('underline')) result.underline = true
  if (mark('strike')) result.strike = true
  if (docStyle?.attrs.color) result.color = String(docStyle.attrs.color)
  if (docStyle?.attrs.highlight) result.highlight = String(docStyle.attrs.highlight)
  if (docStyle?.attrs.fontAscii ?? docStyle?.attrs.font)
    result.font = String(docStyle.attrs.fontAscii ?? docStyle.attrs.font)
  if (typeof docStyle?.attrs.sizeHalfPoints === 'number')
    result.fontSizePt = docStyle.attrs.sizeHalfPoints / 2
  return Object.keys(result).length > 0 ? result : undefined
}

function readRuns(node: PmNode): Array<{ text: string; style?: TextStyle }> {
  const runs: Array<{ text: string; style?: TextStyle }> = []
  node.descendants((child) => {
    if (!child.isText || !child.text) return true
    const style = textStyleFromMarks(child)
    const previous = runs.at(-1)
    if (previous && JSON.stringify(previous.style) === JSON.stringify(style))
      previous.text += child.text
    else runs.push({ text: child.text, ...(style ? { style } : {}) })
    return false
  })
  return runs
}

function readBlock(block: SnapshotBlock, node: PmNode) {
  const paragraph: ParagraphStyle = {}
  if (node.attrs.align != null) paragraph.align = node.attrs.align
  if (node.attrs.indentLeft != null) paragraph.indentLeftTwips = node.attrs.indentLeft
  if (node.attrs.indentRight != null) paragraph.indentRightTwips = node.attrs.indentRight
  if (node.attrs.indentFirstLine != null)
    paragraph.indentFirstLineTwips = node.attrs.indentFirstLine
  const type =
    node.type.name === 'docHeading'
      ? 'heading'
      : node.type.name === 'docListItem'
        ? node.attrs.kind === 'ordered'
          ? 'ordered_list'
          : 'bullet_list'
        : node.type.name === 'docParagraph'
          ? 'paragraph'
          : node.type.name
  return {
    blockId: block.id,
    index: block.index,
    type,
    ...(node.type.name === 'docHeading' ? { headingLevel: node.attrs.level } : {}),
    ...(Object.keys(paragraph).length > 0 ? { paragraph } : {}),
    text: block.text,
    ...(node.isTextblock ? { runs: readRuns(node) } : {}),
  }
}

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

function checkedColor(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{6}$/.test(value))
    throw new Error(`${field} must be a six-digit RGB hex string or null`)
  return value.toUpperCase()
}

function checkedHighlight(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || !HIGHLIGHT_VALUES.has(value))
    throw new Error('highlight must be a supported Word highlight name or null')
  return value
}

function checkedFont(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    // eslint-disable-next-line no-control-regex -- reject ASCII control characters from MCP input
    /[\u0000-\u001f]/.test(value)
  )
    throw new Error('font must be a bounded printable font name or null')
  return value
}

function checkedTextStyle(value: unknown): TextStyle {
  if (!isRecord(value)) throw new Error('style must be an object')
  const allowed = [
    'bold',
    'italic',
    'underline',
    'strike',
    'color',
    'highlight',
    'font',
    'fontSizePt',
  ]
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('unsupported text style field')
  const result: TextStyle = {}
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') throw new Error(`${key} must be boolean`)
      result[key] = value[key]
    }
  }
  const color = checkedColor(value.color, 'color')
  if (color !== undefined) result.color = color
  const highlight = checkedHighlight(value.highlight)
  if (highlight !== undefined) result.highlight = highlight
  const font = checkedFont(value.font)
  if (font !== undefined) result.font = font
  if (value.fontSizePt !== undefined) {
    if (
      value.fontSizePt !== null &&
      (typeof value.fontSizePt !== 'number' ||
        !Number.isFinite(value.fontSizePt) ||
        value.fontSizePt < 1 ||
        value.fontSizePt > 512)
    )
      throw new Error('fontSizePt must be between 1 and 512 or null')
    result.fontSizePt = value.fontSizePt
  }
  return result
}

function checkedParagraphStyle(value: unknown): ParagraphStyle {
  if (!isRecord(value)) throw new Error('paragraph must be an object')
  const allowed = ['align', 'indentLeftTwips', 'indentRightTwips', 'indentFirstLineTwips']
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('unsupported paragraph style field')
  const result: ParagraphStyle = {}
  if (value.align !== undefined) {
    if (
      value.align !== null &&
      !['left', 'center', 'right', 'justify'].includes(String(value.align))
    )
      throw new Error('align must be left, center, right, justify, or null')
    result.align = value.align as ParagraphStyle['align']
  }
  for (const key of ['indentLeftTwips', 'indentRightTwips', 'indentFirstLineTwips'] as const) {
    const raw = value[key]
    if (raw === undefined) continue
    if (
      raw !== null &&
      (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < -14400 || raw > 14400)
    )
      throw new Error(`${key} must be an integer between -14400 and 14400 or null`)
    result[key] = raw
  }
  return result
}

function paragraphAttrs(style: ParagraphStyle): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  if (style.align !== undefined) attrs.align = style.align
  if (style.indentLeftTwips !== undefined) attrs.indentLeft = style.indentLeftTwips
  if (style.indentRightTwips !== undefined) attrs.indentRight = style.indentRightTwips
  if (style.indentFirstLineTwips !== undefined) attrs.indentFirstLine = style.indentFirstLineTwips
  return attrs
}

function marksForStyle(schema: Schema, style: TextStyle) {
  const marks = []
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    if (style[key]) marks.push(schema.marks[key].create())
  }
  const textAttrs: Record<string, unknown> = {}
  if (style.color) textAttrs.color = style.color
  if (style.highlight) textAttrs.highlight = style.highlight
  if (style.font) textAttrs.fontAscii = style.font
  if (style.fontSizePt) textAttrs.sizeHalfPoints = Math.round(style.fontSizePt * 2)
  if (Object.keys(textAttrs).length > 0) marks.push(schema.marks.docTextStyle.create(textAttrs))
  return marks
}

function nodeTypeFor(kind: unknown, schema: Schema): 'docParagraph' | 'docHeading' | 'docListItem' {
  if (!['paragraph', 'heading', 'bullet_list', 'ordered_list'].includes(String(kind)))
    throw new Error('block type must be paragraph, heading, bullet_list, or ordered_list')
  const name =
    kind === 'heading'
      ? 'docHeading'
      : kind === 'bullet_list' || kind === 'ordered_list'
        ? 'docListItem'
        : 'docParagraph'
  if (!schema.nodes[name]) throw new Error(`Docs schema does not support ${kind}`)
  return name
}

function listNumId(editor: Editor, kind: 'bullet' | 'ordered'): string {
  const defs = (
    editor.storage.listNumbering as
      { defs?: Map<string, { levels?: Record<number, { numFmt?: string }> }> } | undefined
  )?.defs
  const match =
    defs &&
    [...defs.entries()].find(
      ([, definition]) => (definition.levels?.[0]?.numFmt === 'bullet') === (kind === 'bullet'),
    )
  if (!match) throw new Error('Docs list numbering is not initialized for this document')
  return String(match[0])
}

function makeBlock(editor: Editor, value: unknown): PmNode {
  const schema = editor.state.schema
  if (!isRecord(value)) throw new Error('each block must be an object')
  const allowed = ['type', 'headingLevel', 'paragraph', 'runs']
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('unsupported block field')
  const type = nodeTypeFor(value.type, schema)
  if (!Array.isArray(value.runs) || value.runs.length > MAX_RUNS_PER_BLOCK)
    throw new Error(`runs must contain at most ${MAX_RUNS_PER_BLOCK} items`)
  const paragraph = value.paragraph === undefined ? {} : checkedParagraphStyle(value.paragraph)
  const attrs: Record<string, unknown> = {
    docxIndex: null,
    styleId: null,
    aiChanged: false,
    ...paragraphAttrs(paragraph),
  }
  if (type === 'docHeading') {
    if (
      typeof value.headingLevel !== 'number' ||
      !Number.isSafeInteger(value.headingLevel) ||
      value.headingLevel < 1 ||
      value.headingLevel > 6
    )
      throw new Error('headingLevel from 1 to 6 is required for heading blocks')
    attrs.level = value.headingLevel
  } else if (value.headingLevel !== undefined) {
    throw new Error('headingLevel is only valid for heading blocks')
  }
  if (type === 'docListItem') {
    const kind = value.type === 'ordered_list' ? 'ordered' : 'bullet'
    attrs.kind = kind
    attrs.numId = listNumId(editor, kind)
    attrs.ilvl = 0
  }
  const content: PmNode[] = []
  for (const run of value.runs) {
    if (!isRecord(run) || Object.keys(run).some((key) => !['text', 'style'].includes(key)))
      throw new Error('each run only accepts text and optional style')
    if (
      typeof run.text !== 'string' ||
      run.text.length > MAX_BLOCK_TEXT ||
      // eslint-disable-next-line no-control-regex -- tabs and newlines are the only allowed controls
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(run.text)
    )
      throw new Error('run text must be bounded printable text')
    if (run.text.length === 0) continue
    const style = run.style === undefined ? {} : checkedTextStyle(run.style)
    content.push(schema.text(run.text, marksForStyle(schema, style)))
  }
  return schema.nodes[type].create(attrs, content)
}

function resolveSnapshotBlock(
  blockIdValue: unknown,
  snapshot: Map<string, SnapshotBlock>,
  tr: { mapping: { map: (position: number, assoc?: number) => number } },
): { from: number; to: number; type: string } {
  if (typeof blockIdValue !== 'string') throw new Error('target blockId is required')
  const block = snapshot.get(blockIdValue)
  if (!block) throw new Error('blockId is not valid for the current document snapshot')
  return { from: tr.mapping.map(block.from, 1), to: tr.mapping.map(block.to, -1), type: block.type }
}

function resolveTarget(
  value: unknown,
  snapshot: Map<string, SnapshotBlock>,
  inserted: Map<string, InsertedBlock[]>,
  tr: {
    mapping: {
      map: (position: number, assoc?: number) => number
      slice: (from?: number, to?: number) => { map: (position: number, assoc?: number) => number }
    }
  },
): { from: number; to: number; type?: string } {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['blockId', 'resultId', 'blockIndex'].includes(key))
  )
    throw new Error('target must identify one blockId or one inserted result block')
  if (typeof value.blockId === 'string' && Object.keys(value).length === 1)
    return resolveSnapshotBlock(value.blockId, snapshot, tr)
  if (
    typeof value.resultId === 'string' &&
    typeof value.blockIndex === 'number' &&
    Number.isSafeInteger(value.blockIndex) &&
    value.blockIndex >= 0 &&
    Object.keys(value).length === 2
  ) {
    const blocks = inserted.get(value.resultId)
    const block = blocks?.[value.blockIndex]
    if (!block) throw new Error('target does not identify an inserted result block')
    const mapping = tr.mapping.slice(block.mappingIndex)
    return { from: mapping.map(block.from, 1), to: mapping.map(block.to, -1) }
  }
  throw new Error('target must identify one blockId or one inserted result block')
}

function textRangeInBlock(
  node: PmNode,
  blockFrom: number,
  start: unknown,
  end: unknown,
): { from: number; to: number } {
  if (!node.isTextblock)
    throw new Error('text formatting is only supported for paragraph, heading, and list blocks')
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > node.textContent.length
  )
    throw new Error('start/end must select a non-empty text range in the target block')
  let textOffset = 0
  let from: number | null = null
  let to: number | null = null
  node.descendants((child, pos) => {
    const text = child.text
    if (!child.isText || text == null) return true
    const next = textOffset + text.length
    if (start >= textOffset && start < next) from = blockFrom + 1 + pos + (start - textOffset)
    if (end > textOffset && end <= next) to = blockFrom + 1 + pos + (end - textOffset)
    textOffset = next
    return false
  })
  if (from == null || to == null) throw new Error('text range cannot cross non-text inline content')
  return { from, to }
}

function applyTextStyle(
  tr: Parameters<Editor['view']['dispatch']>[0],
  style: TextStyle,
  from: number,
  to: number,
): void {
  const schema = tr.doc.type.schema
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    if (style[key] === undefined) continue
    const mark = schema.marks[key]
    if (style[key]) tr.addMark(from, to, mark.create())
    else tr.removeMark(from, to, mark)
  }
  const textKeys = ['color', 'highlight', 'font', 'fontSizePt'] as const
  if (!textKeys.some((key) => style[key] !== undefined)) return
  const textStyle = schema.marks.docTextStyle
  const segments: Array<{ from: number; to: number; attrs: Record<string, unknown> }> = []
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    const segmentFrom = Math.max(from, pos)
    const segmentTo = Math.min(to, pos + node.nodeSize)
    if (segmentFrom >= segmentTo) return false
    const old = node.marks.find((mark) => mark.type === textStyle)?.attrs ?? {}
    const attrs = { ...old }
    if (style.color !== undefined) attrs.color = style.color
    if (style.highlight !== undefined) attrs.highlight = style.highlight
    if (style.font !== undefined) attrs.fontAscii = style.font
    if (style.fontSizePt !== undefined)
      attrs.sizeHalfPoints = style.fontSizePt == null ? null : Math.round(style.fontSizePt * 2)
    segments.push({ from: segmentFrom, to: segmentTo, attrs })
    return false
  })
  tr.removeMark(from, to, textStyle)
  for (const segment of segments) {
    if (Object.values(segment.attrs).some((value) => value != null))
      tr.addMark(segment.from, segment.to, textStyle.create(segment.attrs))
  }
}

function applyOperations(editor: Editor, input: Record<string, unknown>) {
  const operations = input.operations
  const dryRun = input.dryRun ?? false
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_OPERATIONS)
    throw new Error(`operations must contain between 1 and ${MAX_OPERATIONS} items`)
  if (typeof dryRun !== 'boolean') throw new Error('dryRun must be boolean when provided')
  if (JSON.stringify(operations).length > MAX_TOTAL_TEXT)
    throw new Error('operation payload exceeds the size limit')

  const snapshot = new Map(snapshotBlocks(editor).map((block) => [block.id, block]))
  const inserted = new Map<string, InsertedBlock[]>()
  const tr = editor.state.tr
  const results: Array<Record<string, unknown>> = []
  for (const operation of operations) {
    if (!isRecord(operation) || typeof operation.op !== 'string')
      throw new Error('each operation requires op')
    if (operation.op === 'insert_blocks') {
      if (
        Object.keys(operation).some((key) => !['op', 'id', 'afterBlockId', 'blocks'].includes(key))
      )
        throw new Error('unsupported insert_blocks field')
      if (
        operation.id !== undefined &&
        (typeof operation.id !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(operation.id) ||
          inserted.has(operation.id))
      )
        throw new Error('insert_blocks id must be a unique bounded identifier')
      if (
        !Array.isArray(operation.blocks) ||
        operation.blocks.length === 0 ||
        operation.blocks.length > MAX_BLOCKS
      )
        throw new Error(`insert_blocks requires between 1 and ${MAX_BLOCKS} blocks`)
      const nodes = operation.blocks.map((block) => makeBlock(editor, block))
      let position = tr.doc.content.size
      if (operation.afterBlockId !== undefined)
        position = resolveSnapshotBlock(operation.afterBlockId, snapshot, tr).to
      else if (
        tr.doc.childCount === 1 &&
        tr.doc.firstChild?.type.name === 'docParagraph' &&
        tr.doc.firstChild.textContent.length === 0
      ) {
        tr.replaceWith(0, tr.doc.firstChild.nodeSize, Fragment.fromArray(nodes))
        const starts: InsertedBlock[] = []
        let offset = 0
        for (const node of nodes) {
          starts.push({
            from: offset,
            to: offset + node.nodeSize,
            mappingIndex: tr.mapping.maps.length,
          })
          offset += node.nodeSize
        }
        if (operation.id) inserted.set(operation.id, starts)
        results.push({
          op: 'insert_blocks',
          blockCount: nodes.length,
          ...(operation.id ? { id: operation.id } : {}),
        })
        continue
      }
      tr.insert(position, Fragment.fromArray(nodes))
      const starts: InsertedBlock[] = []
      let offset = 0
      for (const node of nodes) {
        starts.push({
          from: position + offset,
          to: position + offset + node.nodeSize,
          mappingIndex: tr.mapping.maps.length,
        })
        offset += node.nodeSize
      }
      if (operation.id) inserted.set(operation.id, starts)
      results.push({
        op: 'insert_blocks',
        blockCount: nodes.length,
        ...(operation.id ? { id: operation.id } : {}),
      })
      continue
    }
    if (operation.op === 'format_text') {
      if (
        Object.keys(operation).some(
          (key) => !['op', 'target', 'start', 'end', 'style'].includes(key),
        )
      )
        throw new Error('unsupported format_text field')
      const target = resolveTarget(operation.target, snapshot, inserted, tr)
      const node = tr.doc.nodeAt(target.from)
      if (!node) throw new Error('target block is no longer available')
      const range = textRangeInBlock(node, target.from, operation.start, operation.end)
      applyTextStyle(tr, checkedTextStyle(operation.style), range.from, range.to)
      results.push({ op: 'format_text', applied: true })
      continue
    }
    if (operation.op === 'set_block') {
      if (
        Object.keys(operation).some(
          (key) => !['op', 'target', 'type', 'headingLevel', 'paragraph'].includes(key),
        )
      )
        throw new Error('unsupported set_block field')
      const target = resolveTarget(operation.target, snapshot, inserted, tr)
      const node = tr.doc.nodeAt(target.from)
      if (!node || !node.isTextblock)
        throw new Error('target block is no longer available or cannot be formatted')
      const currentType =
        node.type.name === 'docHeading'
          ? 'heading'
          : node.type.name === 'docListItem'
            ? node.attrs.kind === 'ordered'
              ? 'ordered_list'
              : 'bullet_list'
            : 'paragraph'
      const type = nodeTypeFor(operation.type ?? currentType, editor.state.schema)
      const paragraph =
        operation.paragraph === undefined ? {} : checkedParagraphStyle(operation.paragraph)
      const attrs: Record<string, unknown> = { ...node.attrs, ...paragraphAttrs(paragraph) }
      if (type === 'docHeading') {
        const level =
          operation.headingLevel ?? (node.type.name === 'docHeading' ? node.attrs.level : 1)
        if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1 || level > 6)
          throw new Error('headingLevel from 1 to 6 is required for heading blocks')
        attrs.level = level
      } else if (operation.headingLevel !== undefined) {
        throw new Error('headingLevel is only valid for heading blocks')
      }
      if (type === 'docListItem') {
        attrs.kind =
          operation.type === 'ordered_list'
            ? 'ordered'
            : operation.type === 'bullet_list'
              ? 'bullet'
              : (node.attrs.kind ?? 'bullet')
        attrs.numId = null
        attrs.ilvl = Number.isInteger(node.attrs.ilvl) ? node.attrs.ilvl : 0
      }
      tr.setNodeMarkup(target.from, editor.state.schema.nodes[type], attrs)
      results.push({ op: 'set_block', applied: true })
      continue
    }
    throw new Error('unsupported Docs operation')
  }
  if (!dryRun && tr.docChanged) editor.view.dispatch(tr)
  return {
    applied: !dryRun && tr.docChanged,
    dryRun,
    operations: results,
    blockCount: snapshotBlocks(editor).length,
  }
}

/** Fixed, model-free Docs capability adapter used only by the renderer bridge. */
export function handleDocsMcpRequest(
  editor: Editor,
  action: McpAction,
  input: Record<string, unknown>,
): unknown {
  const all = snapshotBlocks(editor)
  if (action === 'docs.get_context') {
    return {
      blockCount: all.length,
      characterCount: editor.state.doc.textContent.length,
      preview: all
        .slice(0, 8)
        .map((block) => readBlock(block, editor.state.doc.nodeAt(block.from)!)),
    }
  }
  if (action === 'docs.insert_content') {
    const content = input.content
    if (typeof content !== 'string' || content.length === 0 || content.length > MAX_BLOCK_TEXT)
      throw new Error('content must be a non-empty string within the size limit')
    editor.commands.insertContentAt(editor.state.doc.content.size, content)
    return { applied: true, blockCount: snapshotBlocks(editor).length }
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
    editor.commands.insertContentAt({ from: all[start].from, to: all[end].to }, content)
    return { applied: true, blockCount: snapshotBlocks(editor).length }
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
      )
        throw new Error('only explicit undo and redo commands are supported')
      const applied =
        (command as { op: 'undo' | 'redo' }).op === 'undo'
          ? editor.commands.undo()
          : editor.commands.redo()
      if (!applied) throw new Error(`unable to ${(command as { op: string }).op} document change`)
    }
    return { applied: true, blockCount: snapshotBlocks(editor).length }
  }
  if (action === 'docs.apply_operations') return applyOperations(editor, input)
  const { start, limit } = asRange(input)
  return {
    start,
    blocks: all
      .slice(start, start + limit)
      .map((block) => readBlock(block, editor.state.doc.nodeAt(block.from)!)),
    total: all.length,
  }
}
