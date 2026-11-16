/** 浏览按钮的目录选择：走主进程原生对话框，取消与失败分开表达。 */
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'

const electron = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle },
  dialog: { showOpenDialog: electron.showOpenDialog },
  app: { getPath: vi.fn(() => '') },
}))
const { registerIpc } = await import('../src/ipc.ts')

const WINDOW = {} as BrowserWindow

beforeEach(() => {
  vi.resetAllMocks()
})

function install(options: { window?: BrowserWindow | undefined; locale?: 'zh' | 'en' } = {}): (event: unknown) => Promise<unknown> {
  let window: BrowserWindow | undefined = Object.hasOwn(options, 'window') ? options.window : WINDOW
  registerIpc({
    link: () => undefined,
    appInfo: () => ({ version: '0.0.0' }),
    window: () => window,
    hostState: () => ({ kind: 'starting' }),
    windowState: () => ({ maximized: false, fullscreen: false }),
    update: () => ({ kind: 'unavailable', version: '0.0.0', reason: 'no-feed' }),
    confirmClose: () => { window = undefined },
    applyLocale: vi.fn(),
    locale: () => options.locale ?? 'zh',
  })
  const entry = electron.handle.mock.calls.find(call => call[0] === IPC_CHANNELS.pickDirectory)
  expect(entry).toBeDefined()
  return entry![1] as (event: unknown) => Promise<unknown>
}

describe('lcoder:pick-directory', () => {
  it('把 dialog 选中的第一个目录回给渲染端', async () => {
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['E:/repo'] })
    const handler = install()
    await expect(handler({})).resolves.toEqual({ ok: true, path: 'E:/repo' })
    expect(electron.showOpenDialog).toHaveBeenCalledExactlyOnceWith(WINDOW, {
      properties: ['openDirectory'],
      title: '选择仓库目录',
    })
  })

  it('取消与空选择都返回 null，不报错', async () => {
    const handler = install()
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(handler({})).resolves.toEqual({ ok: true, path: null })
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    await expect(handler({})).resolves.toEqual({ ok: true, path: null })
  })

  it('对话框打不开时回带原因，不静默当作取消', async () => {
    electron.showOpenDialog.mockRejectedValueOnce(new Error('chooser failed'))
    const handler = install()
    await expect(handler({})).resolves.toEqual({
      ok: false,
      message: '无法打开系统目录选择框：chooser failed',
    })
  })

  it('语言跟随主进程；没有主窗口时只传选项', async () => {
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const handler = install({ window: undefined, locale: 'en' })
    await expect(handler({})).resolves.toEqual({ ok: true, path: null })
    expect(electron.showOpenDialog).toHaveBeenCalledExactlyOnceWith({
      properties: ['openDirectory'],
      title: 'Choose repository folder',
    })
  })
})
