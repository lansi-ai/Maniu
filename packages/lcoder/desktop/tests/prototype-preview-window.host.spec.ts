/** 独立预览窗口：无业务 preload、隔离与沙箱、独立 session、离线拦截。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeOptions {
  readonly title?: string
  readonly icon?: string
  readonly webPreferences?: Readonly<Record<string, unknown>>
}

interface FakeWindow {
  readonly options: FakeOptions
  readonly webContents: {
    readonly session: { readonly webRequest: { readonly onBeforeRequest: ReturnType<typeof vi.fn> } }
  }
  readonly loadURL: ReturnType<typeof vi.fn>
  readonly setParentWindow: ReturnType<typeof vi.fn>
}

const electron = vi.hoisted(() => {
  const instances: FakeWindow[] = []
  class FakeBrowserWindow implements FakeWindow {
    readonly options: FakeOptions
    readonly webContents: FakeWindow['webContents']
    readonly loadURL = vi.fn()
    readonly setParentWindow = vi.fn()
    constructor(options: FakeOptions) {
      this.options = options
      this.webContents = { session: { webRequest: { onBeforeRequest: vi.fn() } } }
      instances.push(this)
    }
  }
  return { instances, BrowserWindow: FakeBrowserWindow, app: { isPackaged: false } }
})
vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.BrowserWindow }))

const { createPrototypePreviewWindow, isAllowedPrototypePreviewUrl, PROTOTYPE_PREVIEW_TITLE } = await import('../src/window.ts')

beforeEach(() => { electron.instances.length = 0 })

function created(): FakeWindow {
  const window = electron.instances[0]
  if (window === undefined) throw new Error('没有创建预览窗口')
  return window
}

describe('isAllowedPrototypePreviewUrl', () => {
  it('只放行 data、file 与 about，外部网络地址一律拒绝', () => {
    expect(isAllowedPrototypePreviewUrl('data:text/html;charset=utf-8,%3Chtml%3E')).toBe(true)
    expect(isAllowedPrototypePreviewUrl('file:///tmp/index.html')).toBe(true)
    expect(isAllowedPrototypePreviewUrl('about:blank')).toBe(true)
    for (const url of ['https://evil.test/x', 'http://x.test', 'ws://x.test', 'wss://x.test', 'ftp://x.test']) {
      expect(isAllowedPrototypePreviewUrl(url)).toBe(false)
    }
  })
})

describe('createPrototypePreviewWindow', () => {
  it('关闭 Node 与业务 IPC，使用独立 partition 和专用 preload', () => {
    createPrototypePreviewWindow('<html></html>')
    const window = created()
    const prefs = window.options.webPreferences ?? {}
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.sandbox).toBe(true)
    expect(typeof prefs.partition).toBe('string')
    expect(String(prefs.preload)).toMatch(/prototype-preview-preload\.cjs$/)
    expect(window.options.title).toBe(PROTOTYPE_PREVIEW_TITLE)
    expect(window.options.title).toContain('沙箱')
    // 独立预览窗也要应用图标，标题栏不回退成 Electron 默认图标。
    expect(String(window.options.icon)).toMatch(/maniu-windows\.ico$/)
  })

  it('对独立 session 安装离线拦截：外链取消，内联与 file 放行', () => {
    createPrototypePreviewWindow('<html></html>')
    const guard = created().webContents.session.webRequest.onBeforeRequest
    expect(guard).toHaveBeenCalledTimes(1)
    const [filter, listener] = guard.mock.calls[0] as [
      { readonly urls: readonly string[] },
      (details: { readonly url: string }, callback: (response: { cancel: boolean }) => void) => void,
    ]
    expect(filter.urls).toContain('<all_urls>')
    const cancelled = (url: string): boolean => {
      let result = false
      listener({ url }, (response) => { result = response.cancel })
      return result
    }
    expect(cancelled('https://evil.test/x')).toBe(true)
    expect(cancelled('http://x.test')).toBe(true)
    expect(cancelled('ws://x.test')).toBe(true)
    expect(cancelled('data:text/html;charset=utf-8,x')).toBe(false)
    expect(cancelled('file:///tmp/index.html')).toBe(false)
    expect(cancelled('about:blank')).toBe(false)
  })

  it('用内联 data URL 加载原型，不加载主窗 index.html', () => {
    const html = '<html><body>hi</body></html>'
    createPrototypePreviewWindow(html)
    const url = String(created().loadURL.mock.calls[0]?.[0] ?? '')
    expect(url).toMatch(/^data:text\/html;charset=utf-8,/)
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe(html)
  })
})
