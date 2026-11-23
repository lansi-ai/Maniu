/** 主窗口：frameless、默认 1280×800、只加载本地渲染产物。 */

import { app, BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_CHANNELS } from './contract.ts'
import type {
  PrototypeInteractionMode, PrototypeStudioFloatingBounds, PrototypeStudioHtmlPayload,
  PrototypeStudioInspectControl, PrototypeStudioMode, PrototypeStudioOpenRequest,
} from './contract.ts'
import { REPO_ROOT } from './profile.ts'

/**
 * 应用图标：发布态取 extraResources 里的 app.ico，开发态取本包 resources。
 * @returns 多尺寸 ICO 的绝对路径。
 */
export function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.ico')
    : join(import.meta.dirname, '..', '..', 'resources', 'maniu-windows.ico')
}

/** 渲染产物入口：开发态取本仓 client 包的 dist，发布态取安装包内的 client-dist。 */
export function clientIndex(): string {
  const override = process.env.LCODER_CLIENT_DIST
  if (override !== undefined && override !== '') return override
  return app.isPackaged
    ? join(process.resourcesPath, 'client-dist', 'index.html')
    : join(REPO_ROOT, 'packages', 'lcoder', 'client', 'lib', 'dist', 'index.html')
}

/** 创建唯一的 S1 主窗口。 */
export function createMainWindow(): BrowserWindow {
  const preload = join(import.meta.dirname, '..', 'preload.cjs')
  const index = clientIndex()
  if (!existsSync(index)) throw new Error(`lcoder desktop: 找不到渲染产物 ${index}`)
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // 无边框窗口在 Windows 上仍带不可见缩放边，按内容区算才能让渲染端正好 1280×800。
    useContentSize: true,
    minWidth: 900,
    minHeight: 640,
    resizable: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f6fc',
    title: 'Maniu',
    icon: appIconPath(),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 窗口被遮挡或失焦时继续按真实帧率渲染，流式观察与 CDP 采样才不会被节流降频。
      backgroundThrottling: false,
    },
  })
  window.once('ready-to-show', () => { window.show() })
  void window.loadFile(index)
  return window
}

/** 独立预览窗口标题；带上沙箱字样，避免被当成主窗内容。 */
export const PROTOTYPE_PREVIEW_TITLE = '原型预览（沙箱）'

/** 预览 HTML 的字节上限，与原型落盘上限一致。 */
export const MAX_PROTOTYPE_PREVIEW_BYTES = 512 * 1024

/**
 * 预览窗口允许加载的 URL：只放行内联 data、本地 file 与 about 地址。
 * 任何 http(s)、ws(s) 等外部网络地址都被拦截，原型无法访问网络。
 * @param url - `webRequest.onBeforeRequest` 捕获到的请求地址。
 * @returns 允许加载时为 true。
 */
export function isAllowedPrototypePreviewUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('file:') || url.startsWith('about:')
}

/**
 * 把原型 HTML 折成预览窗口的内联 data URL；不套主窗 CSP，内联脚本与 CSS 可运行。
 * @param html - 单文件原型 HTML。
 * @returns 可直接交给 BrowserWindow.loadURL 的地址。
 */
export function prototypePreviewDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/** 共享分区的 session 类型；预览窗口与 Studio 画布都用它安装同一套离线拦截。 */
type PrototypeSession = WebContents['session']

/**
 * 给原型 session 装离线拦截：只放行 data/file/about，外部网络请求一律取消。
 * 调用方按 session 各自安装一次；Studio 的 after/before 画布共用同一分区，只装一次。
 * @param session - 原型分区对应的 Electron session。
 */
export function installPrototypeOfflineGuard(session: PrototypeSession): void {
  session.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => { callback({ cancel: !isAllowedPrototypePreviewUrl(details.url) }) },
  )
}

/**
 * 创建独立、离线、无业务 IPC 的原型交互预览窗口。
 *
 * 它使用专用 preload（只暴露元素上报）、独立内存 session（离线拦截不污染主窗
 * 默认 session），不加载主窗 index.html，也不带主窗 CSP，因此原型自己的内联
 * 脚本与 CSS 可以运行。窗口本身不接主窗的关窗确认/退出逻辑。
 * @param html - 已读出的单文件原型 HTML。
 * @returns 预览窗口。
 */
