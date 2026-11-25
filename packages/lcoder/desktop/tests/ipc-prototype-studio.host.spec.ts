/** 原型工作台 IPC：入参校验、下行控制转发，以及点选同时送主窗与协作界面。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'
import type { PrototypeSelectionInfo } from '../src/contract.ts'

const electron = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
  getPath: vi.fn(() => ''),
  nativeTheme: { themeSource: 'dark' },
}))
const studio = vi.hoisted(() => {
  const listeners = new Map<string, Array<(arg?: unknown) => void>>()
  const window = {
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: (arg?: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }),
    on: vi.fn((event: string, listener: (arg?: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
  }
  const uiState = { destroyed: false }
  const uiWebContents = { isDestroyed: () => uiState.destroyed, send: vi.fn() }
  const controller = {
    window,
    setMode: vi.fn(),
    setInteraction: vi.fn(),
    loadHtml: vi.fn(),
    highlightPaths: vi.fn(),
    setFloatingBounds: vi.fn(),
    nudgeCompareRatio: vi.fn(),
    floatingRect: vi.fn(() => ({ x: 1, y: 2, width: 300, height: 240 })),
    uiWebContents: () => uiWebContents,
    dispose: vi.fn(),
  }
  /** 触发窗口事件；返回该事件收到的参数，用来断言 preventDefault。 */
  const emit = (event: string, arg?: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(arg)
  }
  const reset = (): void => { listeners.clear() }
  return { create: vi.fn(() => controller), controller, window, uiWebContents, uiState, emit, reset }
})
vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle, on: electron.on },
  dialog: { showOpenDialog: vi.fn() },
  app: { getPath: electron.getPath },
  nativeTheme: electron.nativeTheme,
}))
vi.mock('../src/window.ts', () => ({
  createPrototypePreviewWindow: vi.fn(),
  createPrototypeStudioWindow: studio.create,
  MAX_PROTOTYPE_PREVIEW_BYTES: 512 * 1024,
  prototypePreviewDataUrl: (html: string) => `data:${html}`,
}))

const { registerIpc } = await import('../src/ipc.ts')
const { STUDIO_BROADCAST_CHANNELS } = await import('../src/ipc.ts')
type StudioUiReader = ReturnType<typeof registerIpc>

/** 最近一次注册返回的协作界面读取器；主进程用它决定广播目标。 */
let reader: StudioUiReader | undefined

function makeWindow(): { readonly window: BrowserWindow; readonly once: ReturnType<typeof vi.fn> } {
  const once = vi.fn()
  const window = {} as BrowserWindow
  Object.defineProperty(window, 'webContents', { value: { send: electron.send } })
  Object.defineProperty(window, 'isDestroyed', { value: () => false })
  Object.defineProperty(window, 'once', { value: once })
  return { window, once }
}

const MAIN = makeWindow()
const WINDOW = MAIN.window
type Handler = (event: unknown, value?: unknown) => unknown

function install(): (channel: string) => Handler {
  reader = registerIpc({
    link: () => undefined,
    appInfo: () => ({ version: '0.0.0' }),
    window: () => WINDOW,
    hostState: () => ({ kind: 'starting' }),
    windowState: () => ({ maximized: false, fullscreen: false }),
    update: () => ({ kind: 'unavailable', version: '0.0.0', reason: 'no-feed' }),
    confirmClose: vi.fn(),
    applyLocale: vi.fn(),
    locale: () => 'zh' as const,
  })
  return (channel: string): Handler => {
    const entry = electron.handle.mock.calls.find(call => call[0] === channel)
    if (entry === undefined) throw new Error(`没有注册通道 ${channel}`)
    return entry[1] as Handler
  }
}

const VALID = { requirementId: 'R-1', html: '<html>after</html>', beforeHtml: '<html>before</html>' }

beforeEach(() => {
  vi.clearAllMocks()
  studio.uiState.destroyed = false
  studio.reset()
})

