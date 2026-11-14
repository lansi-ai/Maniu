/** 窄 IPC 注册：校验载荷后转给 link / 窗口；渲染端拿不到宿主 cookie。 */

import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { EventOutcome, HostState, WindowAction } from './contract.ts'
import type { HostLink } from './link.ts'

interface IpcDependencies {
  readonly link: () => HostLink | undefined
  readonly appInfo: () => { readonly version: string; readonly hostUrl?: string }
  readonly window: () => BrowserWindow | undefined
  readonly hostState: () => HostState
}

interface CallRequest {
  readonly namespace: string
  readonly method: string
  readonly args: object
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function callRequest(value: unknown): CallRequest | undefined {
  if (!isRecord(value) || typeof value.namespace !== 'string' || typeof value.method !== 'string' || !isRecord(value.args)) {
    return undefined
  }
  return { namespace: value.namespace, method: value.method, args: value.args }
}

function outcomeOf(value: unknown): EventOutcome | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind === 'next') return { kind: 'next' }
  if (value.kind === 'result') {
    return Object.hasOwn(value, 'value') ? { kind: 'result', value: value.value } : { kind: 'result' }
  }
  if (value.kind === 'rejected' && isRecord(value.error)
    && typeof value.error.name === 'string' && typeof value.error.message === 'string') {
    return {
      kind: 'rejected',
      error: {
        name: value.error.name,
        message: value.error.message,
        ...(typeof value.error.code === 'string' ? { code: value.error.code } : {}),
      },
    }
  }
  return undefined
}

function windowAction(value: unknown): WindowAction | undefined {
  return value === 'minimize' || value === 'toggle-maximize' || value === 'close' ? value : undefined
}

/**
 * 注册 S1 的 IPC 面。
 * @param deps - 当前连接、应用信息与主窗口读取器。
 */
export function registerIpc(deps: IpcDependencies): void {
  ipcMain.handle('lcoder:call', async (_event: IpcMainInvokeEvent, value: unknown) => {
    const request = callRequest(value)
    if (request === undefined) return { ok: false, error: { code: 'lcoder/bad-request', message: '调用参数不合法' } }
    const link = deps.link()
    if (link === undefined) return { ok: false, error: { code: 'lcoder/host-not-ready', message: '宿主尚未就绪' } }
    return link.call(request.namespace, request.method, request.args)
  })
  ipcMain.handle('lcoder:stream-open', (_event: IpcMainInvokeEvent, value: unknown) => {
    const request = callRequest(value)
    if (request === undefined) throw new Error('lcoder: 流参数不合法')
    const link = deps.link()
    if (link === undefined) throw new Error('lcoder: 宿主尚未就绪')
    return link.openStream(request.namespace, request.method, request.args)
  })
  ipcMain.handle('lcoder:stream-cancel', (_event: IpcMainInvokeEvent, value: unknown) => {
    if (typeof value !== 'string') throw new Error('lcoder: 流标识不合法')
    deps.link()?.cancelStream(value)
  })
  ipcMain.handle('lcoder:event-result', async (_event: IpcMainInvokeEvent, value: unknown) => {
    if (!isRecord(value) || typeof value.clientId !== 'string' || typeof value.eventId !== 'string') {
      throw new Error('lcoder: 回执参数不合法')
    }
    const outcome = outcomeOf(value.outcome)
    if (outcome === undefined) throw new Error('lcoder: 回执结果不合法')
    const answer = await deps.link()?.eventResult(value.clientId, value.eventId, outcome)
    if (answer !== undefined && !answer.ok) throw new Error(`lcoder: 回执失败 ${answer.error.code}`)
  })
  ipcMain.handle('lcoder:window', (_event: IpcMainInvokeEvent, value: unknown) => {
    const action = windowAction(value)
    const window = deps.window()
    if (action === undefined || window === undefined) return
    if (action === 'minimize') window.minimize()
    else if (action === 'toggle-maximize') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    } else window.close()
  })
  ipcMain.handle('lcoder:app-info', () => deps.appInfo())
  ipcMain.handle('lcoder:host-state-now', () => deps.hostState())
}

/** 宿主状态推送面。 */
export interface StatePublisher {
  publish(state: HostState): void
  /** 页面加载完成后补发最新状态。 */
  replay(): void
  /** 当前最新状态；新挂载的渲染端主动拉取。 */
  current(): HostState
}

/**
 * 建一个会记住最新状态、并在页面加载完成后补发的推送器。
 * @param window - 主窗口读取器。
 * @returns 推送器。
 */
export function createStatePublisher(window: () => BrowserWindow | undefined): StatePublisher {
  let latest: HostState = { kind: 'starting' }
  const send = (): void => {
    const target = window()
    if (target !== undefined && !target.isDestroyed() && !target.webContents.isLoading()) {
      target.webContents.send('lcoder:host-state', latest)
    }
  }
  return {
    publish(state) {
      latest = state
      send()
    },
    replay: send,
    current: () => latest,
  }
}