export function createPrototypePreviewWindow(html: string): BrowserWindow {
  const preload = join(import.meta.dirname, '..', 'prototype-preview-preload.cjs')
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: PROTOTYPE_PREVIEW_TITLE,
    webPreferences: {
      preload,
      // 独立 partition：离线拦截只作用在本窗口，不影响主窗默认 session。
      partition: 'lcoder-prototype-preview',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  installPrototypeOfflineGuard(window.webContents.session)
  void window.loadURL(prototypePreviewDataUrl(html))
  return window
}

/** 视图矩形；x/y 为左上角，width/height 为尺寸。 */
export interface StudioRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 一次布局的结果；before 为 undefined 表示并排对比左画布不参与当前模式。 */
export interface StudioLayout {
  readonly after: StudioRect
  readonly before: StudioRect | undefined
  readonly beforeVisible: boolean
  readonly ui: StudioRect
}

/** 分屏模式下原型画布占窗宽的比例。 */
export const STUDIO_CANVAS_RATIO = 0.68
/** 协作界面最小宽度，窄窗时优先保证它可读。 */
export const STUDIO_UI_MIN_WIDTH = 340
/** 全屏置顶浮窗与窗边的间距。 */
export const STUDIO_FLOATING_MARGIN = 24
/** 浮窗展开时的默认宽高。 */
export const STUDIO_FLOATING_WIDTH = 380
export const STUDIO_FLOATING_HEIGHT = 520
/** 折叠胶囊的高度。 */
export const STUDIO_COLLAPSED_HEIGHT = 48
/** 默认浮窗靠右上；x/y 为负表示自动贴右/贴上。 */
export const DEFAULT_FLOATING_BOUNDS: PrototypeStudioFloatingBounds = {
  x: -1, y: -1, width: STUDIO_FLOATING_WIDTH, height: STUDIO_FLOATING_HEIGHT, collapsed: false,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 算全屏置顶模式的协作浮窗矩形；负 x/y 由窗口尺寸推出贴右/贴上的坐标。 */
function floatingRect(width: number, height: number, bounds: PrototypeStudioFloatingBounds): StudioRect {
  const panelWidth = clamp(Math.round(bounds.width), 200, Math.max(200, width - 2 * STUDIO_FLOATING_MARGIN))
  const wantedHeight = bounds.collapsed === true ? STUDIO_COLLAPSED_HEIGHT : Math.round(bounds.height)
  const panelHeight = clamp(
    wantedHeight,
    bounds.collapsed === true ? STUDIO_COLLAPSED_HEIGHT : 120,
    Math.max(STUDIO_COLLAPSED_HEIGHT, height - 2 * STUDIO_FLOATING_MARGIN),
  )
  const maxX = Math.max(STUDIO_FLOATING_MARGIN, width - panelWidth - STUDIO_FLOATING_MARGIN)
  const maxY = Math.max(STUDIO_FLOATING_MARGIN, height - panelHeight - STUDIO_FLOATING_MARGIN)
  const rawX = bounds.x < 0 ? maxX : Math.round(bounds.x)
  const rawY = bounds.y < 0 ? STUDIO_FLOATING_MARGIN : Math.round(bounds.y)
  return {
    x: clamp(rawX, STUDIO_FLOATING_MARGIN, maxX),
    y: clamp(rawY, STUDIO_FLOATING_MARGIN, maxY),
    width: panelWidth,
    height: panelHeight,
  }
}

/**
 * 按窗口尺寸纯计算三模式的视图矩形；不触碰任何视图对象，便于确定性地验证布局。
 * @param mode - 当前视图模式。
 * @param width - 窗口内容宽度。
 * @param height - 窗口内容高度。
 * @param bounds - 全屏置顶模式的浮窗位置与尺寸。
 * @returns 各视图的矩形与左画布可见性。
 */
export function studioLayout(
  mode: PrototypeStudioMode,
  width: number,
  height: number,
  bounds: PrototypeStudioFloatingBounds = DEFAULT_FLOATING_BOUNDS,
): StudioLayout {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  if (mode === 'fullscreen-pinned') {
    return {
      after: { x: 0, y: 0, width: w, height: h },
      before: undefined,
      beforeVisible: false,
      ui: floatingRect(w, h, bounds),
    }
  }
  const uiWidth = clamp(w - Math.round(w * STUDIO_CANVAS_RATIO), STUDIO_UI_MIN_WIDTH, w)
  const canvasWidth = w - uiWidth
  const ui: StudioRect = { x: canvasWidth, y: 0, width: uiWidth, height: h }
  if (mode === 'compare-side-by-side') {
    const beforeWidth = Math.floor(canvasWidth / 2)
    const afterWidth = canvasWidth - beforeWidth
    return {
      before: { x: 0, y: 0, width: beforeWidth, height: h },
      after: { x: beforeWidth, y: 0, width: afterWidth, height: h },
      beforeVisible: true,
      ui,
    }
  }
  return {
    after: { x: 0, y: 0, width: canvasWidth, height: h },
    before: undefined,
    beforeVisible: false,
    ui,
  }
}

/** Prototype Studio 控制器：协调三块视图、下行检查器控制，并暴露点选转发目标。 */
export interface PrototypeStudioController {
  /** Studio 所在窗口；用于设置父窗与监听关闭。 */
  readonly window: BrowserWindow
  setMode(mode: PrototypeStudioMode): void
  setInteraction(mode: PrototypeInteractionMode): void
  loadHtml(payload: PrototypeStudioHtmlPayload): void
  highlightPaths(paths: readonly string[]): void
  setFloatingBounds(bounds: PrototypeStudioFloatingBounds): void
  /** 协作界面 webContents；点选上报的转发目标，销毁后返回 undefined。 */
  uiWebContents(): WebContents | undefined
  /** 移除子视图与 resize 监听；由窗口 closed 事件调用，不销毁协作界面视图。 */
  dispose(): void
}

/** 建一块离线、无业务 IPC 的原型画布视图（after/before 共用同一分区与 preload）。 */
function makePrototypeCanvas(): WebContentsView {
  const preload = join(import.meta.dirname, '..', 'prototype-preview-preload.cjs')
  return new WebContentsView({
    webPreferences: {
      preload,
      partition: 'lcoder-prototype-preview',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
}

/** 建加载主窗标准 preload 的协作界面视图；query 让渲染端挂载 Studio 专用视图。 */
function makeStudioUiView(request: PrototypeStudioOpenRequest): WebContentsView {
  const preload = join(import.meta.dirname, '..', 'preload.cjs')
  const view = new WebContentsView({
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  void view.webContents.loadFile(clientIndex(), {
    query: {
      view: 'prototype-studio',
      requirementId: request.requirementId,
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
    },
  })
  return view
}

/**
 * 创建 Prototype Studio 工作台：独立窗口 + 三块 WebContentsView。
 *
 * after 与按需创建的 before 画布只装原型 preload、共用离线分区；uiView 用主窗标准
 * preload 加载协作界面。所有模式切换只改矩形与可见性，协作界面视图始终保留。
 * @param request - 需求标识、暂存版/正式版 HTML 与初始模式。
 * @returns 工作台控制器。
 */
export function createPrototypeStudioWindow(request: PrototypeStudioOpenRequest): PrototypeStudioController {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    useContentSize: true,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#f3f6fc',
    title: 'Prototype Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const afterView = makePrototypeCanvas()
  const uiView = makeStudioUiView(request)
  installPrototypeOfflineGuard(afterView.webContents.session)
  window.contentView.addChildView(afterView)
  window.contentView.addChildView(uiView)

  let beforeView: WebContentsView | undefined
  let beforeHtml = request.beforeHtml
  let mode: PrototypeStudioMode = request.mode ?? 'split'
  let bounds: PrototypeStudioFloatingBounds = { ...DEFAULT_FLOATING_BOUNDS }
  let disposed = false

  function ensureBeforeView(): WebContentsView {
    if (beforeView !== undefined) return beforeView
    const view = makePrototypeCanvas()
    window.contentView.addChildView(view)
    beforeView = view
    return view
  }

  function sendToCanvases(payload: PrototypeStudioInspectControl): void {
    if (disposed) return
    afterView.webContents.send(IPC_CHANNELS.prototypeStudioInspectControl, payload)
    beforeView?.webContents.send(IPC_CHANNELS.prototypeStudioInspectControl, payload)
  }

  function layout(): void {
    if (disposed || window.isDestroyed()) return
    const size = window.getSize()
    const rects = studioLayout(mode, size[0] ?? 0, size[1] ?? 0, bounds)
    afterView.setBounds(rects.after)
    uiView.setBounds(rects.ui)
    uiView.setVisible(true)
    if (beforeView !== undefined) {
      beforeView.setVisible(rects.beforeVisible)
      if (rects.before !== undefined) beforeView.setBounds(rects.before)
    }
  }

  window.on('resize', layout)
  window.once('ready-to-show', () => { window.show() })
  void afterView.webContents.loadURL(prototypePreviewDataUrl(request.html))
  if (mode === 'compare-side-by-side' && beforeHtml !== undefined) {
    void ensureBeforeView().webContents.loadURL(prototypePreviewDataUrl(beforeHtml))
  }
  layout()

  return {
    window,
    setMode(next) {
      mode = next
      if (next === 'compare-side-by-side' && beforeHtml !== undefined && beforeView === undefined) {
        void ensureBeforeView().webContents.loadURL(prototypePreviewDataUrl(beforeHtml))
      }
      layout()
    },
    setInteraction(next) { sendToCanvases({ interactionMode: next }) },
    loadHtml(payload) {
      void afterView.webContents.loadURL(prototypePreviewDataUrl(payload.html))
      if (payload.beforeHtml !== undefined && payload.beforeHtml !== '') {
        beforeHtml = payload.beforeHtml
        void ensureBeforeView().webContents.loadURL(prototypePreviewDataUrl(payload.beforeHtml))
      }
      if (payload.highlightDomPaths !== undefined) {
        sendToCanvases({ highlightDomPaths: [...payload.highlightDomPaths] })
      }
      layout()
    },
    highlightPaths(paths) { sendToCanvases({ highlightDomPaths: [...paths] }) },
    setFloatingBounds(next) {
      bounds = { ...bounds, ...next }
      layout()
    },
    uiWebContents() { return disposed ? undefined : uiView.webContents },
    dispose() {
      if (disposed) return
      disposed = true
      window.removeListener('resize', layout)
      for (const view of [afterView, uiView, ...(beforeView === undefined ? [] : [beforeView])]) {
        window.contentView.removeChildView(view)
      }
    },
  }
}