describe('lcoder:prototype-studio-open', () => {
  it('合法请求创建工作台，并用主窗关闭联动代替父子窗', () => {
    const open = install()(IPC_CHANNELS.prototypeStudioOpen)
    open({}, VALID)
    expect(studio.create).toHaveBeenCalledExactlyOnceWith(VALID)
    expect(MAIN.once).toHaveBeenCalledWith('closed', expect.any(Function))
    // 建窗即推送一次停靠状态：主窗据此知道工作台已经打开（未最小化不显示胶囊）。
    expect(electron.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioDockState, {
      open: true, minimized: false, requirementId: 'R-1',
    })
  })

  it('空 HTML、超限 HTML、缺需求标识与非法模式都拒绝', () => {
    const open = install()(IPC_CHANNELS.prototypeStudioOpen)
    expect(() => open({}, { ...VALID, html: '' })).toThrow(/参数/)
    expect(() => open({}, { ...VALID, html: 'x'.repeat(512 * 1024 + 1) })).toThrow(/参数/)
    expect(() => open({}, { ...VALID, requirementId: '' })).toThrow(/参数/)
    expect(() => open({}, { ...VALID, mode: 'unknown' })).toThrow(/参数/)
    expect(studio.create).not.toHaveBeenCalled()
  })

  it('再次打开复用同一工作台，只重载 HTML 与切换模式', () => {
    const open = install()(IPC_CHANNELS.prototypeStudioOpen)
    open({}, VALID)
    open({}, { ...VALID, html: '<html>new</html>', mode: 'fullscreen-pinned' })
    expect(studio.create).toHaveBeenCalledTimes(1)
    expect(studio.controller.loadHtml).toHaveBeenCalledTimes(1)
    expect(studio.controller.setMode).toHaveBeenCalledExactlyOnceWith('fullscreen-pinned')
    // 最小化进主窗后再打开＝恢复：窗口唤醒并把停靠状态改回未最小化。
    expect(studio.window.show).toHaveBeenCalledTimes(1)
    expect(studio.window.focus).toHaveBeenCalledTimes(1)
    expect(electron.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioDockState, {
      open: true, minimized: false, requirementId: 'R-1',
    })
  })
})

describe('工作台最小化停靠', () => {
  it('最小化改成隐藏窗口，并把 minimized:true 的停靠状态推给主窗', () => {
    const open = install()(IPC_CHANNELS.prototypeStudioOpen)
    open({}, VALID)
    const preventDefault = vi.fn()
    studio.emit('minimize', { preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(studio.window.hide).toHaveBeenCalledTimes(1)
    expect(electron.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioDockState, {
      open: true, minimized: true, requirementId: 'R-1',
    })
  })

  it('主窗 restore 唤醒窗口，close 直接关窗，非法动作拒绝', () => {
    const get = install()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    get(IPC_CHANNELS.prototypeStudioRestore)({}, 'restore')
    expect(studio.window.show).toHaveBeenCalledTimes(1)
    expect(studio.window.focus).toHaveBeenCalledTimes(1)
    expect(electron.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioDockState, {
      open: true, minimized: false, requirementId: 'R-1',
    })
    get(IPC_CHANNELS.prototypeStudioRestore)({}, 'close')
    expect(studio.window.close).toHaveBeenCalledTimes(1)
    expect(() => get(IPC_CHANNELS.prototypeStudioRestore)({}, 'expand')).toThrow(/停靠/)
  })

  it('工作台关窗时清空停靠状态并释放视图；没有工作台时 restore 只同步状态', () => {
    const get = install()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    studio.emit('closed')
    expect(studio.controller.dispose).toHaveBeenCalledTimes(1)
    expect(electron.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioDockState, {
      open: false, minimized: false,
    })
    get(IPC_CHANNELS.prototypeStudioRestore)({}, 'restore')
    expect(studio.window.show).toHaveBeenCalledTimes(0)
  })

  it('主窗重载后补发当前停靠状态', () => {
    install()
    reader?.replayStudioDock()
    expect(electron.send).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioDockState, {
      open: false, minimized: false,
    })
  })
})

describe('工作台下行控制', () => {
  it('模式、交互与浮窗位置校验后转发给当前工作台', () => {
    const get = install()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    get(IPC_CHANNELS.prototypeStudioSetMode)({}, 'compare-side-by-side')
    get(IPC_CHANNELS.prototypeStudioSetInteraction)({}, 'select')
    const applied = get(IPC_CHANNELS.prototypeStudioSetFloatingBounds)({}, { x: 1, y: 2, width: 300, height: 240, collapsed: true })
    expect(studio.controller.setMode).toHaveBeenCalledWith('compare-side-by-side')
    expect(studio.controller.setInteraction).toHaveBeenCalledWith('select')
    expect(studio.controller.setFloatingBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 300, height: 240, collapsed: true })
    // 回执带上宿主解析后的矩形：渲染端不知道视图在窗口里的位置，靠它定位拖拽起点。
    expect(applied).toEqual({ x: 1, y: 2, width: 300, height: 240 })
    expect(() => get(IPC_CHANNELS.prototypeStudioSetMode)({}, 'bad')).toThrow(/模式/)
    expect(() => get(IPC_CHANNELS.prototypeStudioSetInteraction)({}, 'bad')).toThrow(/模式/)
    expect(() => get(IPC_CHANNELS.prototypeStudioSetFloatingBounds)({}, { x: 'bad' })).toThrow(/浮窗/)
  })

  it('HTML 重载与高亮路径校验后转发，空高亮数组也放行', () => {
    const get = install()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    const load = get(IPC_CHANNELS.prototypeStudioLoadHtml)
    const highlight = get(IPC_CHANNELS.prototypeStudioHighlightPaths)
    load({}, { html: '<html>x</html>', beforeHtml: '<html>y</html>', highlightDomPaths: ['body > div'] })
    highlight({}, [])
    expect(studio.controller.loadHtml).toHaveBeenCalledWith({
      html: '<html>x</html>', beforeHtml: '<html>y</html>', highlightDomPaths: ['body > div'],
    })
    expect(studio.controller.highlightPaths).toHaveBeenCalledWith([])
    expect(() => load({}, { html: '' })).toThrow(/HTML/)
    expect(() => highlight({}, 'body > div')).toThrow(/高亮/)
    expect(() => highlight({}, [1])).toThrow(/高亮/)
  })
})

