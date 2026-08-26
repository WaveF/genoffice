import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  DesktopApi,
  MenuCommand,
  UiTheme,
} from '../shared/ipc'
import type { ProjectApi } from '@genoffice/project-store'

const api: DesktopApi = {
  getLanguage: () => ipcRenderer.invoke('app:get-language'),
  onLanguageChanged: (handler) => {
    const listener = (
      _event: IpcRendererEvent,
      lang: 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar',
    ) => handler(lang)
    ipcRenderer.on('app:language-changed', listener)
    return () => ipcRenderer.removeListener('app:language-changed', listener)
  },
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  onThemeChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
  openDocx: () => ipcRenderer.invoke('docs:open'),
  openDocxPath: (path: string) => ipcRenderer.invoke('docs:open-path', path),
  openDocxDecrypt: (path: string, password: string) =>
    ipcRenderer.invoke('docs:open-decrypt', path, password),
  setDocPassword: (filePath: string | null, password: string | null) =>
    ipcRenderer.invoke('docs:set-password', filePath, password),
  docPasswordIntentRevision: async () => {
    const revision: unknown = await ipcRenderer.invoke('docs:password-intent-revision')
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
      ? revision
      : 0
  },
  discardDocPasswordIntents: (throughRevision: number) =>
    ipcRenderer.invoke('docs:discard-password-intents', throughRevision),
  consumePendingOpenDocx: () => ipcRenderer.invoke('docs:consume-pending-open'),
  consumeNewBlankDoc: () => ipcRenderer.invoke('docs:consume-new-blank'),
  onOpenDocx: (handler) => {
    const listener = (_event: IpcRendererEvent, result: Parameters<typeof handler>[0]) =>
      handler(result)
    ipcRenderer.on('docs:opened', listener)
    return () => ipcRenderer.removeListener('docs:opened', listener)
  },
  onRenamedDocx: (handler) => {
    const listener = (_event: IpcRendererEvent, paths: Parameters<typeof handler>[0]) =>
      handler(paths)
    ipcRenderer.on('docs:renamed', listener)
    return () => ipcRenderer.removeListener('docs:renamed', listener)
  },
  onMcpRequest: (handler) => {
    const listener = (
      _event: IpcRendererEvent,
      request: {
        requestId: string
        action:
          'docs.get_context' | 'docs.read_blocks' | 'docs.insert_content' | 'docs.replace_blocks'
        input: Record<string, unknown>
      },
    ) => handler(request)
    ipcRenderer.on('mcp:renderer-request', listener)
    return () => ipcRenderer.removeListener('mcp:renderer-request', listener)
  },
  respondMcpRequest: (response) => ipcRenderer.send('mcp:renderer-response', response),
  reportMcpRevision: (revision) => ipcRenderer.send('mcp:renderer-revision', revision),
  saveDocx: (path: string, data: ArrayBuffer, auto?: boolean) =>
    ipcRenderer.invoke('docs:save', path, data, auto === true),
  writeRecoveryCopy: (path: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('docs:write-recovery', path, data),
  onTeardown: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('docs:teardown', listener)
    return () => ipcRenderer.removeListener('docs:teardown', listener)
  },
  saveDocxAs: (defaultName: string, data: ArrayBuffer, sourcePath?: string | null) =>
    ipcRenderer.invoke('docs:save-as', defaultName, data, sourcePath ?? null),
  saveDocxNew: (defaultName: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('docs:save-new', defaultName, data),
  getRecentFiles: () => ipcRenderer.invoke('docs:recent'),
  pickImage: () => ipcRenderer.invoke('docs:pick-image'),
  fontMetrics: (family: string) => ipcRenderer.invoke('docs:font-metrics', family),
  print: () => ipcRenderer.invoke('docs:print'),
  exportPdf: (
    defaultName: string,
    pageWidthTwips: number,
    pageHeightTwips: number,
    outPath?: string,
  ) => ipcRenderer.invoke('docs:export-pdf', defaultName, pageWidthTwips, pageHeightTwips, outPath),
  printPdfBuffer: (pageWidthTwips: number, pageHeightTwips: number) =>
    ipcRenderer.invoke('docs:print-pdf-buffer', pageWidthTwips, pageHeightTwips),
  saveMergedPdf: (defaultName: string, base64Parts: string[], outPath?: string) =>
    ipcRenderer.invoke('docs:save-merged-pdf', defaultName, base64Parts, outPath),
  fetchImage: (url: string) => ipcRenderer.invoke('ai:fetch-image', url),
  copyImageToClipboard: (dataUrl: string, metaJson?: string) =>
    ipcRenderer.invoke('docs:copy-image-to-clipboard', dataUrl, metaJson),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openNewTab: (openPath?: string | null) => ipcRenderer.invoke('win:new', openPath ?? null),
  listDocsTabs: () => ipcRenderer.invoke('win:list'),
  focusDocsTab: (id: string) => ipcRenderer.invoke('win:focus', id),
  onMenuCommand: (handler: (command: MenuCommand, payload?: string) => void) => {
    const listener = (_event: IpcRendererEvent, command: MenuCommand, payload?: string) =>
      handler(command, payload)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  onCloseCheck: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('docs:close-check', listener)
    return () => ipcRenderer.removeListener('docs:close-check', listener)
  },
  reportViewMenuState: (state: { darkCanvas: boolean }) =>
    ipcRenderer.send('docs:view-menu-state', {
      darkCanvas: state?.darkCanvas === true,
    }),
  reportCloseCheck: (state: { dirty: boolean; autoSave: boolean; filePath?: string | null }) =>
    ipcRenderer.send('docs:close-check-result', {
      dirty: state?.dirty === true,
      autoSave: state?.autoSave === true,
      filePath: typeof state?.filePath === 'string' ? state.filePath : null,
    }),
  onCloseSaveRequest: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('docs:close-save-request', listener)
    return () => ipcRenderer.removeListener('docs:close-save-request', listener)
  },
  reportCloseSaveResult: (ok: boolean) => ipcRenderer.send('docs:close-save-result', ok === true),
}

const projectApi: ProjectApi = {
  resolveChat: (args) => ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args) => ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),
  // P1 extensions
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (args) => ipcRenderer.invoke('project:create', args),
  renameProject: (args) => ipcRenderer.invoke('project:rename', args),
  deleteProject: (args) => ipcRenderer.invoke('project:delete', args),
  moveFile: (args) => ipcRenderer.invoke('project:moveFile', args),
  getTimeline: (args) => ipcRenderer.invoke('project:timeline', args),
}

contextBridge.exposeInMainWorld('desktop', api)
contextBridge.exposeInMainWorld('projectApi', projectApi)
