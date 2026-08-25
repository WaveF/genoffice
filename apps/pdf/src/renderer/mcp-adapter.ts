export function handlePdfMcpRequest(
  action: 'pdf.get_document_context' | 'pdf.read_page_context',
  input: Record<string, unknown>,
  state: { pageCount: number; sizes: Array<{ width: number; height: number }>; pageBlocks: Map<number, Array<{ lines: Array<{ text: string }> }>> },
): unknown {
  if (action === 'pdf.get_document_context') return { pageCount: state.pageCount, pages: state.sizes.slice(0, 200).map((size, index) => ({ index, width: size.width, height: size.height })) }
  const page = input.page
  if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 0 || page >= state.pageCount) throw new Error('A valid page index is required')
  return { page, size: state.sizes[page], blocks: (state.pageBlocks.get(page) ?? []).slice(0, 500).map((block) => ({ text: block.lines.map((line) => line.text).join('\n').slice(0, 8192) })) }
}
