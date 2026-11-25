/** 窄 IPC 注册：校验载荷后转给 link / 窗口；渲染端拿不到宿主 cookie。 */

import {
  dialog, ipcMain, nativeTheme, type BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions,
  type WebContents,
} from 'electron'
import { Buffer } from 'node:buffer'
import { statSync } from 'node:fs'
import { dirname } from 'node:path'
import { IPC_CHANNELS } from './contract.ts'
import type {
  DesktopPreferences, DirectoryPickResult, EventOutcome, HostState, PrototypeInteractionMode,
  PrototypeSelectionInfo, PrototypeStudioDockAction, PrototypeStudioDockState, PrototypeStudioFloatingBounds,
  PrototypeStudioHtmlPayload, PrototypeStudioMode, PrototypeStudioOpenRequest, UpdateCheck, WindowAction,
  WindowStateInfo,
} from './contract.ts'
import { DESKTOP_MESSAGES, fillDesktop, readDesktopPreferences, writeDesktopPreferences } from './desktop-locale.ts'
import { isDesktopLocale, preferencePatchOf } from './preferences.ts'
import type { HostLink } from './link.ts'
import {
  createPrototypePreviewWindow, createPrototypeStudioWindow, MAX_PROTOTYPE_PREVIEW_BYTES, prototypePreviewDataUrl,
  type PrototypeStudioController,
} from './window.ts'

interface IpcDependencies {
  readonly link: () => HostLink | undefined
  readonly appInfo: () => { readonly version: string; readonly hostUrl?: string }
  readonly window: () => BrowserWindow | undefined
  readonly hostState: () => HostState
  readonly windowState: () => WindowStateInfo
  readonly update: () => UpdateCheck
  /** 主进程文案当前语言。 */
  readonly locale: () => DesktopPreferences['locale']
  /** 渲染端确认放弃运行中的回合；由调用方关窗。 */
  readonly confirmClose: () => void
  /** 只切换菜单与托盘语言；落盘由调用方先做。 */
  readonly applyLocale: (locale: DesktopPreferences['locale']) => void
}

interface CallRequest {
  readonly namespace: string
  readonly method: string
  readonly args: object
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 工作台协作界面的读取器；未打开或已销毁时返回 undefined。 */
export interface StudioUiReader {
  studioUiWebContents(): WebContents | undefined
  /** 主窗重载完成后补发最新停靠状态，避免刷新后胶囊消失。 */
  replayStudioDock(): void
}

/**
 * 除主窗外也要送到工作台协作界面的广播通道：事件、流帧、提问撤回与宿主状态。
 * Studio 的对话流只经这些通道拿回显，漏一个就只剩空进度条。
 */
export const STUDIO_BROADCAST_CHANNELS: ReadonlySet<string> = new Set([
  IPC_CHANNELS.events,
  IPC_CHANNELS.waterfall,
  IPC_CHANNELS.waterfallCancel,
  IPC_CHANNELS.streamFrame,
  IPC_CHANNELS.hostState,
])

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
 * 校验预览窗口的元素上报：只收 domPath/html/css 三个受限长度的字符串。
 * @param value - `lcoder:prototype-selection-report` 的载荷。
 * @returns 规格化后的元素信息；非法载荷返回 undefined。
 */
function selectionInfoOf(value: unknown): PrototypeSelectionInfo | undefined {
  if (!isRecord(value)
    || typeof value.domPath !== 'string' || value.domPath === ''
    || typeof value.html !== 'string' || typeof value.css !== 'string') {
    return undefined
  }
  return {
    domPath: value.domPath.slice(0, 2000),
    html: value.html.slice(0, 8000),
    css: value.css.slice(0, 4000),
    ...(typeof value.label === 'string' && value.label.trim() !== ''
      ? { label: value.label.trim().slice(0, 80) }
      : {}),
  }
}

/** 工作台 HTML 必须是非空字符串且不超过预览字节上限。 */
function validStudioHtml(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && Buffer.byteLength(value, 'utf8') <= MAX_PROTOTYPE_PREVIEW_BYTES
}

function isStudioMode(value: unknown): value is PrototypeStudioMode {
  return value === 'split'
    || value === 'fullscreen-pinned'
    || value === 'compare-side-by-side'
    || value === 'compare-fullscreen-pinned'
}

function isInteractionMode(value: unknown): value is PrototypeInteractionMode {
  return value === 'interact' || value === 'select'
}

function isDockAction(value: unknown): value is PrototypeStudioDockAction {
  return value === 'restore' || value === 'close'
}

/** 校验打开工作台的请求；只接受已知字段与受限长度的 HTML。 */
function studioOpenRequestOf(value: unknown): PrototypeStudioOpenRequest | undefined {
  if (!isRecord(value)
    || typeof value.requirementId !== 'string' || value.requirementId.trim() === ''
    || !validStudioHtml(value.html)) return undefined
  if (value.sessionId !== undefined && typeof value.sessionId !== 'string') return undefined
  if (value.beforeHtml !== undefined && !validStudioHtml(value.beforeHtml)) return undefined
  if (value.mode !== undefined && !isStudioMode(value.mode)) return undefined
  return {
    requirementId: value.requirementId,
    html: value.html,
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.beforeHtml === 'string' ? { beforeHtml: value.beforeHtml } : {}),
    ...(isStudioMode(value.mode) ? { mode: value.mode } : {}),
  }
}

