/** 原型预览 IPC：打开预览的入参校验，以及元素上报只转发给主窗渲染端。 */
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'
import type { PrototypeSelectionInfo } from '../src/contract.ts'

const electron = vi.hoisted(() => ({ handle: vi.fn(), send: vi.fn(), getPath: vi.fn(() => '') }))
const preview = vi.hoisted(() => {
  const setParentWindow = vi.fn()
  const loadURL = vi.fn()
  const isDestroyed = vi.fn(() => false)
  const once = vi.fn()
  return {
    create: vi.fn(() => ({ setParentWindow, loadURL, isDestroyed, once })),
    setParentWindow, loadURL, isDestroyed, once,
  }
})
vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle },
  dialog: { showOpenDialog: vi.fn() },
  app: { getPath: electron.getPath },
}))
vi.mock('../src/window.ts', () => ({
  createPrototypePreviewWindow: preview.create,
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

function install(options: { readonly window?: BrowserWindow | undefined } = {}): (channel: string) => Handler {
  const window = Object.hasOwn(options, 'window') ? options.window : WINDOW
  registerIpc({
    link: () => undefined,
    appInfo: () => ({ version: '0.0.0' }),
    window: () => window,
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

beforeEach(() => { vi.clearAllMocks() })

describe('lcoder:prototype-preview-open', () => {
  it('空 HTML 与超过上限的 HTML 都拒绝，不创建窗口', () => {
    const open = install()(IPC_CHANNELS.prototypePreviewOpen)
    expect(() => open({}, '')).toThrow(/HTML/)
    expect(() => open({}, 'x'.repeat(512 * 1024 + 1))).toThrow(/上限/)
    expect(preview.create).not.toHaveBeenCalled()
  })

  it('合法 HTML 创建独立预览并设为主窗子窗', () => {
    const open = install()(IPC_CHANNELS.prototypePreviewOpen)
    open({}, '<html><body>原型</body></html>')
    expect(preview.create).toHaveBeenCalledExactlyOnceWith('<html><body>原型</body></html>')
    expect(preview.setParentWindow).toHaveBeenCalledExactlyOnceWith(WINDOW)
  })

  it('再次打开复用原窗口重载 HTML，元素级修改后不堆积新窗口', () => {
    const open = install()(IPC_CHANNELS.prototypePreviewOpen)
    open({}, '<html>one</html>')
    open({}, '<html>two</html>')
    expect(preview.create).toHaveBeenCalledTimes(1)
    expect(preview.loadURL).toHaveBeenCalledExactlyOnceWith('data:<html>two</html>')
  })
})

describe('lcoder:prototype-selection-report', () => {
  const info: PrototypeSelectionInfo = { domPath: 'body:nth-child(2) > button', html: '<button>hi</button>', css: 'color: red' }

  it('把元素信息转发给主窗渲染端，不回传给预览窗口', () => {
    const report = install()(IPC_CHANNELS.prototypeSelectionReport)
    report({}, info)
    expect(electron.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.prototypeSelection, info)
  })

  it('非法载荷抛错且不转发', () => {
    const report = install()(IPC_CHANNELS.prototypeSelectionReport)
    expect(() => report({}, { domPath: '', html: 'x', css: 'y' })).toThrow(/不合法/)
    expect(() => report({}, { domPath: 'x', html: 1, css: 'y' })).toThrow(/不合法/)
    expect(electron.send).not.toHaveBeenCalled()
  })

  it('主窗不存在时静默丢弃上报，不让预览窗口报错', () => {
    const report = install({ window: undefined })(IPC_CHANNELS.prototypeSelectionReport)
    expect(() => report({}, info)).not.toThrow()
    expect(electron.send).not.toHaveBeenCalled()
  })
})
