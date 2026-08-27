import { contextBridge, ipcRenderer } from 'electron'
import type { Lang } from '@genoffice/i18n'
import { PDF_CHANNELS } from '../shared/ipc'
import type { PdfApi, UiTheme } from '../shared/ipc'

type PdfMcpRequest = {
  requestId: string
  action:
    | 'pdf.get_document_context'
    | 'pdf.read_page_context'
    | 'pdf.search'
    | 'pdf.read_annotations'
    | 'pdf.apply_operations'
  input: Record<string, unknown>
}

let pdfMcpHandler: ((request: PdfMcpRequest) => void) | null = null
const pendingPdfMcpRequests: PdfMcpRequest[] = []

ipcRenderer.on('mcp:renderer-request', (_event, request: PdfMcpRequest) => {
  if (pdfMcpHandler) pdfMcpHandler(request)
  else pendingPdfMcpRequests.push(request)
})
ipcRenderer.send('mcp:renderer-ready')

function registerPdfMcpHandler(handler: (request: PdfMcpRequest) => void): () => void {
  pdfMcpHandler = handler
  for (const request of pendingPdfMcpRequests.splice(0)) handler(request)
  return () => {
    if (pdfMcpHandler === handler) pdfMcpHandler = null
  }
}

const api: PdfApi = {
  onMcpRequest: registerPdfMcpHandler,
  respondMcpRequest: (response) => ipcRenderer.send('mcp:renderer-response', response),
  reportMcpRevision: (revision) => ipcRenderer.send('mcp:renderer-revision', revision),
  consumePending: () => ipcRenderer.invoke(PDF_CHANNELS.consumePending),
  readFile: (path) => ipcRenderer.invoke(PDF_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(PDF_CHANNELS.save, request),
  autoRename: (path, baseName) => ipcRenderer.invoke(PDF_CHANNELS.autoRename, path, baseName),
  isUntitled: (path) => ipcRenderer.invoke(PDF_CHANNELS.isUntitled, path),
  validateTextEdits: (request) => ipcRenderer.invoke(PDF_CHANNELS.validateTextEdits, request),
  listEditFonts: () => ipcRenderer.invoke(PDF_CHANNELS.listEditFonts),
  canDrawText: (text, font, bold, italic) =>
    ipcRenderer.invoke(PDF_CHANNELS.canDrawText, text, font, bold, italic),
  listPageImages: (path) => ipcRenderer.invoke(PDF_CHANNELS.listPageImages, path),
  listStaticFormFills: (path) => ipcRenderer.invoke(PDF_CHANNELS.listStaticFormFills, path),
  ocrPage: (png) => ipcRenderer.invoke(PDF_CHANNELS.ocrPage, png),
  pageImagePng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pageImagePng, request),
  pagePreviewPng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pagePreviewPng, request),
  extractPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.extractPages, request),
  insertPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertPdf, request),
  insertBlankPage: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertBlankPage, request),
  splitPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPdf, request),
  mergePdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePdf, request),
  mergePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePages, request),
  replacePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.replacePages, request),
  setPageSize: (request) => ipcRenderer.invoke(PDF_CHANNELS.setPageSize, request),
  splitPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPages, request),
  cropPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.cropPages, request),
  exportImages: (request) => ipcRenderer.invoke(PDF_CHANNELS.exportImages, request),
  convertOffice: (format) => ipcRenderer.invoke(PDF_CHANNELS.convertOffice, format),
  createDocument: (request) => ipcRenderer.invoke(PDF_CHANNELS.createDocument, request),
  listSavedSignatures: () => ipcRenderer.invoke(PDF_CHANNELS.listSignatures),
  addSavedSignature: (data) => ipcRenderer.invoke(PDF_CHANNELS.addSignature, data),
  removeSavedSignature: (id) => ipcRenderer.invoke(PDF_CHANNELS.removeSignature, id),
  getUsername: () => ipcRenderer.invoke(PDF_CHANNELS.getUsername),
  setDirty: (dirty) => ipcRenderer.send(PDF_CHANNELS.dirtyChanged, dirty),
  onCloseSaveRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(PDF_CHANNELS.closeSaveResult, ok),
  onSaveAsRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, targetPath: string) => handler(targetPath)
    ipcRenderer.on(PDF_CHANNELS.saveAsRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsRequest, listener)
  },
  sendSaveAsResult: (ok) => ipcRenderer.send(PDF_CHANNELS.saveAsResult, ok),
  onSaveAsFlow: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, inFlight: boolean) => handler(inFlight)
    ipcRenderer.on(PDF_CHANNELS.saveAsFlow, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsFlow, listener)
  },
  onPrintRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.printRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.printRequest, listener)
  },
  getLanguage: () => ipcRenderer.invoke(PDF_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(PDF_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.languageChanged, listener)
  },
  getTheme: () => ipcRenderer.invoke(PDF_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(PDF_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.themeChanged, listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
}

// Shared project chat store (registered app-wide by the shell's main init):
// AI PDF conversations persist per file, like Docs/Sheets (alpha ledger r142)
const projectApi = {
  resolveChat: (args: { filePath: string | null; tempChatId?: string }) =>
    ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args: unknown) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args: { projectId: string; chatId: string; limit?: number }) =>
    ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args: { projectId: string; tempChatId: string; newFilePath: string }) =>
    ipcRenderer.invoke('project:rebindChat', args),
}

contextBridge.exposeInMainWorld('pdfApi', api)
contextBridge.exposeInMainWorld('projectApi', projectApi)
