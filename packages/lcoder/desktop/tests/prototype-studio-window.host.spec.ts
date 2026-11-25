/** Prototype Studio：三模式几何确定、resize 更新、协作界面不被销毁、画布离线隔离。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'

type Mock = ReturnType<typeof vi.fn>

interface FakeWebContents {
  readonly send: Mock
  readonly loadURL: Mock
  readonly loadFile: Mock
  readonly on: Mock
  readonly setZoomFactor: Mock
  readonly session: { readonly webRequest: { readonly onBeforeRequest: Mock } }
  isDestroyed(): boolean
  emit(event: string): void
}

interface ViewOptions { readonly webPreferences: Readonly<Record<string, unknown>> }
interface WindowOptions { readonly title?: string; readonly icon?: string; readonly backgroundColor?: string }

const electron = vi.hoisted(() => {
  const views: FakeCanvasView[] = []
  const windows: FakeStudioWindow[] = []
  const sharedPrototypeSession = { webRequest: { onBeforeRequest: vi.fn() } }
  const themeListeners = new Map<string, Array<() => void>>()
  const nativeTheme = {
    shouldUseDarkColors: false,
    on: vi.fn((event: string, listener: () => void) => {
      themeListeners.set(event, [...(themeListeners.get(event) ?? []), listener])
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      themeListeners.set(event, (themeListeners.get(event) ?? []).filter(item => item !== listener))
    }),
    emit: (event: string) => {
      for (const listener of themeListeners.get(event) ?? []) listener()
    },
  }
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
      const listeners = new Map<string, Array<() => void>>()
      this.webContents = {
        send: vi.fn(),
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        setZoomFactor: vi.fn(),
        on: vi.fn((event: string, listener: () => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener])
        }),
        emit: (event: string) => { for (const listener of listeners.get(event) ?? []) listener() },
        session,
        isDestroyed: () => false,
      }
      views.push(this)
    }
  }
  class FakeStudioWindow {
    readonly options: WindowOptions
    private destroyed = false
    readonly contentView = {
      addChildView: vi.fn(),
      removeChildView: vi.fn(() => {
        if (this.destroyed) throw new TypeError('Object has been destroyed')
      }),
    }
    readonly webContents = { send: vi.fn() }
    readonly setMenu = vi.fn()
    readonly setMenuBarVisibility = vi.fn()
    readonly setParentWindow = vi.fn()
    readonly setBackgroundColor = vi.fn()
    readonly show = vi.fn()
    readonly listeners = new Map<string, Array<() => void>>()
    private size: [number, number] = [1440, 900]
    private contentSize: [number, number] = [1440, 900]
    constructor(options: WindowOptions) { this.options = options; windows.push(this) }
    on(event: string, listener: () => void): void {
      const list = this.listeners.get(event) ?? []
      list.push(listener)
      this.listeners.set(event, list)
    }
    once(event: string, listener: () => void): void { this.on(event, listener) }
    removeListener(event: string, listener: () => void): void {
      if (this.destroyed) throw new TypeError('Object has been destroyed')
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter(item => item !== listener))
    }
    emit(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener() }
    resizeTo(width: number, height: number): void { this.size = [width, height]; this.contentSize = [width, height] }
    /** 边框与内容区不同的窗口：getSize 比真实客户区大，布局取错了尺寸就会算错。 */
    resizeFrameTo(frame: [number, number], content: [number, number]): void {
      this.size = frame
      this.contentSize = content
    }
    getSize(): [number, number] { return this.size }
    getContentSize(): [number, number] { return this.contentSize }
    destroy(): void { this.destroyed = true }
    isDestroyed(): boolean { return this.destroyed }
  }
  return {
    views, windows, sharedPrototypeSession, nativeTheme, themeListeners, FakeCanvasView, FakeStudioWindow,
    app: { isPackaged: false },
  }
})
vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.FakeStudioWindow,
  WebContentsView: electron.FakeCanvasView,
  nativeTheme: electron.nativeTheme,
}))

const {
  createPrototypeStudioWindow, studioLayout, DEFAULT_FLOATING_BOUNDS, STUDIO_COLLAPSED_HEIGHT, STUDIO_COMPARE_GAP,
} = await import('../src/window.ts')

type FakeView = InstanceType<typeof electron.FakeCanvasView>
type FakeWindow = InstanceType<typeof electron.FakeStudioWindow>

