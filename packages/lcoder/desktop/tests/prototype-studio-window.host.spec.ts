/** Prototype Studio：三模式几何确定、resize 更新、协作界面不被销毁、画布离线隔离。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'

type Mock = ReturnType<typeof vi.fn>

interface FakeWebContents {
  readonly send: Mock
  readonly loadURL: Mock
  readonly loadFile: Mock
  readonly session: { readonly webRequest: { readonly onBeforeRequest: Mock } }
  isDestroyed(): boolean
}

interface ViewOptions { readonly webPreferences: Readonly<Record<string, unknown>> }
interface WindowOptions { readonly title?: string }

const electron = vi.hoisted(() => {
  const views: FakeCanvasView[] = []
  const windows: FakeStudioWindow[] = []
  const sharedPrototypeSession = { webRequest: { onBeforeRequest: vi.fn() } }
  class FakeCanvasView {
    readonly webPreferences: Readonly<Record<string, unknown>>
    readonly webContents: FakeWebContents
    readonly setBounds = vi.fn()
    readonly setVisible = vi.fn()
    constructor(options: ViewOptions) {
      this.webPreferences = options.webPreferences
      const session = options.webPreferences.partition === 'lcoder-prototype-preview'
        ? sharedPrototypeSession
        : { webRequest: { onBeforeRequest: vi.fn() } }
      this.webContents = {
        send: vi.fn(), loadURL: vi.fn(), loadFile: vi.fn(), session, isDestroyed: () => false,
      }
      views.push(this)
    }
  }
  class FakeStudioWindow {
    readonly options: WindowOptions
    readonly contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    readonly webContents = { send: vi.fn() }
    readonly setParentWindow = vi.fn()
    readonly show = vi.fn()
    readonly listeners = new Map<string, Array<() => void>>()
    private size: [number, number] = [1440, 900]
    constructor(options: WindowOptions) { this.options = options; windows.push(this) }
    on(event: string, listener: () => void): void {
      const list = this.listeners.get(event) ?? []
      list.push(listener)
      this.listeners.set(event, list)
    }
    once(event: string, listener: () => void): void { this.on(event, listener) }
    removeListener(event: string, listener: () => void): void {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter(item => item !== listener))
    }
    emit(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener() }
    resizeTo(width: number, height: number): void { this.size = [width, height] }
    getSize(): [number, number] { return this.size }
    isDestroyed(): boolean { return false }
  }
  return { views, windows, sharedPrototypeSession, FakeCanvasView, FakeStudioWindow, app: { isPackaged: false } }
})
vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.FakeStudioWindow,
  WebContentsView: electron.FakeCanvasView,
}))

const {
  createPrototypeStudioWindow, studioLayout, DEFAULT_FLOATING_BOUNDS, STUDIO_COLLAPSED_HEIGHT,
} = await import('../src/window.ts')

type FakeView = InstanceType<typeof electron.FakeCanvasView>
type FakeWindow = InstanceType<typeof electron.FakeStudioWindow>

const REQUEST = { requirementId: 'R-1', sessionId: 'S-1', html: '<html>after</html>', beforeHtml: '<html>before</html>' }

beforeEach(() => {
  electron.views.length = 0
  electron.windows.length = 0
  vi.clearAllMocks()
})

function viewAt(index: number): FakeView {
  const view = electron.views[index]
  if (view === undefined) throw new Error(`缺少视图 ${String(index)}`)
  return view
}

function onlyWindow(): FakeWindow {
  const window = electron.windows[0]
  if (window === undefined) throw new Error('没有创建 Studio 窗口')
  return window
}

describe('studioLayout', () => {
  it('split：左画布占可用宽度，右协作界面保底 340px，左对比画布不参与', () => {
    const rects = studioLayout('split', 1000, 800)
    expect(rects.after).toEqual({ x: 0, y: 0, width: 660, height: 800 })
    expect(rects.ui).toEqual({ x: 660, y: 0, width: 340, height: 800 })
    expect(rects.before).toBeUndefined()
    expect(rects.beforeVisible).toBe(false)
  })

  it('compare-side-by-side：左侧 68% 均分给 before/after，协作界面仍在右 32%', () => {
    const rects = studioLayout('compare-side-by-side', 1000, 800)
    expect(rects.before).toEqual({ x: 0, y: 0, width: 330, height: 800 })
    expect(rects.after).toEqual({ x: 330, y: 0, width: 330, height: 800 })
    expect(rects.ui).toEqual({ x: 660, y: 0, width: 340, height: 800 })
    expect(rects.beforeVisible).toBe(true)
  })

  it('fullscreen-pinned：画布铺满，协作界面按浮窗矩形置右上，折叠收缩为胶囊高度', () => {
    const rects = studioLayout('fullscreen-pinned', 1000, 800, DEFAULT_FLOATING_BOUNDS)
    expect(rects.after).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
    expect(rects.before).toBeUndefined()
    expect(rects.ui).toEqual({ x: 596, y: 24, width: 380, height: 520 })
    const collapsed = studioLayout('fullscreen-pinned', 1000, 800, { ...DEFAULT_FLOATING_BOUNDS, collapsed: true })
    expect(collapsed.ui.height).toBe(STUDIO_COLLAPSED_HEIGHT)
  })

  it('同一组入参重复计算与 resize 后重算都确定，不依赖调用次数', () => {
    const a = studioLayout('compare-side-by-side', 1200, 700)
    const b = studioLayout('compare-side-by-side', 1200, 700)
    expect(a).toEqual(b)
    expect(studioLayout('split', 800, 600).ui.width).toBe(340)
    expect(studioLayout('split', 800, 600).after.width).toBe(460)
  })
})

describe('createPrototypeStudioWindow', () => {
  it('after/before 画布用原型 preload 与离线分区，uiView 用主窗 preload', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    studio.setMode('compare-side-by-side')
    const [after, ui, before] = [viewAt(0), viewAt(1), viewAt(2)]
    for (const canvas of [after, before]) {
      expect(String(canvas.webPreferences.preload)).toMatch(/prototype-preview-preload\.cjs$/)
      expect(canvas.webPreferences.partition).toBe('lcoder-prototype-preview')
      expect(canvas.webPreferences.nodeIntegration).toBe(false)
      expect(canvas.webPreferences.contextIsolation).toBe(true)
      expect(canvas.webPreferences.sandbox).toBe(true)
    }
    expect(String(ui.webPreferences.preload)).toMatch(/preload\.cjs$/)
    expect(String(ui.webPreferences.preload)).not.toContain('prototype-preview-preload')
    expect(ui.webPreferences.partition).toBeUndefined()
  })

  it('离线拦截装在共享原型 session 上，外部网络取消、内联与 file 放行', () => {
    createPrototypeStudioWindow(REQUEST)
    const guard = electron.sharedPrototypeSession.webRequest.onBeforeRequest
    expect(guard).toHaveBeenCalledTimes(1)
    const cancelled = (url: string): boolean => {
      let result = false
      const listener = guard.mock.calls[0]?.[1] as (
        details: { readonly url: string }, callback: (response: { cancel: boolean }) => void,
      ) => void
      listener({ url }, (response) => { result = response.cancel })
      return result
    }
    for (const url of ['https://evil.test/x', 'http://x.test', 'ws://x.test']) expect(cancelled(url)).toBe(true)
    for (const url of ['data:text/html,x', 'file:///tmp/index.html', 'about:blank']) expect(cancelled(url)).toBe(false)
  })

  it('uiView 加载协作界面入口与 query，点选转发目标始终是同一个 webContents', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    const ui = viewAt(1)
    expect(ui.webContents.loadFile).toHaveBeenCalledTimes(1)
    const [file, options] = ui.webContents.loadFile.mock.calls[0] as [string, { query: Record<string, string> }]
    expect(file).toMatch(/index\.html$/)
    expect(options.query).toEqual({ view: 'prototype-studio', requirementId: 'R-1', sessionId: 'S-1' })
    const target = studio.uiWebContents()
    studio.setMode('fullscreen-pinned')
    studio.setMode('compare-side-by-side')
    expect(studio.uiWebContents()).toBe(target)
  })

  it('三模式切换只改矩形与可见性，不销毁协作界面视图', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    const [after, ui] = [viewAt(0), viewAt(1)]
    const uiIdentity = ui
    studio.setMode('compare-side-by-side')
    expect(electron.views).toHaveLength(3)
    const before = viewAt(2)
    expect(before.setVisible).toHaveBeenLastCalledWith(true)
    studio.setMode('fullscreen-pinned')
    expect(after.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1440, height: 900 })
    expect(before.setVisible).toHaveBeenLastCalledWith(false)
    studio.setMode('split')
    expect(before.setVisible).toHaveBeenLastCalledWith(false)
    expect(electron.views).toHaveLength(3)
    expect(viewAt(1)).toBe(uiIdentity)
    expect(uiIdentity.setBounds).toHaveBeenCalled()
  })

  it('resize 与浮窗位置更新都重新布局，协作界面视图保持同一实例', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    const ui = viewAt(1)
    studio.setMode('fullscreen-pinned')
    const window = onlyWindow()
    window.resizeTo(1000, 800)
    window.emit('resize')
    expect(ui.setBounds).toHaveBeenLastCalledWith({ x: 596, y: 24, width: 380, height: 520 })
    studio.setFloatingBounds({ x: 100, y: 200, width: 300, height: 240, collapsed: true })
    expect(ui.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 200, width: 300, height: STUDIO_COLLAPSED_HEIGHT })
    expect(viewAt(1)).toBe(ui)
  })

  it('下行检查器控制把交互模式与高亮路径送到两块画布', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    studio.setMode('compare-side-by-side')
    const [after, , before] = [viewAt(0), viewAt(1), viewAt(2)]
    studio.setInteraction('select')
    expect(after.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioInspectControl, { interactionMode: 'select' })
    expect(before.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioInspectControl, { interactionMode: 'select' })
    studio.highlightPaths(['body > div'])
    expect(after.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioInspectControl, { highlightDomPaths: ['body > div'] })
    expect(before.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioInspectControl, { highlightDomPaths: ['body > div'] })
  })

  it('dispose 移除全部子视图与 resize 监听，不再暴露点选目标', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    studio.setMode('compare-side-by-side')
    const window = onlyWindow()
    studio.dispose()
    expect(window.contentView.removeChildView).toHaveBeenCalledTimes(3)
    expect(studio.uiWebContents()).toBeUndefined()
    const callsBefore = viewAt(0).setBounds.mock.calls.length
    window.resizeTo(1000, 700)
    window.emit('resize')
    expect(viewAt(0).setBounds.mock.calls.length).toBe(callsBefore)
  })
})
