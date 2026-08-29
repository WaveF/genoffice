import { contextBridge, ipcRenderer } from 'electron'
import type { Lang } from '@genoffice/i18n'
import type { ProjectApi } from '@genoffice/project-store'
import { MARKDOWN_CHANNELS } from '../shared/ipc'
import type { ExportFormat, MarkdownApi, SaveMode, UiTheme } from '../shared/ipc'

type MarkdownMcpRequest = {
  requestId: string
  action:
    | 'markdown.get_context'
    | 'markdown.read_blocks'
    | 'markdown.insert_content'
    | 'markdown.replace_blocks'
    | 'markdown.set_source'
    | 'markdown.apply_commands'
    | 'markdown.insert_image'
  input: Record<string, unknown>
}

let markdownMcpHandler: ((request: MarkdownMcpRequest) => void) | null = null
const pendingMarkdownMcpRequests: MarkdownMcpRequest[] = []

ipcRenderer.on('mcp:renderer-request', (_event, request: MarkdownMcpRequest) => {
  if (markdownMcpHandler) markdownMcpHandler(request)
  else pendingMarkdownMcpRequests.push(request)
})
ipcRenderer.send('mcp:renderer-ready')

function registerMarkdownMcpHandler(handler: (request: MarkdownMcpRequest) => void): () => void {
  markdownMcpHandler = handler
  for (const request of pendingMarkdownMcpRequests.splice(0)) handler(request)
  return () => {
    if (markdownMcpHandler === handler) markdownMcpHandler = null
  }
}

const api: MarkdownApi = {
  consumePending: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.consumePending),
  readFile: (path) => ipcRenderer.invoke(MARKDOWN_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.save, request),
  setDirty: (dirty) => ipcRenderer.send(MARKDOWN_CHANNELS.dirtyChanged, dirty),
  onSaveRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, mode: SaveMode) => handler(mode)
    ipcRenderer.on(MARKDOWN_CHANNELS.saveRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.saveRequest, listener)
  },
  onCloseSaveRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(MARKDOWN_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(MARKDOWN_CHANNELS.closeSaveResult, ok),
  sendSaveRequestAck: (ok) => ipcRenderer.send(MARKDOWN_CHANNELS.saveRequestAck, ok),
  onFileRenamed: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, newPath: string) => handler(newPath)
    ipcRenderer.on(MARKDOWN_CHANNELS.fileRenamed, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.fileRenamed, listener)
  },
  onMcpRequest: registerMarkdownMcpHandler,
  respondMcpRequest: (response) => ipcRenderer.send('mcp:renderer-response', response),
  reportMcpRevision: (revision) => ipcRenderer.send('mcp:renderer-revision', revision),
  pickImage: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.pickImage),
  saveImage: (data) => ipcRenderer.invoke(MARKDOWN_CHANNELS.saveImage, data),
  readImage: (src) => ipcRenderer.invoke(MARKDOWN_CHANNELS.readImage, src),
  onExportRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, format: ExportFormat) => handler(format)
    ipcRenderer.on(MARKDOWN_CHANNELS.exportRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.exportRequest, listener)
  },
  onPrintRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(MARKDOWN_CHANNELS.printRequest, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.printRequest, listener)
  },
  exportDocx: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.exportDocx, request),
  exportPdf: (request) => ipcRenderer.invoke(MARKDOWN_CHANNELS.exportPdf, request),
  getLanguage: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(MARKDOWN_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.languageChanged, listener)
  },
  getTheme: () => ipcRenderer.invoke(MARKDOWN_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(MARKDOWN_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(MARKDOWN_CHANNELS.themeChanged, listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
}

/** Chat persistence: the shared project:* handlers are registered once by the shell (docs-main registerProjectIpc) */
const projectApi: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'> = {
  resolveChat: (args) => ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args) => ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),
}

contextBridge.exposeInMainWorld('markdownApi', api)
contextBridge.exposeInMainWorld('projectApi', projectApi)
