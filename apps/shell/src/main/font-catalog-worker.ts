import { parentPort } from 'node:worker_threads'
import { listSystemFontFamilyEntries } from '@nexoffice/font-metrics'

if (!parentPort) throw new Error('Font catalog worker requires a parent port.')

try {
  parentPort.postMessage({ ok: true, entries: listSystemFontFamilyEntries() })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : 'Unable to enumerate system fonts.',
  })
}