describe('工作台点选转发', () => {
  const info: PrototypeSelectionInfo = {
    domPath: 'body > button', html: '<button>hi</button>', css: 'color: red', label: 'Go',
  }

  it('同时送主窗与协作界面，label 保留并截断到 80 字符', () => {
    const get = install()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    electron.send.mockClear()
    get(IPC_CHANNELS.prototypeSelectionReport)({}, { ...info, label: 'x'.repeat(120) })
    const expected = { ...info, label: 'x'.repeat(80) }
    expect(electron.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.prototypeSelection, expected)
    expect(studio.uiWebContents.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.prototypeSelection, expected)
  })

  it('label 缺失或空白时不写该字段，其余字段照常截断', () => {
    const report = install()(IPC_CHANNELS.prototypeSelectionReport)
    report({}, { domPath: 'p'.repeat(2100), html: 'h'.repeat(9000), css: 'c'.repeat(5000), label: '   ' })
    const forwarded = electron.send.mock.calls[0]?.[1] as PrototypeSelectionInfo
    expect(forwarded.domPath).toHaveLength(2000)
    expect(forwarded.html).toHaveLength(8000)
    expect(forwarded.css).toHaveLength(4000)
    expect(Object.hasOwn(forwarded, 'label')).toBe(false)
  })

  it('协作界面销毁后只送主窗，不因工作台残留引用报错', () => {
    const get = install()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    electron.send.mockClear()
    studio.uiState.destroyed = true
    expect(() => get(IPC_CHANNELS.prototypeSelectionReport)({}, info)).not.toThrow()
    expect(electron.send).toHaveBeenCalledTimes(1)
    expect(studio.uiWebContents.send).not.toHaveBeenCalled()
  })
})

describe('工作台广播目标', () => {
  it('协作界面读取器只在工作台打开且未销毁时返回 webContents', () => {
    const get = install()
    expect(reader?.studioUiWebContents()).toBeUndefined()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    expect(reader?.studioUiWebContents()).toBe(studio.uiWebContents)
    studio.uiState.destroyed = true
    expect(reader?.studioUiWebContents()).toBeUndefined()
  })

  it('事件、流帧、提问撤回与宿主状态都广播给协作界面，窗口类通道不广播', () => {
    for (const channel of [
      IPC_CHANNELS.events,
      IPC_CHANNELS.waterfall,
      IPC_CHANNELS.waterfallCancel,
      IPC_CHANNELS.streamFrame,
      IPC_CHANNELS.hostState,
    ]) {
      expect(STUDIO_BROADCAST_CHANNELS.has(channel)).toBe(true)
    }
    for (const channel of [
      IPC_CHANNELS.window,
      IPC_CHANNELS.closeRequest,
      IPC_CHANNELS.prototypeStudioSetMode,
      IPC_CHANNELS.prototypeSelection,
    ]) {
      expect(STUDIO_BROADCAST_CHANNELS.has(channel)).toBe(false)
    }
  })
})

describe('对比模式、中缝调宽与主题同步', () => {
  it('compare-fullscreen-pinned 模式放行，compare-resize 校验 deltaX 后转发给工作台', () => {
    const get = install()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    get(IPC_CHANNELS.prototypeStudioSetMode)({}, 'compare-fullscreen-pinned')
    expect(studio.controller.setMode).toHaveBeenCalledWith('compare-fullscreen-pinned')

    const onEntry = electron.on.mock.calls.find(call => call[0] === IPC_CHANNELS.prototypeStudioCompareResize)
    if (onEntry === undefined) throw new Error('没有注册 prototypeStudioCompareResize')
    const resizeListener = onEntry[1] as Handler
    resizeListener({}, { deltaX: 24 })
    expect(studio.controller.nudgeCompareRatio).toHaveBeenCalledExactlyOnceWith(24)

    studio.controller.nudgeCompareRatio.mockClear()
    resizeListener({}, { deltaX: Number.NaN })
    resizeListener({}, { deltaX: '24' })
    resizeListener({}, null)
    expect(studio.controller.nudgeCompareRatio).not.toHaveBeenCalled()
  })

  it('preferencesWrite 同步 nativeTheme.themeSource', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lcoder-theme-'))
    electron.getPath.mockReturnValue(dir)
    try {
      const write = install()(IPC_CHANNELS.preferencesWrite)
      write({}, { skin: 'light' })
      expect(electron.nativeTheme.themeSource).toBe('light')
      write({}, { skin: 'dark' })
      expect(electron.nativeTheme.themeSource).toBe('dark')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
