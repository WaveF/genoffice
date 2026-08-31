import { ipcRenderer, webUtils } from 'electron'

export const DROP_OPEN_CHANNEL = 'app:open-dropped-files'
export const OPENABLE_DOC_RE = /\.(docx|xlsx|xlsm|xls|csv|pptx|pdf|md|markdown)$/i
export const KNOWN_UNSUPPORTED_DOC_RE = /\.(doc|rtf|odt|ppt|pps|odp|ods|xlsb|pages|key|numbers)$/i
const MAX_DROPPED_FILES = 20
const INSTALLED = Symbol.for('nexoffice.drop-open-installed')

export function partitionDropPayload(raw: unknown): { supported: string[]; unsupportedExts: string[] } {
  const supported: string[] = []
  const unsupportedExts: string[] = []
  if (!Array.isArray(raw)) return { supported, unsupportedExts }
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const path = value.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    if (OPENABLE_DOC_RE.test(path)) {
      if (supported.length < MAX_DROPPED_FILES) supported.push(path)
    } else if (KNOWN_UNSUPPORTED_DOC_RE.test(path)) {
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      if (!unsupportedExts.includes(ext)) unsupportedExts.push(ext)
    }
  }
  return { supported, unsupportedExts }
}

export function installDropOpenBridge(): void {
  const holder = globalThis as Record<symbol, boolean | undefined>
  if (typeof window === 'undefined' || holder[INSTALLED]) return
  holder[INSTALLED] = true
  window.addEventListener('dragover', (event) => {
    if (!event.defaultPrevented && event.dataTransfer?.types.includes('Files')) event.preventDefault()
  })
  window.addEventListener('drop', (event) => {
    if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files')) return
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => webUtils.getPathForFile(file).trim())
      .filter((path) => OPENABLE_DOC_RE.test(path) || KNOWN_UNSUPPORTED_DOC_RE.test(path))
    event.preventDefault()
    if (paths.length) ipcRenderer.send(DROP_OPEN_CHANNEL, paths.slice(0, MAX_DROPPED_FILES))
  })
}