const REQUEST = { requirementId: 'R-1', sessionId: 'S-1', html: '<html>after</html>', beforeHtml: '<html>before</html>' }

beforeEach(() => {
  electron.views.length = 0
  electron.windows.length = 0
  electron.themeListeners.clear()
  electron.nativeTheme.shouldUseDarkColors = false
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

  it('compare-side-by-side：左侧 68% 扣除分隔缝后按比例分给 before/after，协作界面仍在右 32%', () => {
    const rects = studioLayout('compare-side-by-side', 1000, 800)
    expect(STUDIO_COMPARE_GAP).toBe(4)
    expect(rects.before).toEqual({ x: 0, y: 0, width: 328, height: 800 })
    expect(rects.after).toEqual({ x: 332, y: 0, width: 328, height: 800 })
    expect(rects.ui).toEqual({ x: 660, y: 0, width: 340, height: 800 })
    expect(rects.beforeVisible).toBe(true)
  })

  it('compare-fullscreen-pinned：整窗扣除分隔缝后按比例分给 before/after，浮窗置顶且比例钳位在 0.25..0.75', () => {
    const rects = studioLayout('compare-fullscreen-pinned', 1004, 800, DEFAULT_FLOATING_BOUNDS, 0.5)
    expect(rects.before).toEqual({ x: 0, y: 0, width: 500, height: 800 })
    expect(rects.after).toEqual({ x: 504, y: 0, width: 500, height: 800 })
    expect(rects.beforeVisible).toBe(true)
    expect(rects.ui).toEqual({ x: 600, y: 24, width: 380, height: 520 })

    const clampedMin = studioLayout('compare-fullscreen-pinned', 1004, 800, DEFAULT_FLOATING_BOUNDS, 0.1)
    expect(clampedMin.before?.width).toBe(250)
    expect(clampedMin.after.width).toBe(750)

    const clampedMax = studioLayout('compare-fullscreen-pinned', 1004, 800, DEFAULT_FLOATING_BOUNDS, 0.9)
    expect(clampedMax.before?.width).toBe(750)
    expect(clampedMax.after.width).toBe(250)
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
  it('窗口标题中文化并带需求编号', () => {
    createPrototypeStudioWindow(REQUEST)
    expect(onlyWindow().options.title).toBe('原型工作室 · R-1')
  })

  it('窗口不装原生菜单栏，Alt 点选不会先弹菜单', () => {
    createPrototypeStudioWindow(REQUEST)
    const window = onlyWindow()
    expect(window.setMenu).toHaveBeenCalledWith(null)
    expect(window.setMenuBarVisibility).toHaveBeenCalledWith(false)
  })

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

  it('布局按真实客户区计算，不用含不可见缩放边的窗口尺寸', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    const window = onlyWindow()
    window.resizeFrameTo([1460, 920], [1440, 900])
    studio.setMode('split')
    window.emit('resize')
    // split：左画布占 68%（1440 - 461），其余给右侧协作界面，全部按 1440×900 客户区算。
    expect(viewAt(0).setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 979, height: 900 })
    expect(viewAt(1).setBounds).toHaveBeenLastCalledWith({ x: 979, y: 0, width: 461, height: 900 })
    studio.setMode('fullscreen-pinned')
    expect(viewAt(0).setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1440, height: 900 })
  })

  it('浮窗矩形回执给出解析后的坐标，供渲染端定位拖拽起点', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    expect(studio.floatingRect()).toBeUndefined()
    studio.setMode('fullscreen-pinned')
    expect(studio.floatingRect()).toEqual({ x: 1036, y: 24, width: 380, height: 520 })
    studio.setFloatingBounds({ x: 100, y: 200, width: 300, height: 240, collapsed: true })
    expect(studio.floatingRect()).toEqual({ x: 100, y: 200, width: 300, height: STUDIO_COLLAPSED_HEIGHT })
    studio.setMode('split')
    expect(studio.floatingRect()).toBeUndefined()
    studio.setMode('fullscreen-pinned')
    studio.dispose()
    expect(studio.floatingRect()).toBeUndefined()
  })

  it('工作台窗口使用应用图标，标题栏不再回退成 Electron 默认图标', () => {
    createPrototypeStudioWindow(REQUEST)
    expect(String(onlyWindow().options.icon)).toMatch(/maniu-windows\.ico$/)
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

  it('画布 did-finish-load 补发当前交互模式，重载后提示条也跟着收起', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    const after = viewAt(0)
    after.webContents.send.mockClear()
    after.webContents.emit('did-finish-load')
    expect(after.webContents.send).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.prototypeStudioInspectControl, { interactionMode: 'interact' },
    )

    studio.setInteraction('select')
    after.webContents.send.mockClear()
    after.webContents.emit('did-finish-load')
    expect(after.webContents.send).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.prototypeStudioInspectControl, { interactionMode: 'select' },
    )
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

  it('窗口已销毁后再调 dispose 不抛 Object has been destroyed', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    studio.setMode('fullscreen-pinned')
    const window = onlyWindow()
    window.destroy()
    expect(() => { studio.dispose() }).not.toThrow()
    expect(studio.uiWebContents()).toBeUndefined()
    expect(studio.floatingRect()).toBeUndefined()
  })

  it('并排对比启用自动 PC 视口缩放、下发版本角标并在退出时恢复，did-finish-load 补发缩放与角标', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    const [after, ui] = [viewAt(0), viewAt(1)]
    expect(after.webContents.setZoomFactor).toHaveBeenLastCalledWith(1)

    studio.setMode('compare-fullscreen-pinned')
    const before = viewAt(2)
    // 1440 - 4 = 1436，每侧 718px，718 / 1120 ≈ 0.64107
    const expectedZoom = 718 / 1120
    expect(after.webContents.setZoomFactor).toHaveBeenLastCalledWith(expectedZoom)
    expect(before.webContents.setZoomFactor).toHaveBeenLastCalledWith(expectedZoom)
    expect(after.webContents.send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.prototypeStudioInspectControl,
      { compareBadge: '修改后 · 待确认', resizeEdge: 'left' },
    )
    expect(before.webContents.send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.prototypeStudioInspectControl,
      { compareBadge: '修改前 · 正式版', resizeEdge: 'right' },
    )
    // ensureBeforeView 会把 uiView 重新置顶，确保悬浮浮窗不被 beforeView 遮挡。
    const addCalls = onlyWindow().contentView.addChildView.mock.calls
    expect(addCalls.at(-1)?.[0]).toBe(ui)
    expect(studio.floatingRect()).toEqual({ x: 1036, y: 24, width: 380, height: 520 })

    before.webContents.send.mockClear()
    before.webContents.setZoomFactor.mockClear()
    before.webContents.emit('did-finish-load')
    expect(before.webContents.setZoomFactor).toHaveBeenCalledWith(expectedZoom)
    expect(before.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.prototypeStudioInspectControl,
      { compareBadge: '修改前 · 正式版', resizeEdge: 'right' },
    )

    studio.setMode('split')
    expect(after.webContents.setZoomFactor).toHaveBeenLastCalledWith(1)
    expect(before.webContents.setZoomFactor).toHaveBeenLastCalledWith(1)
    expect(after.webContents.send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.prototypeStudioInspectControl,
      { compareBadge: '' },
    )
  })

  it('nudgeCompareRatio 按像素增量调整并排比例并钳位在 [0.25, 0.75]', () => {
    const studio = createPrototypeStudioWindow(REQUEST)
    studio.setMode('compare-fullscreen-pinned')
    const [after, , before] = [viewAt(0), viewAt(1), viewAt(2)]
    studio.nudgeCompareRatio(1436)
    expect(before.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1077, height: 900 })
    expect(after.setBounds).toHaveBeenLastCalledWith({ x: 1081, y: 0, width: 359, height: 900 })
    studio.nudgeCompareRatio(-3000)
    expect(before.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 359, height: 900 })
    expect(after.setBounds).toHaveBeenLastCalledWith({ x: 363, y: 0, width: 1077, height: 900 })
  })

  it('窗口背景色随 nativeTheme 切换并在 closed 时移除监听', () => {
    electron.nativeTheme.shouldUseDarkColors = true
    createPrototypeStudioWindow(REQUEST)
    const window = onlyWindow()
    expect(window.options.backgroundColor).toBe('#111111')

    electron.nativeTheme.shouldUseDarkColors = false
    electron.nativeTheme.emit('updated')
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith('#f3f6fc')

    window.emit('closed')
    electron.nativeTheme.shouldUseDarkColors = true
    electron.nativeTheme.emit('updated')
    expect(window.setBackgroundColor).toHaveBeenCalledTimes(1)
  })
})
