import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useI18n } from './i18n/locale'
import {
  buildFrontmatterRaw,
  frontmatterInner,
  parseDocText,
  serializeDocText,
  stripLegacyFencedDivs,
  type DocEnvelope,
} from './markdown/docText'
import { buildExtensions } from './editor/extensions'
import { buildSlashItems } from './editor/slashCommand'
import type { SlashController, SlashMenuState } from './editor/slashCommand'
import { setImageBaseDir } from './editor/localImage'
import { Ribbon } from './components/Ribbon'
import { SlashMenu, type SlashMenuHandle } from './components/SlashMenu'
import { TableMenu } from './components/TableMenu'
import { SourceTableMenu } from './components/SourceTableMenu'
import { FrontmatterPanel } from './components/FrontmatterPanel'
import { DOCX_MAX_IMAGE_PX, exportDocxBytes } from './export/docxExport'
import { buildPrintHtml } from './export/printHtml'
import { resolveImageSrc } from './editor/localImage'
import type { ExportFormat, SaveMode } from '../shared/ipc'
import { handleMarkdownMcpRequest } from './mcp-adapter'
import { McpRevisionTracker } from './mcp-revision'
import {
  imageSourcesFromMarkdown,
  rewriteMarkdownImageSources,
  sourceMayNormalizeInWysiwyg,
  type MarkdownEditorMode,
} from './markdown/sourceMode'
import {
  editSourceTable,
  hasSourceTableAt,
  insertLinkSource,
  insertSourceText,
  insertTableSource,
  toggleBlockSource,
  toggleInlineSource,
  toggleListSource,
  type SourceBlock,
  type SourceEdit,
  type SourceInline,
  type SourceList,
  type SourceSelection,
  type SourceTableOperation,
} from './markdown/sourceCommands'

type LoadStatus = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10

const EMPTY_ENVELOPE: DocEnvelope = {
  frontmatter: '',
  body: '',
  eol: '\n',
  trailingNewline: true,
  bom: false,
}

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function imageSourcesFromEditor(editor: Editor): string[] {
  const sources: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image' && typeof node.attrs.src === 'string') {
      sources.push(node.attrs.src)
    }
  })
  return sources
}

function applyImageRewrites(
  editor: Editor,
  rewrites: ReadonlyArray<{ from: string; to: string }>,
): void {
  const bySource = new Map(rewrites.map(({ from, to }) => [from, to]))
  if (bySource.size === 0) return
  let transaction = editor.state.tr
  let changed = false
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image') return
    const replacement = bySource.get(String(node.attrs.src ?? ''))
    if (!replacement || replacement === node.attrs.src) return
    transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, src: replacement })
    changed = true
  })
  if (!changed) return
  transaction.setMeta('addToHistory', false).setMeta('uiOnly', true)
  editor.view.dispatch(transaction)
}

/** Measure a document image via the DOM (the editor already displays it) */
function measureImage(displaySrc: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolvePromise) => {
    const img = new Image()
    img.onload = () => resolvePromise({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolvePromise(null)
    img.src = displaySrc
  })
}

/** File name for an AI-generated untitled document: first heading, else first words */
export function deriveAutoFileName(editor: Editor): string {
  const doc = editor.state.doc
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i)
    const text = node.textContent.replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (node.type.name === 'heading') return text.slice(0, 60)
    return text.split(' ').slice(0, 8).join(' ').slice(0, 60)
  }
  return ''
}

