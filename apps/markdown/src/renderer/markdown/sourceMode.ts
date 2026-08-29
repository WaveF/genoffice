/** Two explicit editing surfaces; only source mode owns raw complete-file text. */
export type MarkdownEditorMode = 'wysiwyg' | 'source'

/**
 * These extensions are not represented by the installed TipTap Markdown
 * schema. Warn before switching surfaces instead of silently claiming a
 * byte-for-byte Markdown round trip. Supported GFM stays warning-free.
 */
export function sourceMayNormalizeInWysiwyg(source: string): boolean {
  return (
    /(^|\n)\s*<\/?[A-Za-z][^>]*>/.test(source) ||
    /(^|\n)\[\^[^\]]+\]:/.test(source) ||
    /(^|\n)\[[^\]]+\]:\s*\S/.test(source) ||
    /(^|\n):::(?:callout|toggle)\b/.test(source)
  )
}

/** Extract authored local image sources from standard Markdown image syntax. */
export function imageSourcesFromMarkdown(source: string): string[] {
  const sources: string[] = []
  const image = /!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g
  for (const match of source.matchAll(image)) sources.push(match[1])
  return sources
}

/** Keep source mode aligned after the main process relocates owned image files. */
export function rewriteMarkdownImageSources(
  source: string,
  rewrites: ReadonlyArray<{ from: string; to: string }>,
): string {
  const bySource = new Map(rewrites.map(({ from, to }) => [from, to]))
  return source.replace(/(!\[[^\]]*\]\()([^\s)]+)((?:\s+[^)]*)?\))/g, (whole, start, src, end) =>
    bySource.has(src) ? `${start}${bySource.get(src)}${end}` : whole,
  )
}
