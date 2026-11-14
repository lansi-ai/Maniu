/** 沙箱 preload：只暴露窄 IPC，渲染端拿不到 Node、fetch 或宿主 cookie。 */

import { contextBridge, ipcRenderer } from 'electron'
import type { EventOutcome, HostEvent, HostState, HostWaterfall, LcoderApi, RemoteResult, StreamFrame } from './contract.ts'

function onHostState(listener: (state: HostState) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, state: HostState): void => { listener(state) }
  ipcRenderer.on('lcoder:host-state', handler)
  return () => { ipcRenderer.removeListener('lcoder:host-state', handler) }
}

function onStreamFrame(listener: (streamId: string, frame: StreamFrame) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, streamId: string, frame: StreamFrame): void => { listener(streamId, frame) }
  ipcRenderer.on('lcoder:stream-frame', handler)
  return () => { ipcRenderer.removeListener('lcoder:stream-frame', handler) }
}

function onEvent(listener: (event: HostEvent) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, event: HostEvent): void => { listener(event) }
  ipcRenderer.on('lcoder:events', handler)
  return () => { ipcRenderer.removeListener('lcoder:events', handler) }
}

function onWaterfall(listener: (event: HostWaterfall) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, event: HostWaterfall): void => { listener(event) }
  ipcRenderer.on('lcoder:waterfall', handler)
  return () => { ipcRenderer.removeListener('lcoder:waterfall', handler) }
}

const api: LcoderApi = {
  hostState: onHostState,
  hostStateNow: () => ipcRenderer.invoke('lcoder:host-state-now') as Promise<HostState>,
  call: (namespace, method, args) =>
    ipcRenderer.invoke('lcoder:call', { namespace, method, args }) as Promise<RemoteResult>,
  openStream: (namespace, method, args) =>
    ipcRenderer.invoke('lcoder:stream-open', { namespace, method, args }) as Promise<string>,
  cancelStream: streamId => ipcRenderer.invoke('lcoder:stream-cancel', streamId) as Promise<void>,
  onStreamFrame,
  onEvent,
  onWaterfall,
  eventResult: (clientId, eventId, outcome: EventOutcome) =>
    ipcRenderer.invoke('lcoder:event-result', { clientId, eventId, outcome }) as Promise<void>,
  window: action => ipcRenderer.invoke('lcoder:window', action) as Promise<void>,
  appInfo: () => ipcRenderer.invoke('lcoder:app-info') as Promise<{ readonly version: string; readonly hostUrl?: string }>,
}

contextBridge.exposeInMainWorld('lcoder', api)