export default function App() {
  const { t } = useI18n()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [slashState, setSlashState] = useState<SlashMenuState | null>(null)
  const [fmOpen, setFmOpen] = useState(false)
  const [fmText, setFmText] = useState('')
  const [autoSave, setAutoSave] = useState(() => localStorage.getItem('mdapp.autoSave') === '1')
  const [zoom, setZoom] = useState(100)
  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>('wysiwyg')
  const [sourceText, setSourceText] = useState('')
  const [normalizationWarning, setNormalizationWarning] = useState(false)
  const [sourceHistoryVersion, setSourceHistoryVersion] = useState(0)
  const [sourceSelection, setSourceSelectionState] = useState<SourceSelection>({ start: 0, end: 0 })

  const statusRef = useRef<LoadStatus>('loading')
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const envelopeRef = useRef<DocEnvelope>(EMPTY_ENVELOPE)
  const mcpRevisionRef = useRef(new McpRevisionTracker())
  const editorRef = useRef<Editor | null>(null)
  const filePathRef = useRef<string | null>(null)
  const slashMenuRef = useRef<SlashMenuHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const editorModeRef = useRef<MarkdownEditorMode>('wysiwyg')
  const sourceTextRef = useRef('')
  const sourceSelectionRef = useRef<SourceSelection>({ start: 0, end: 0 })
  const pendingSourceSelectionRef = useRef<SourceSelection | null>(null)
  const sourceHistoryRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] })

  const zoomOut = useCallback(
    () => setZoom((value) => Math.max(MIN_ZOOM, Math.round(value) - ZOOM_STEP)),
    [],
  )
  const zoomIn = useCallback(
    () => setZoom((value) => Math.min(MAX_ZOOM, Math.round(value) + ZOOM_STEP)),
    [],
  )

  const markDirty = useCallback(() => {
    if (statusRef.current !== 'ready') return
    window.markdownApi.reportMcpRevision(mcpRevisionRef.current.advance())
    if (!dirtyRef.current) {
      dirtyRef.current = true
      setDirty(true)
      setSaveState('idle')
      window.markdownApi.setDirty(true)
    }
  }, [])

  const setMode = useCallback((next: MarkdownEditorMode) => {
    editorModeRef.current = next
    setEditorMode(next)
  }, [])

  const insertImage = useCallback(() => {
    void (async () => {
      const relPath = await window.markdownApi.pickImage()
      const current = editorRef.current
      if (relPath && current) current.chain().focus().setImage({ src: relPath }).run()
    })()
  }, [])

  const extensions = useMemo(() => {
    const controller: SlashController = {
      onOpen: setSlashState,
      onUpdate: setSlashState,
      onKeyDown: (event) => slashMenuRef.current?.handleKey(event) ?? false,
      onClose: () => setSlashState(null),
    }
    return buildExtensions({
      slashController: controller,
      slashItems: () =>
        buildSlashItems({ insertImage: filePathRef.current ? insertImage : undefined }),
    })
  }, [insertImage])

  const editor = useEditor({
    extensions,
    content: '',
    autofocus: true,
    editorProps: { attributes: { class: 'doc-editor' } },
    // uiOnly transactions (toggle fold state) never reach the file — not dirty
    onUpdate: ({ transaction }) => {
      if (!transaction.getMeta('uiOnly')) markDirty()
    },
  })
  editorRef.current = editor
  filePathRef.current = filePath

  useEffect(() => {
    if (!editor) return
    return window.markdownApi.onMcpRequest((request) => {
      try {
        if (editorModeRef.current === 'source') {
          throw new Error(
            'Markdown source mode has unsynchronized edits; switch back to WYSIWYG before MCP access',
          )
        }
        const revisionBefore = mcpRevisionRef.current.current
        const result = handleMarkdownMcpRequest(editor, request.action, request.input)
        // Tiptap normally emits onUpdate synchronously. Keep MCP compare-and-set
        // sound even if a whole-document source replacement produces no update
        // event (for example, a parser-normalized equivalent document).
        if (
          request.action === 'markdown.set_source' &&
          mcpRevisionRef.current.current === revisionBefore
        ) {
          markDirty()
        }
        window.markdownApi.respondMcpRequest({
          requestId: request.requestId,
          ok: true,
          result: {
            ...(result as Record<string, unknown>),
            revision: mcpRevisionRef.current.current,
          },
        })
      } catch (error) {
        window.markdownApi.respondMcpRequest({
          requestId: request.requestId,
          ok: false,
          error: error instanceof Error ? error.message : 'Markdown MCP request failed',
        })
      }
    })
  }, [editor, markDirty])

  useEffect(() => {
    setImageBaseDir(filePath ? dirOf(filePath) : null)
  }, [filePath])

  useEffect(() => {
    if (!editor) return
    let cancelled = false
    void (async () => {
      try {
        const path = await window.markdownApi.consumePending()
        if (cancelled) return
        if (path) {
          const raw = await window.markdownApi.readFile(path)
          if (cancelled) return
          const envelope = parseDocText(raw)
          envelopeRef.current = envelope
          setImageBaseDir(dirOf(path))
          // the initial load must not be undoable — Cmd+Z right after opening
          // would otherwise blank the document (and Cmd+S overwrite the file)
          editor
            .chain()
            .setMeta('addToHistory', false)
            .setContent(stripLegacyFencedDivs(envelope.body), { contentType: 'markdown' })
            .run()
          setFilePath(path)
          const inner = frontmatterInner(envelope.frontmatter)
          setFmText(inner)
          if (inner) setFmOpen(true)
        } else {
          envelopeRef.current = { ...EMPTY_ENVELOPE }
        }
        statusRef.current = 'ready'
        setStatus('ready')
      } catch (err) {
        console.error('[markdown] load failed:', err)
        if (!cancelled) {
          statusRef.current = 'error'
          setStatus('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editor])

  const onFrontmatterChange = useCallback(
    (inner: string) => {
      setFmText(inner)
      envelopeRef.current.frontmatter = buildFrontmatterRaw(inner)
      markDirty()
    },
    [markDirty],
  )

  const enterSourceMode = useCallback(() => {
    const current = editorRef.current
    if (!current || statusRef.current !== 'ready') return
    const completeSource = serializeDocText(envelopeRef.current, current.getMarkdown())
    sourceTextRef.current = completeSource
    sourceSelectionRef.current = { start: 0, end: 0 }
    sourceHistoryRef.current = { past: [], future: [] }
    setSourceHistoryVersion((version) => version + 1)
    setSourceText(completeSource)
    setNormalizationWarning(false)
    setFmOpen(false)
    setMode('source')
  }, [setMode])

  const applySourceToWysiwyg = useCallback(() => {
    const current = editorRef.current
    if (!current || statusRef.current !== 'ready') return
    const completeSource = sourceTextRef.current
    const envelope = parseDocText(completeSource)
    envelopeRef.current = envelope
    setFmText(frontmatterInner(envelope.frontmatter))
    current
      .chain()
      .setMeta('addToHistory', false)
      .setMeta('uiOnly', true)
      .setContent(stripLegacyFencedDivs(envelope.body), { contentType: 'markdown' })
      .run()
    setNormalizationWarning(false)
    setMode('wysiwyg')
  }, [setMode])

  const enterWysiwygMode = useCallback(() => {
    if (sourceMayNormalizeInWysiwyg(sourceTextRef.current)) {
      setNormalizationWarning(true)
      return
    }
    applySourceToWysiwyg()
  }, [applySourceToWysiwyg])

  const toggleEditorMode = useCallback(() => {
    if (editorModeRef.current === 'source') enterWysiwygMode()
    else enterSourceMode()
  }, [enterSourceMode, enterWysiwygMode])

  const setSourceSelection = useCallback((selection: SourceSelection) => {
    sourceSelectionRef.current = selection
    setSourceSelectionState(selection)
  }, [])

  const applySourceEdit = useCallback(
    (edit: SourceEdit, recordHistory = true) => {
      const previous = sourceTextRef.current
      if (edit.value === previous) return
      if (recordHistory) {
        sourceHistoryRef.current.past.push(previous)
        if (sourceHistoryRef.current.past.length > 200) sourceHistoryRef.current.past.shift()
        sourceHistoryRef.current.future = []
        setSourceHistoryVersion((version) => version + 1)
      }
      sourceTextRef.current = edit.value
      sourceSelectionRef.current = edit.selection
      pendingSourceSelectionRef.current = edit.selection
      setSourceText(edit.value)
      setSourceSelection(edit.selection)
      setNormalizationWarning(false)
      markDirty()
    },
    [markDirty, setSourceSelection],
  )

  const onSourceChange = useCallback(
    (value: string, selection: SourceSelection) => {
      applySourceEdit({ value, selection })
    },
    [applySourceEdit],
  )

  const undoSource = useCallback(() => {
    const previous = sourceHistoryRef.current.past.pop()
    if (previous === undefined) return
    sourceHistoryRef.current.future.push(sourceTextRef.current)
    setSourceHistoryVersion((version) => version + 1)
    applySourceEdit({ value: previous, selection: sourceSelectionRef.current }, false)
  }, [applySourceEdit])

  const redoSource = useCallback(() => {
    const next = sourceHistoryRef.current.future.pop()
    if (next === undefined) return
    sourceHistoryRef.current.past.push(sourceTextRef.current)
    setSourceHistoryVersion((version) => version + 1)
    applySourceEdit({ value: next, selection: sourceSelectionRef.current }, false)
  }, [applySourceEdit])

  const currentSourceSelection = useCallback((): SourceSelection => {
    const textarea = sourceRef.current
    if (textarea) {
      return { start: textarea.selectionStart, end: textarea.selectionEnd }
    }
    return sourceSelectionRef.current
  }, [])

  const applySourceCommand = useCallback(
    (command: (value: string, selection: SourceSelection) => SourceEdit | null) => {
      const selection = currentSourceSelection()
      const edit = command(sourceTextRef.current, selection)
      if (edit) applySourceEdit(edit)
    },
    [applySourceEdit, currentSourceSelection],
  )

  const insertSourceImage = useCallback(() => {
    void (async () => {
      const src = await window.markdownApi.pickImage()
      if (!src) return
      const alt = src.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '') || 'image'
      applySourceCommand((value, selection) =>
        insertSourceText(value, selection, `![${alt}](${src})`),
      )
    })()
  }, [applySourceCommand])

  const sourceCommands = useMemo(
    () => ({
      canUndo: sourceHistoryRef.current.past.length > 0,
      canRedo: sourceHistoryRef.current.future.length > 0,
      undo: undoSource,
      redo: redoSource,
      inline: (kind: SourceInline) =>
        applySourceCommand((value, selection) => toggleInlineSource(value, selection, kind)),
      block: (kind: SourceBlock) =>
        applySourceCommand((value, selection) => toggleBlockSource(value, selection, kind)),
      list: (kind: SourceList) =>
        applySourceCommand((value, selection) => toggleListSource(value, selection, kind)),
      insertLink: (url: string) =>
        applySourceCommand((value, selection) => insertLinkSource(value, selection, url)),
      insertTable: () => applySourceCommand(insertTableSource),
      insertImage: insertSourceImage,
      insertHorizontalRule: () =>
        applySourceCommand((value, selection) => insertSourceText(value, selection, '\n\n---\n\n')),
    }),
    [
      applySourceCommand,
      insertSourceImage,
      redoSource,
      sourceHistoryVersion,
      undoSource,
    ],
  )

  useEffect(() => {
    if (editorMode === 'source') {
      window.setTimeout(() => {
        const textarea = sourceRef.current
        if (!textarea) return
        textarea.focus()
        const selection = pendingSourceSelectionRef.current
        if (selection) {
          textarea.setSelectionRange(selection.start, selection.end)
          pendingSourceSelectionRef.current = null
        }
      }, 0)
    }
    else if (editor) window.setTimeout(() => editor.commands.focus('start'), 0)
  }, [editor, editorMode, sourceText])

  /** Serialize and write to disk; false when canceled/failed (caller keeps the tab open) */
  const doSave = useCallback(async (mode: SaveMode, suggestedName?: string): Promise<boolean> => {
    const current = editorRef.current
    if (!current || statusRef.current !== 'ready' || savingRef.current) return false
    savingRef.current = true
    setSaveState('saving')
    try {
      // edits landing while the write is in flight (AI streaming, fast typing)
      // must keep the document dirty — compare doc identity after the await
      const savingSource = editorModeRef.current === 'source'
      const sourceAtSave = sourceTextRef.current
      const docAtSave = current.state.doc
      const fmAtSave = envelopeRef.current.frontmatter
      const text = savingSource
        ? sourceAtSave
        : serializeDocText(envelopeRef.current, current.getMarkdown())
      const imageSources = savingSource
        ? imageSourcesFromMarkdown(parseDocText(sourceAtSave).body)
        : imageSourcesFromEditor(current)
      const result = await window.markdownApi.save({ text, imageSources, mode, suggestedName })
      if (result.ok && 'path' in result) {
        const unchanged = savingSource
          ? sourceTextRef.current === sourceAtSave
          : editorRef.current?.state.doc === docAtSave && envelopeRef.current.frontmatter === fmAtSave
        if (result.imageRewrites?.length && editorRef.current) {
          if (savingSource) {
            const rewritten = rewriteMarkdownImageSources(sourceTextRef.current, result.imageRewrites)
            sourceTextRef.current = rewritten
            setSourceText(rewritten)
          } else {
            applyImageRewrites(editorRef.current, result.imageRewrites)
          }
        }
        setImageBaseDir(dirOf(result.path))
        setFilePath(result.path)
        if (unchanged) {
          dirtyRef.current = false
          setDirty(false)
          window.markdownApi.setDirty(false)
          setSaveState('saved')
        } else {
          // the main process cleared its dirty flag on write — re-assert it
          dirtyRef.current = true
          setDirty(true)
          window.markdownApi.setDirty(true)
          setSaveState('idle')
        }
        return true
      }
      setSaveState(result.ok ? 'idle' : 'failed')
      return false
    } catch (err) {
      console.error('[markdown] save failed:', err)
      setSaveState('failed')
      return false
    } finally {
      savingRef.current = false
    }
  }, [])

  const runExport = useCallback(async (format: ExportFormat) => {
    const current = editorRef.current
    if (!current || statusRef.current !== 'ready') return
    const suggestedName =
      (filePathRef.current
        ? filePathRef.current.replace(/^.*[/\\]/, '').replace(/\.(md|markdown)$/i, '')
        : deriveAutoFileName(current)) || 'Untitled'
    try {
      if (format === 'pdf') {
        const html = buildPrintHtml(current.view.dom, suggestedName)
        const result = await window.markdownApi.exportPdf({ html, suggestedName })
        if (!result.ok) console.error('[markdown] pdf export failed:', result.error)
        return
      }
      const loadImage = async (src: string) => {
        const data = await window.markdownApi.readImage(src)
        if (!data) return null
        const dims = await measureImage(resolveImageSrc(src))
        let width = dims?.width || 400
        let height = dims?.height || 300
        if (width > DOCX_MAX_IMAGE_PX) {
          height = Math.round((height * DOCX_MAX_IMAGE_PX) / width)
          width = DOCX_MAX_IMAGE_PX
        }
        return { base64: data.base64, mime: data.mime, widthPx: width, heightPx: height }
      }
      const bytes = await exportDocxBytes(current.getJSON(), loadImage)
      const result = await window.markdownApi.exportDocx({
        base64: bytesToBase64(bytes),
        suggestedName,
        mode: format === 'docs' ? 'openInDocs' : 'dialog',
      })
      if (!result.ok) console.error('[markdown] docx export failed:', result.error)
    } catch (err) {
      console.error('[markdown] export failed:', err)
    }
  }, [])

  /**
   * Print through the same self-contained HTML the PDF export uses, loaded into a
   * hidden same-session iframe (md-asset:// images keep resolving) — printing the
   * live page would drag the ribbon/panels along, and Electron has no built-in
   * preview to crop them out.
   */
  const printingRef = useRef(false)
  const printDoc = useCallback(async () => {
    const current = editorRef.current
    if (!current || statusRef.current !== 'ready' || printingRef.current) return
    printingRef.current = true
    const title =
      (filePathRef.current
        ? filePathRef.current.replace(/^.*[/\\]/, '').replace(/\.(md|markdown)$/i, '')
        : deriveAutoFileName(current)) || 'Untitled'
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.right = '100%'
    frame.style.bottom = '100%'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    try {
      await new Promise<void>((resolve) => {
        frame.onload = () => resolve()
        frame.srcdoc = buildPrintHtml(current.view.dom, title)
        document.body.appendChild(frame)
      })
      const fdoc = frame.contentDocument
      const fwin = frame.contentWindow
      if (!fdoc || !fwin) return
      // the export path passes printToPDF margins instead; the dialog needs @page
      const pageStyle = fdoc.createElement('style')
      pageStyle.textContent = '@page { margin: 0.6in; }'
      fdoc.head.appendChild(pageStyle)
      await Promise.all([...fdoc.images].map((img) => img.decode().catch(() => {})))
      // resolve on afterprint so the frame survives until the dialog closes (cancel included)
      await new Promise<void>((resolve) => {
        fwin.addEventListener('afterprint', () => resolve())
        fwin.print()
      })
    } catch (err) {
      console.error('[markdown] print failed:', err)
    } finally {
      frame.remove()
      printingRef.current = false
    }
  }, [])

  useEffect(() => {
    const offExport = window.markdownApi.onExportRequest((format) => void runExport(format))
    const offPrint = window.markdownApi.onPrintRequest(() => void printDoc())
    return () => {
      offExport()
      offPrint()
    }
  }, [runExport, printDoc])

  useEffect(() => {
    const offSave = window.markdownApi.onSaveRequest(
      (mode) => void doSave(mode).then((ok) => window.markdownApi.sendSaveRequestAck(ok)),
    )
    const offClose = window.markdownApi.onCloseSaveRequest(() => {
      void (async () => {
        // A close-save can race the blur autosave. Wait for it rather than
        // treating savingRef as a failed explicit save; it may already have
        // persisted every edit, in which case closing can proceed directly.
        while (savingRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 50))
        }
        if (!dirtyRef.current) {
          window.markdownApi.sendCloseSaveResult(true)
          return
        }
        window.markdownApi.sendCloseSaveResult(await doSave('save'))
      })()
    })
    const offRenamed = window.markdownApi.onFileRenamed((newPath) => setFilePath(newPath))
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void doSave(event.shiftKey ? 'saveAs' : 'save')
      } else if (key === 'p' && !event.shiftKey) {
        event.preventDefault()
        void printDoc()
      } else if (key === '=' || key === '+') {
        event.preventDefault()
        zoomIn()
      } else if (key === '-' || key === '_') {
        event.preventDefault()
        zoomOut()
      } else if (key === '0') {
        event.preventDefault()
        setZoom(100)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      offSave()
      offClose()
      offRenamed()
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [doSave, printDoc, zoomIn, zoomOut])

  // Chromium reports trackpad pinch as ctrl+wheel. Also support Cmd/Ctrl+scroll
  // while the pointer is over the document canvas.
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (!(event.target as HTMLElement | null)?.closest?.('.editor-scroll')) return
      event.preventDefault()
      setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value - event.deltaY * 0.6)))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    localStorage.setItem('mdapp.autoSave', autoSave ? '1' : '0')
  }, [autoSave])

  // autosave: every 30s and on window blur, silently persist pending changes
  // (same policy as the docs app; untitled documents are skipped — the first
  // save must go through the explicit save path that names the file)
  useEffect(() => {
    if (!autoSave || !filePath) return
    const tick = () => {
      if (!dirtyRef.current) return
      if (editorRef.current?.view.composing) return // don't interrupt IME input
      void doSave('save')
    }
    const id = window.setInterval(tick, 30_000)
    window.addEventListener('blur', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('blur', tick)
    }
  }, [autoSave, filePath, doSave])

  const fileName = filePath ? filePath.replace(/^.*[/\\]/, '') : null
  const statusText =
    saveState === 'saving'
      ? t('saving')
      : saveState === 'failed'
        ? t('saveFailed')
        : dirty
          ? t('unsaved')
          : saveState === 'saved'
            ? t('savedOk')
            : ''

  if (status === 'error') {
    return (
      <div className="app">
        <div className="center-note">{t('loadError')}</div>
      </div>
    )
  }

  return (
    <div className="app">
      <Ribbon
        editor={editor}
        disabled={status !== 'ready'}
        dirty={dirty}
        onSave={() => void doSave('save')}
        autoSave={autoSave}
        onToggleAutoSave={setAutoSave}
        imageEnabled={Boolean(filePath)}
        onInsertImage={insertImage}
        frontmatterOpen={fmOpen}
        onToggleFrontmatter={() => setFmOpen((v) => !v)}
        sourceMode={editorMode === 'source'}
        onToggleSourceMode={toggleEditorMode}
        sourceCommands={sourceCommands}
      />
      {status === 'loading' && <div className="center-note">{t('loading')}</div>}
      <div className="app-main" style={status === 'ready' ? undefined : { display: 'none' }}>
        <div className="app-content">
          <div className="editor-scroll" ref={scrollRef}>
            <div className="doc-page" style={{ zoom: zoom / 100 }}>
              {editorMode === 'source' ? (
                <>
                  {normalizationWarning && (
                    <div className="source-normalization-warning" role="alert">
                      <span>
                        This source contains extensions that rich-text mode may normalize.
                      </span>
                      <div className="source-warning-actions">
                        <button type="button" onClick={() => setNormalizationWarning(false)}>
                          Keep editing source
                        </button>
                        <button type="button" onClick={applySourceToWysiwyg}>
                          Switch and normalize
                        </button>
                      </div>
                    </div>
                  )}
                  <textarea
                    ref={sourceRef}
                    className="markdown-source-editor"
                    aria-label="Markdown source"
                    spellCheck={false}
                    value={sourceText}
                    onChange={(event) =>
                      onSourceChange(event.target.value, {
                        start: event.target.selectionStart,
                        end: event.target.selectionEnd,
                      })
                    }
                    onSelect={(event) =>
                      setSourceSelection({
                        start: event.currentTarget.selectionStart,
                        end: event.currentTarget.selectionEnd,
                      })
                    }
                    onKeyUp={(event) =>
                      setSourceSelection({
                        start: event.currentTarget.selectionStart,
                        end: event.currentTarget.selectionEnd,
                      })
                    }
                    onClick={(event) =>
                      setSourceSelection({
                        start: event.currentTarget.selectionStart,
                        end: event.currentTarget.selectionEnd,
                      })
                    }
                    onKeyDown={(event) => {
                      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
                      const key = event.key.toLowerCase()
                      if (key === 'z') {
                        event.preventDefault()
                        if (event.shiftKey) redoSource()
                        else undoSource()
                      } else if (key === 'y') {
                        event.preventDefault()
                        redoSource()
                      }
                    }}
                  />
                </>
              ) : (
                <>
                  {fmOpen && <FrontmatterPanel value={fmText} onChange={onFrontmatterChange} />}
                  <EditorContent editor={editor} />
                </>
              )}
            </div>
          </div>
          <footer className="status-bar">
            <div className="status-left">
              {fileName && <span className="status-item status-file">{fileName}</span>}
            </div>
            <div className="status-right">
              {statusText && (
                <span className={`status-save status-${saveState}`}>{statusText}</span>
              )}
              <button
                type="button"
                className="zoom-btn"
                aria-label="Zoom out"
                onClick={zoomOut}
                disabled={zoom <= MIN_ZOOM}
              >
                −
              </button>
              <input
                className="zoom-slider"
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={ZOOM_STEP}
                value={Math.round(zoom)}
                aria-label="Zoom"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <button
                type="button"
                className="zoom-btn"
                aria-label="Zoom in"
                onClick={zoomIn}
                disabled={zoom >= MAX_ZOOM}
              >
                +
              </button>
              <span className="zoom-value">{Math.round(zoom)}%</span>
            </div>
          </footer>
        </div>
      </div>
      <SlashMenu ref={slashMenuRef} state={slashState} onDismiss={() => setSlashState(null)} />
      {editorMode === 'wysiwyg' && <TableMenu editor={editor} scrollRef={scrollRef} zoom={zoom} />}
      {editorMode === 'source' && hasSourceTableAt(sourceText, sourceSelection) && (
        <SourceTableMenu
          onOperation={(operation: SourceTableOperation) =>
            applySourceCommand((value, selection) => editSourceTable(value, selection, operation))
          }
        />
      )}
    </div>
  )
}
