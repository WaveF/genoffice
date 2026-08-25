export type PdfMcpOperation =
  | { op: 'add_note'; page: number; x: number; y: number; contents: string }
  | { op: 'add_markup'; page: number; type: 'highlight' | 'underline' | 'strikeout'; quads: number[][] }
  | { op: 'set_form_value'; name: string; kind: 'text' | 'checkbox' | 'radio' | 'choice'; value?: string; checked?: boolean }
  | { op: 'insert_text'; page: number; x: number; y: number; text: string; fontSize?: number }
  | { op: 'insert_image'; page: number; image: string; rect: [number, number, number, number]; layer: 'belowText' | 'aboveText' }
  | { op: 'delete_page'; page: number }
  | { op: 'replace_pages'; pages: number[] }
  | { op: 'split_pages'; perPage: 2 | 4 | 9 }
  | { op: 'merge_pages'; perSheet: number; direction: 'horizontal' | 'vertical'; separator: boolean }

export function handlePdfMcpRequest(
  action: 'pdf.get_document_context' | 'pdf.read_page_context' | 'pdf.apply_operations',
  input: Record<string, unknown>,
  state: {
    pageCount: number
    sizes: Array<{ width: number; height: number }>
    pageBlocks: Map<number, Array<{ lines: Array<{ text: string }> }>>
    outline?: Array<{ title: string; items?: unknown[] }> | null
    forms?: Array<{ name: string; kind: string; pageIndex: number; value: string; checked: boolean; required: boolean; readOnly: boolean }>
    annotations?: { pendingMarkups: number; pendingNotes: number; savedMarkups: number; savedNotes: number }
    revision?: number
  },
  applyOperations?: (operations: PdfMcpOperation[]) => Promise<void>,
): unknown | Promise<unknown> {
  if (action === 'pdf.apply_operations') {
    const expectedRevision = input.expectedRevision
    const dryRun = input.dryRun === true
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (state.revision ?? 0)) throw new Error('Document changed since it was read')
    if (!Array.isArray(input.operations) || input.operations.length === 0 || input.operations.length > 50) throw new Error('1 to 50 operations are required')
    const operations = input.operations.map((operation) => parseOperation(operation, state.pageCount))
    if (operations.filter((op) => op.op === 'delete_page').length > 1 || (operations.some((op) => op.op === 'delete_page') && state.pageCount <= 1)) throw new Error('Only one page may be deleted and a PDF must retain one page')
    const result = { revision: state.revision ?? 0, dryRun, changes: { notes: operations.filter((op) => op.op === 'add_note').length, markups: operations.filter((op) => op.op === 'add_markup').length, forms: operations.filter((op) => op.op === 'set_form_value').length, text: operations.filter((op) => op.op === 'insert_text').length, images: operations.filter((op) => op.op === 'insert_image').length, pages: operations.filter((op) => op.op === 'delete_page').length, pageFiles: operations.filter((op) => op.op === 'replace_pages' || op.op === 'split_pages' || op.op === 'merge_pages').length } }
    if (dryRun) return result
    if (!applyOperations) throw new Error('PDF apply handler is unavailable')
    return applyOperations(operations).then(() => ({ ...result, dryRun: false, revision: (state.revision ?? 0) + 1 }))
  }
  if (action === 'pdf.get_document_context') return {
    pageCount: state.pageCount,
    pages: state.sizes.slice(0, 200).map((size, index) => ({ index, width: size.width, height: size.height })),
    outline: flattenOutline(state.outline ?? []).slice(0, 200),
    forms: (state.forms ?? []).slice(0, 200),
    annotations: state.annotations ?? { pendingMarkups: 0, pendingNotes: 0, savedMarkups: 0, savedNotes: 0 },
  }
  const page = input.page
  if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 0 || page >= state.pageCount) throw new Error('A valid page index is required')
  return { page, size: state.sizes[page], blocks: (state.pageBlocks.get(page) ?? []).slice(0, 500).map((block) => ({ text: block.lines.map((line) => line.text).join('\n').slice(0, 8192) })) }
}

