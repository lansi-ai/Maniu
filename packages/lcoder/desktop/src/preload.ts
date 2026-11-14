/** 沙箱 preload：只暴露窄 IPC，渲染端拿不到 Node、fetch 或宿主 cookie。 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from './contract.ts'
import type {
  DesktopLocaleId, DesktopPreferences, EventOutcome, HostEvent, HostState, HostWaterfall, HostWaterfallCancel,
  LcoderApi, RemoteResult, StreamFrame, UpdateCheck, WindowStateInfo,
} from './contract.ts'

function onHostState(listener: (state: HostState) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, state: HostState): void => { listener(state) }
  ipcRenderer.on(IPC_CHANNELS.hostState, handler)
  return () => { ipcRenderer.removeListener(IPC_CHANNELS.hostState, handler) }
}

function onStreamFrame(listener: (streamId: string, frame: StreamFrame) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, streamId: string, frame: StreamFrame): void => { listener(streamId, frame) }
  ipcRenderer.on(IPC_CHANNELS.streamFrame, handler)
  return () => { ipcRenderer.removeListener(IPC_CHANNELS.streamFrame, handler) }
}

function onEvent(listener: (event: HostEvent) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, event: HostEvent): void => { listener(event) }
  ipcRenderer.on(IPC_CHANNELS.events, handler)
  return () => { ipcRenderer.removeListener(IPC_CHANNELS.events, handler) }
}

function onWaterfall(listener: (event: HostWaterfall) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, event: HostWaterfall): void => { listener(event) }
  ipcRenderer.on(IPC_CHANNELS.waterfall, handler)
  return () => { ipcRenderer.removeListener(IPC_CHANNELS.waterfall, handler) }
}

function onWaterfallCancel(listener: (event: HostWaterfallCancel) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, event: HostWaterfallCancel): void => { listener(event) }
  ipcRenderer.on(IPC_CHANNELS.waterfallCancel, handler)
  return () => { ipcRenderer.removeListener(IPC_CHANNELS.waterfallCancel, handler) }
}

function onWindowState(listener: (state: WindowStateInfo) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, state: WindowStateInfo): void => { listener(state) }
  ipcRenderer.on(IPC_CHANNELS.windowState, handler)
  return () => { ipcRenderer.removeListener(IPC_CHANNELS.windowState, handler) }
}

const api: LcoderApi = {
  hostState: onHostState,
  hostStateNow: () => ipcRenderer.invoke(IPC_CHANNELS.hostStateNow) as Promise<HostState>,
  call: (namespace, method, args) =>
    ipcRenderer.invoke(IPC_CHANNELS.call, { namespace, method, args }) as Promise<RemoteResult>,
  openStream: (namespace, method, args) =>
    ipcRenderer.invoke(IPC_CHANNELS.streamOpen, { namespace, method, args }) as Promise<string>,
  cancelStream: streamId => ipcRenderer.invoke(IPC_CHANNELS.streamCancel, streamId) as Promise<void>,
  onStreamFrame,
  onEvent,
  onWaterfall,
  onWaterfallCancel,
  eventResult: (clientId, eventId, outcome: EventOutcome) =>
    ipcRenderer.invoke(IPC_CHANNELS.eventResult, { clientId, eventId, outcome }) as Promise<void>,
  window: action => ipcRenderer.invoke(IPC_CHANNELS.window, action) as Promise<void>,
  windowState: onWindowState,
  windowStateNow: () => ipcRenderer.invoke(IPC_CHANNELS.windowStateNow) as Promise<WindowStateInfo>,
  appInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<{ readonly version: string; readonly hostUrl?: string }>,
  update: () => ipcRenderer.invoke(IPC_CHANNELS.update) as Promise<UpdateCheck>,
  setLocale: (locale: DesktopLocaleId) => ipcRenderer.invoke(IPC_CHANNELS.locale, locale) as Promise<void>,
  readPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.preferencesRead) as Promise<DesktopPreferences>,
  writePreferences: (patch: Partial<DesktopPreferences>) =>
    ipcRenderer.invoke(IPC_CHANNELS.preferencesWrite, patch) as Promise<DesktopPreferences>,
}

contextBridge.exposeInMainWorld('lcoder', api)