/** 校验工作台 HTML 重载载荷；highlightDomPaths 每条路径都受限长度。 */
function studioHtmlPayloadOf(value: unknown): PrototypeStudioHtmlPayload | undefined {
  if (!isRecord(value) || !validStudioHtml(value.html)) return undefined
  if (value.beforeHtml !== undefined && !validStudioHtml(value.beforeHtml)) return undefined
  let highlightDomPaths: string[] | undefined
  if (value.highlightDomPaths !== undefined) {
    if (!Array.isArray(value.highlightDomPaths)) return undefined
    highlightDomPaths = []
    for (const path of value.highlightDomPaths) {
      if (typeof path !== 'string') return undefined
      highlightDomPaths.push(path.slice(0, 2000))
    }
  }
  return {
    html: value.html,
    ...(typeof value.beforeHtml === 'string' ? { beforeHtml: value.beforeHtml } : {}),
    ...(highlightDomPaths === undefined ? {} : { highlightDomPaths }),
  }
}

/** 校验浮窗位置；四个坐标/尺寸都必须是有限数，collapsed 必须是布尔。 */
function floatingBoundsOf(value: unknown): PrototypeStudioFloatingBounds | undefined {
  if (!isRecord(value)) return undefined
  const { x, y, width, height, collapsed } = value
  if (typeof x !== 'number' || !Number.isFinite(x)
    || typeof y !== 'number' || !Number.isFinite(y)
    || typeof width !== 'number' || !Number.isFinite(width)
    || typeof height !== 'number' || !Number.isFinite(height)) return undefined
  if (collapsed !== undefined && typeof collapsed !== 'boolean') return undefined
  return {
    x, y, width, height,
    ...(typeof collapsed === 'boolean' ? { collapsed } : {}),
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch (error: unknown) {
    // 不存在、无权限或非法路径一律按「不是目录」处理，交给回退链。
    void error
    return false
  }
}

/** 从路径向上找最近的已存在目录；直到根都不存在时为 undefined。 */
function nearestExistingDirectory(path: string): string | undefined {
  let current = path
  for (;;) {
    if (isDirectory(current)) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * 折出对话框的起始目录：先取渲染端期望路径的最近已存在目录，再退到上次成功选择的目录。
 * @param value - `lcoder:pick-directory` 的载荷；非字符串或空白视为未指定。
 * @returns 已存在目录；没有可用起点时为 undefined。
 */
function pickerDefaultPath(value: unknown): string | undefined {
  const requested = typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  const remembered = readDesktopPreferences().lastPickedDirectory
  for (const candidate of [requested, remembered]) {
    if (candidate === null || candidate === undefined) continue
    const directory = nearestExistingDirectory(candidate)
    if (directory !== undefined) return directory
  }
  return undefined
}


/**
 * 注册 S1 的 IPC 面。
 * @param deps - 当前连接、应用信息与主窗口读取器。
 * @returns 当前工作台协作界面的读取器；主进程用它把事件与流广播给 Studio。
 */
export function registerIpc(deps: IpcDependencies): StudioUiReader {
  /** 当前独立预览窗口；元素级修改后复用它重载，不堆积多个窗口。 */
  let prototypePreview: BrowserWindow | undefined
  /** 当前 Prototype Studio；重新打开时复用，关闭时随事件清理。 */
  let prototypeStudio: PrototypeStudioController | undefined
  /** 当前工作台需求编号；停靠胶囊上要显示它，窗口关掉后清空。 */
  let studioRequirementId: string | undefined
  /** 最新停靠状态；主窗重载后补发，胶囊不会因为一次刷新就消失。 */
  let dockState: PrototypeStudioDockState = { open: false, minimized: false }
  /** 主窗只挂一次关闭联动；重建的主窗是新对象，各挂各的。 */
  const parentCloseWired = new WeakSet<BrowserWindow>()

  /** 送出当前停靠状态；主窗未就绪时交给 replayStudioDock 补发。 */
  function sendDockState(): void {
    const target = deps.window()
    if (target === undefined || target.isDestroyed()) return
    target.webContents.send(IPC_CHANNELS.prototypeStudioDockState, dockState)
  }

  /** 提交并推送停靠状态；只在状态真正改变后调用。 */
  function publishDockState(next: PrototypeStudioDockState): void {
    dockState = next
    sendDockState()
  }

  /**
   * 主窗关闭时一并关掉独立窗口：它们不再设父窗，生命周期只靠这一条监听联动。
   * @param parent - 发起预览或工作台的主窗。
   */
  function wireParentClose(parent: BrowserWindow): void {
    if (parentCloseWired.has(parent)) return
    parentCloseWired.add(parent)
    parent.once('closed', () => {
      if (prototypePreview !== undefined && !prototypePreview.isDestroyed()) prototypePreview.close()
      if (prototypeStudio !== undefined && !prototypeStudio.window.isDestroyed()) prototypeStudio.window.close()
    })
  }

  ipcMain.handle(IPC_CHANNELS.call, async (_event: IpcMainInvokeEvent, value: unknown) => {
    const request = callRequest(value)
    if (request === undefined) return { ok: false, error: { code: 'lcoder/bad-request', message: '调用参数不合法' } }
    const link = deps.link()
    if (link === undefined) return { ok: false, error: { code: 'lcoder/host-not-ready', message: '宿主尚未就绪' } }
    return link.call(request.namespace, request.method, request.args)
  })
  ipcMain.handle(IPC_CHANNELS.streamOpen, (_event: IpcMainInvokeEvent, value: unknown) => {
    const request = callRequest(value)
    if (request === undefined) throw new Error('lcoder: 流参数不合法')
    const link = deps.link()
    if (link === undefined) throw new Error('lcoder: 宿主尚未就绪')
    return link.openStream(request.namespace, request.method, request.args)
  })
  ipcMain.handle(IPC_CHANNELS.streamCancel, (_event: IpcMainInvokeEvent, value: unknown) => {
    if (typeof value !== 'string') throw new Error('lcoder: 流标识不合法')
    deps.link()?.cancelStream(value)
  })
  ipcMain.handle(IPC_CHANNELS.eventResult, async (_event: IpcMainInvokeEvent, value: unknown) => {
    if (!isRecord(value) || typeof value.clientId !== 'string' || typeof value.eventId !== 'string') {
      throw new Error('lcoder: 回执参数不合法')
    }
    const outcome = outcomeOf(value.outcome)
    if (outcome === undefined) throw new Error('lcoder: 回执结果不合法')
    const answer = await deps.link()?.eventResult(value.clientId, value.eventId, outcome)
    if (answer !== undefined && !answer.ok) throw new Error(`lcoder: 回执失败 ${answer.error.code}`)
  })
  ipcMain.handle(IPC_CHANNELS.window, (_event: IpcMainInvokeEvent, value: unknown) => {
    const action = windowAction(value)
    const window = deps.window()
    if (action === undefined || window === undefined) return
    if (action === 'minimize') window.minimize()
    else if (action === 'toggle-maximize') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    } else window.close()
  })
  ipcMain.handle(IPC_CHANNELS.appInfo, () => deps.appInfo())
  ipcMain.handle(IPC_CHANNELS.confirmClose, () => { deps.confirmClose() })
  ipcMain.handle(IPC_CHANNELS.hostStateNow, () => deps.hostState())
  ipcMain.handle(IPC_CHANNELS.windowStateNow, () => deps.windowState())
  ipcMain.handle(IPC_CHANNELS.update, () => deps.update())
  ipcMain.handle(IPC_CHANNELS.pickDirectory, async (_event: IpcMainInvokeEvent, value: unknown): Promise<DirectoryPickResult> => {
    const window = deps.window()
    const messages = DESKTOP_MESSAGES[deps.locale()]
    const defaultPath = pickerDefaultPath(value)
    const options: OpenDialogOptions = {
      properties: ['openDirectory'],
      title: messages.pickDirectoryTitle,
      ...(defaultPath === undefined ? {} : { defaultPath }),
    }
    try {
      const result = window === undefined ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
      const picked = result.canceled ? null : (result.filePaths[0] ?? null)
      if (picked !== null) writeDesktopPreferences({ lastPickedDirectory: picked })
      return { ok: true, path: picked }
    } catch (cause: unknown) {
      return {
        ok: false,
        message: fillDesktop(messages.pickDirectoryFailed, {
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
      }
    }
  })
  ipcMain.handle(IPC_CHANNELS.locale, (_event: IpcMainInvokeEvent, value: unknown) => {
    if (!isDesktopLocale(value)) throw new Error('lcoder: 界面语言不合法')
    const next = writeDesktopPreferences({ locale: value })
    deps.applyLocale(next.locale)
  })
  ipcMain.handle(IPC_CHANNELS.preferencesRead, () => readDesktopPreferences())
  ipcMain.handle(IPC_CHANNELS.preferencesWrite, (_event: IpcMainInvokeEvent, value: unknown) => {
    const next = writeDesktopPreferences(preferencePatchOf(value))
    deps.applyLocale(next.locale)
    nativeTheme.themeSource = next.skin === 'light' ? 'light' : 'dark'
    return next
  })
  ipcMain.handle(IPC_CHANNELS.prototypePreviewOpen, (_event: IpcMainInvokeEvent, value: unknown) => {
    if (typeof value !== 'string' || value.trim() === '') throw new Error('lcoder: 预览 HTML 不合法')
    if (Buffer.byteLength(value, 'utf8') > MAX_PROTOTYPE_PREVIEW_BYTES) {
      throw new Error('lcoder: 预览 HTML 超过上限')
    }
    const parent = deps.window()
    if (prototypePreview !== undefined && !prototypePreview.isDestroyed()) {
      // 原型被元素级修改后，渲染端重开同一窗口即可看到最新 HTML。
      void prototypePreview.loadURL(prototypePreviewDataUrl(value))
      return
    }
    const preview = createPrototypePreviewWindow(value)
    // 不设主窗子窗：子窗会跟着主窗最小化并留下系统标题栏残条；关主窗时显式关掉它。
    if (parent !== undefined && !parent.isDestroyed()) wireParentClose(parent)
    prototypePreview = preview
    preview.once('closed', () => { prototypePreview = undefined })
  })
  ipcMain.handle(IPC_CHANNELS.prototypeSelectionReport, (_event: IpcMainInvokeEvent, value: unknown) => {
    const info = selectionInfoOf(value)
    if (info === undefined) throw new Error('lcoder: 选中元素信息不合法')
    const target = deps.window()
    if (target !== undefined && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.prototypeSelection, info)
    }
    // 工作台打开时，选中元素也要送到协作界面，让同一需求下的模型侧看到同一份上报。
    const studioUi = prototypeStudio?.uiWebContents()
    if (studioUi !== undefined && !studioUi.isDestroyed()) {
      studioUi.send(IPC_CHANNELS.prototypeSelection, info)
    }
  })
  ipcMain.handle(IPC_CHANNELS.prototypeStudioOpen, (_event: IpcMainInvokeEvent, value: unknown) => {
    const request = studioOpenRequestOf(value)
    if (request === undefined) throw new Error('lcoder: 工作台参数不合法')
    if (prototypeStudio !== undefined && !prototypeStudio.window.isDestroyed()) {
      prototypeStudio.loadHtml(request)
      prototypeStudio.setMode(request.mode ?? 'split')
      // 最小化进主窗后再次打开等于恢复：唤醒窗口并撤掉停靠胶囊。
      prototypeStudio.window.show()
      prototypeStudio.window.focus()
      studioRequirementId = request.requirementId
      publishDockState({ open: true, minimized: false, requirementId: request.requirementId })
      return
    }
    const studio = createPrototypeStudioWindow(request)
    const parent = deps.window()
    // 不设主窗子窗：子窗最小化后会在屏幕角落留下空标题栏；关主窗时由 wireParentClose 联动关闭。
    if (parent !== undefined && !parent.isDestroyed()) wireParentClose(parent)
    prototypeStudio = studio
    studioRequirementId = request.requirementId
    studio.window.on('minimize', (event?: { readonly preventDefault: () => void }) => {
      // 最小化改成隐藏：任务栏不占新条目，改由主窗右下角的停靠胶囊接管恢复。
      // Electron 在 minimize 上实发事件对象，类型声明却写成无参，这里按可选事件读取。
      event?.preventDefault()
      studio.window.hide()
      publishDockState({ open: true, minimized: true, requirementId: request.requirementId })
    })
    studio.window.once('closed', () => {
      if (prototypeStudio !== studio) return
      studio.dispose()
      prototypeStudio = undefined
      studioRequirementId = undefined
      publishDockState({ open: false, minimized: false })
    })
    publishDockState({ open: true, minimized: false, requirementId: request.requirementId })
  })
  ipcMain.handle(IPC_CHANNELS.prototypeStudioSetMode, (_event: IpcMainInvokeEvent, value: unknown) => {
    if (!isStudioMode(value)) throw new Error('lcoder: 工作台模式不合法')
    prototypeStudio?.setMode(value)
  })
  ipcMain.handle(IPC_CHANNELS.prototypeStudioSetInteraction, (_event: IpcMainInvokeEvent, value: unknown) => {
    if (!isInteractionMode(value)) throw new Error('lcoder: 交互模式不合法')
    prototypeStudio?.setInteraction(value)
  })
  ipcMain.handle(IPC_CHANNELS.prototypeStudioLoadHtml, (_event: IpcMainInvokeEvent, value: unknown) => {
    const payload = studioHtmlPayloadOf(value)
    if (payload === undefined) throw new Error('lcoder: 工作台 HTML 不合法')
    prototypeStudio?.loadHtml(payload)
  })
  ipcMain.handle(IPC_CHANNELS.prototypeStudioHighlightPaths, (_event: IpcMainInvokeEvent, value: unknown) => {
    if (!Array.isArray(value)) throw new Error('lcoder: 高亮路径不合法')
    const paths: string[] = []
    for (const path of value) {
      if (typeof path !== 'string') throw new Error('lcoder: 高亮路径不合法')
      paths.push(path.slice(0, 2000))
    }
    prototypeStudio?.highlightPaths(paths)
  })
  ipcMain.handle(IPC_CHANNELS.prototypeStudioSetFloatingBounds, (_event: IpcMainInvokeEvent, value: unknown) => {
    const bounds = floatingBoundsOf(value)
    if (bounds === undefined) throw new Error('lcoder: 浮窗位置不合法')
    prototypeStudio?.setFloatingBounds(bounds)
    return prototypeStudio?.floatingRect()
  })
  ipcMain.on(IPC_CHANNELS.prototypeStudioCompareResize, (_event, value: unknown) => {
    if (!isRecord(value) || typeof value.deltaX !== 'number' || !Number.isFinite(value.deltaX)) return
    prototypeStudio?.nudgeCompareRatio(value.deltaX)
  })
  ipcMain.handle(IPC_CHANNELS.prototypeStudioRestore, (_event: IpcMainInvokeEvent, value: unknown) => {
    const action = isDockAction(value) ? value : undefined
    if (action === undefined) throw new Error('lcoder: 停靠动作不合法')
    const studio = prototypeStudio
    if (studio === undefined || studio.window.isDestroyed()) {
      publishDockState({ open: false, minimized: false })
      return
    }
    if (action === 'close') {
      studio.window.close()
      return
    }
    studio.window.show()
    studio.window.focus()
    publishDockState({
      open: true,
      minimized: false,
      ...(studioRequirementId === undefined ? {} : { requirementId: studioRequirementId }),
    })
  })

  return {
    studioUiWebContents() {
      const ui = prototypeStudio?.uiWebContents()
      return ui === undefined || ui.isDestroyed() ? undefined : ui
    },
    replayStudioDock() { sendDockState() },
  }
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
 * @param extras - 额外接收同一份状态的 webContents 读取器；工作台协作界面也在其中。
 * @returns 推送器。
 */
export function createStatePublisher(
  window: () => BrowserWindow | undefined,
  extras: () => readonly (WebContents | undefined)[] = () => [],
): StatePublisher {
  let latest: HostState = { kind: 'starting' }
  const send = (): void => {
    const target = window()
    // 加载期也发送：丢失由渲染端挂载时的 hostStateNow 补读，而不是永久停在 starting。
    if (target !== undefined && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.hostState, latest)
    }
    for (const extra of extras()) {
      if (extra !== undefined && !extra.isDestroyed()) extra.send(IPC_CHANNELS.hostState, latest)
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

/**
 * 建一个会记住最新窗口状态、并在页面加载完成后补发的推送器。
 * @param window - 主窗口读取器。
 * @returns 推送器。
 */
export function createWindowStatePublisher(window: () => BrowserWindow | undefined): {
  publish(state: WindowStateInfo): void
  replay(): void
  current(): WindowStateInfo
} {
  let latest: WindowStateInfo = { maximized: false, fullscreen: false }
  const send = (): void => {
    const target = window()
    if (target !== undefined && !target.isDestroyed()) {
      target.webContents.send(IPC_CHANNELS.windowState, latest)
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
