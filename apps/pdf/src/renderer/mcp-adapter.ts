export type PdfMcpOperation =
  | { op: 'add_note'; page: number; x: number; y: number; contents: string }
  | { op: 'add_markup'; page: number; type: 'highlight' | 'underline' | 'strikeout'; quads: number[][] }

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
    const result = { revision: state.revision ?? 0, dryRun, changes: { notes: operations.filter((op) => op.op === 'add_note').length, markups: operations.filter((op) => op.op === 'add_markup').length } }
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
  const page = operation.page
  if (!Number.isSafeInteger(page) || (page as number) < 0 || (page as number) >= pageCount) throw new Error('Operation page is outside the document')
  const pageIndex = page as number
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
