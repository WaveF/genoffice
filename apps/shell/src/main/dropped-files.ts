import { partitionDropPayload } from '@nexoffice/electron-utils/drop-open'

export function handleDroppedFiles(
  raw: unknown,
  deps: {
    openDocumentPath(path: string): boolean
    revealShellWindow(): void
    showWarning(message: string): void
    unsupportedMessage(exts: string[]): string
  },
): void {
  const { supported, unsupportedExts } = partitionDropPayload(raw)
  let opened = false
  for (const path of supported) opened = deps.openDocumentPath(path) || opened
  if (opened) deps.revealShellWindow()
  if (unsupportedExts.length) deps.showWarning(deps.unsupportedMessage(unsupportedExts))
}