function parseOperation(value: unknown, pageCount: number): PdfMcpOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each PDF operation must be an object')
  const operation = value as Record<string, unknown>
  if (operation.op === 'set_form_value') {
    if (typeof operation.name !== 'string' || operation.name.length === 0 || !['text', 'checkbox', 'radio', 'choice'].includes(String(operation.kind))) throw new Error('set_form_value requires a field name and supported kind')
    if (operation.kind === 'checkbox') {
      if (typeof operation.checked !== 'boolean') throw new Error('checkbox requires checked')
      return { op: 'set_form_value', name: operation.name, kind: 'checkbox', checked: operation.checked }
    }
    if (typeof operation.value !== 'string' || operation.value.length > 4096) throw new Error('form value must be a bounded string')
    return { op: 'set_form_value', name: operation.name, kind: operation.kind as 'text' | 'radio' | 'choice', value: operation.value }
  }
  const page = operation.page
  if (operation.op === 'replace_pages') {
    if (Object.keys(operation).some((key) => key !== 'op' && key !== 'pages')) throw new Error('replace_pages accepts only pages')
    if (!Array.isArray(operation.pages) || operation.pages.length === 0 || operation.pages.length > 200 || operation.pages.some((page) => !Number.isSafeInteger(page) || page < 0 || page >= pageCount)) throw new Error('replace_pages requires 1 to 200 valid pages')
    return { op: 'replace_pages', pages: [...new Set(operation.pages as number[])].sort((a, b) => a - b) }
  }
  if (operation.op === 'split_pages') {
    if (Object.keys(operation).some((key) => key !== 'op' && key !== 'perPage')) throw new Error('split_pages accepts only perPage')
    if (operation.perPage !== 2 && operation.perPage !== 4 && operation.perPage !== 9) throw new Error('split_pages requires perPage 2, 4, or 9')
    return { op: 'split_pages', perPage: operation.perPage }
  }
  if (operation.op === 'merge_pages') {
    if (Object.keys(operation).some((key) => !['op', 'perSheet', 'direction', 'separator'].includes(key))) throw new Error('merge_pages accepts only layout options')
    if (!Number.isSafeInteger(operation.perSheet) || (operation.perSheet as number) < 2 || (operation.perSheet as number) > 16 || !['horizontal', 'vertical'].includes(String(operation.direction)) || typeof operation.separator !== 'boolean') throw new Error('merge_pages requires bounded layout options')
    return { op: 'merge_pages', perSheet: operation.perSheet as number, direction: operation.direction as 'horizontal' | 'vertical', separator: operation.separator }
  }
  if (!Number.isSafeInteger(page) || (page as number) < 0 || (page as number) >= pageCount) throw new Error('Operation page is outside the document')
  const pageIndex = page as number
  if (operation.op === 'delete_page') return { op: 'delete_page', page: pageIndex }
  if (operation.op === 'insert_text') {
    if (!Number.isFinite(operation.x) || !Number.isFinite(operation.y) || typeof operation.text !== 'string' || operation.text.length === 0 || operation.text.length > 4096 || (operation.fontSize !== undefined && (!Number.isFinite(operation.fontSize) || (operation.fontSize as number) < 4 || (operation.fontSize as number) > 144))) throw new Error('insert_text requires bounded coordinates, text, and fontSize')
    return { op: 'insert_text', page: pageIndex, x: operation.x as number, y: operation.y as number, text: operation.text, ...(operation.fontSize === undefined ? {} : { fontSize: operation.fontSize as number }) }
  }
  if (operation.op === 'insert_image') {
    if (typeof operation.image !== 'string' || operation.image.length === 0 || operation.image.length > 524_288 || !/^[A-Za-z0-9+/]+={0,2}$/.test(operation.image) || !Array.isArray(operation.rect) || operation.rect.length !== 4 || operation.rect.some((point) => !Number.isFinite(point)) || !['belowText', 'aboveText'].includes(String(operation.layer))) throw new Error('insert_image requires bounded PNG base64, rect, and layer')
    return { op: 'insert_image', page: pageIndex, image: operation.image, rect: operation.rect as [number, number, number, number], layer: operation.layer as 'belowText' | 'aboveText' }
  }
  if (operation.op === 'add_note') {
    if (!Number.isFinite(operation.x) || !Number.isFinite(operation.y) || typeof operation.contents !== 'string' || operation.contents.length === 0 || operation.contents.length > 4096) throw new Error('add_note requires bounded coordinates and contents')
    return { op: 'add_note', page: pageIndex, x: operation.x as number, y: operation.y as number, contents: operation.contents }
  }
  if (operation.op === 'add_markup') {
    if (!['highlight', 'underline', 'strikeout'].includes(String(operation.type)) || !Array.isArray(operation.quads) || operation.quads.length === 0 || operation.quads.length > 100) throw new Error('add_markup requires a supported type and 1 to 100 quads')
    const quads = operation.quads.map((quad) => {
      if (!Array.isArray(quad) || quad.length !== 8 || quad.some((point) => !Number.isFinite(point))) throw new Error('Each markup quad must contain eight finite coordinates')
      return quad as number[]
    })
    return { op: 'add_markup', page: pageIndex, type: operation.type as 'highlight' | 'underline' | 'strikeout', quads }
  }
  throw new Error('Unsupported PDF operation')
}

function flattenOutline(nodes: Array<{ title: string; items?: unknown[] }>, depth = 0): Array<{ title: string; depth: number }> {
  const flattened: Array<{ title: string; depth: number }> = []
  for (const node of nodes) {
    flattened.push({ title: node.title.slice(0, 512), depth })
    if (Array.isArray(node.items)) flattened.push(...flattenOutline(node.items as Array<{ title: string; items?: unknown[] }>, depth + 1))
  }
  return flattened
}
