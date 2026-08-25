export function handlePdfMcpRequest(
  action: 'pdf.get_document_context' | 'pdf.read_page_context',
  input: Record<string, unknown>,
  state: {
    pageCount: number
    sizes: Array<{ width: number; height: number }>
    pageBlocks: Map<number, Array<{ lines: Array<{ text: string }> }>>
    outline?: Array<{ title: string; items?: unknown[] }> | null
    forms?: Array<{ name: string; kind: string; pageIndex: number; value: string; checked: boolean; required: boolean; readOnly: boolean }>
    annotations?: { pendingMarkups: number; pendingNotes: number; savedMarkups: number; savedNotes: number }
  },
): unknown {
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

function flattenOutline(nodes: Array<{ title: string; items?: unknown[] }>, depth = 0): Array<{ title: string; depth: number }> {
  const flattened: Array<{ title: string; depth: number }> = []
  for (const node of nodes) {
    flattened.push({ title: node.title.slice(0, 512), depth })
    if (Array.isArray(node.items)) flattened.push(...flattenOutline(node.items as Array<{ title: string; items?: unknown[] }>, depth + 1))
  }
  return flattened
}
