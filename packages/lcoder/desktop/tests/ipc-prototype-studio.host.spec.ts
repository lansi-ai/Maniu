/** 原型工作台 IPC：入参校验、下行控制转发，以及点选同时送主窗与协作界面。 */
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'
import type { PrototypeSelectionInfo } from '../src/contract.ts'

const electron = vi.hoisted(() => ({ handle: vi.fn(), send: vi.fn(), getPath: vi.fn(() => '') }))
const studio = vi.hoisted(() => {
  const window = { isDestroyed: vi.fn(() => false), setParentWindow: vi.fn(), once: vi.fn() }
  const uiState = { destroyed: false }
  const uiWebContents = { isDestroyed: () => uiState.destroyed, send: vi.fn() }
  const controller = {
    window,
    setMode: vi.fn(),
    setInteraction: vi.fn(),
    loadHtml: vi.fn(),
    highlightPaths: vi.fn(),
    setFloatingBounds: vi.fn(),
    uiWebContents: () => uiWebContents,
    dispose: vi.fn(),
  }
  return { create: vi.fn(() => controller), controller, window, uiWebContents, uiState }
})
vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle },
  dialog: { showOpenDialog: vi.fn() },
  app: { getPath: electron.getPath },
}))
vi.mock('../src/window.ts', () => ({
  createPrototypePreviewWindow: vi.fn(),
  createPrototypeStudioWindow: studio.create,
  MAX_PROTOTYPE_PREVIEW_BYTES: 512 * 1024,
  prototypePreviewDataUrl: (html: string) => `data:${html}`,
}))

const { registerIpc } = await import('../src/ipc.ts')

function makeWindow(): BrowserWindow {
  const window = {} as BrowserWindow
  Object.defineProperty(window, 'webContents', { value: { send: electron.send } })
  Object.defineProperty(window, 'isDestroyed', { value: () => false })
  return window
}

const WINDOW = makeWindow()
type Handler = (event: unknown, value?: unknown) => unknown

function install(): (channel: string) => Handler {
  registerIpc({
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
})

describe('lcoder:prototype-studio-open', () => {
  it('合法请求创建工作台并设为主窗子窗', () => {
    const open = install()(IPC_CHANNELS.prototypeStudioOpen)
    open({}, VALID)
    expect(studio.create).toHaveBeenCalledExactlyOnceWith(VALID)
    expect(studio.window.setParentWindow).toHaveBeenCalledExactlyOnceWith(WINDOW)
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
  })
})

describe('工作台下行控制', () => {
  it('模式、交互与浮窗位置校验后转发给当前工作台', () => {
    const get = install()
    get(IPC_CHANNELS.prototypeStudioOpen)({}, VALID)
    get(IPC_CHANNELS.prototypeStudioSetMode)({}, 'compare-side-by-side')
    get(IPC_CHANNELS.prototypeStudioSetInteraction)({}, 'select')
    get(IPC_CHANNELS.prototypeStudioSetFloatingBounds)({}, { x: 1, y: 2, width: 300, height: 240, collapsed: true })
    expect(studio.controller.setMode).toHaveBeenCalledWith('compare-side-by-side')
    expect(studio.controller.setInteraction).toHaveBeenCalledWith('select')
    expect(studio.controller.setFloatingBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 300, height: 240, collapsed: true })
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
    studio.uiState.destroyed = true
    expect(() => get(IPC_CHANNELS.prototypeSelectionReport)({}, info)).not.toThrow()
    expect(electron.send).toHaveBeenCalledTimes(1)
    expect(studio.uiWebContents.send).not.toHaveBeenCalled()
  })
})
