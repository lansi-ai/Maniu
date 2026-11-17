/** 浏览按钮的目录选择：走主进程原生对话框，取消与失败分开表达，起始目录按回退链取。 */
import type { BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'

const electron = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
  getPath: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle },
  dialog: { showOpenDialog: electron.showOpenDialog },
  app: { getPath: electron.getPath },
}))
const { registerIpc } = await import('../src/ipc.ts')

const WINDOW = {} as BrowserWindow
let userData: string

beforeEach(() => {
  vi.resetAllMocks()
  userData = mkdtempSync(join(tmpdir(), 'lcoder-picker-'))
  electron.getPath.mockReturnValue(userData)
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function install(options: { window?: BrowserWindow | undefined; locale?: 'zh' | 'en' } = {}): (event: unknown, value?: unknown) => Promise<unknown> {
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
  return entry![1] as (event: unknown, value?: unknown) => Promise<unknown>
}

function dialogOptions(call = 0): Record<string, unknown> {
  return electron.showOpenDialog.mock.calls[call]![1] as Record<string, unknown>
}

describe('lcoder:pick-directory', () => {
  it('把当前项目路径作为起始目录，并把选中的目录回给渲染端', async () => {
    const project = join(userData, 'repo')
    mkdirSync(project)
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['E:/picked'] })
    const handler = install()
    await expect(handler({}, project)).resolves.toEqual({ ok: true, path: 'E:/picked' })
    expect(electron.showOpenDialog).toHaveBeenCalledExactlyOnceWith(WINDOW, {
      properties: ['openDirectory'],
      title: '选择仓库目录',
      defaultPath: project,
    })
  })

  it('文件路径不用作起始目录，只取它所在的目录', async () => {
    const project = join(userData, 'repo')
    mkdirSync(project)
    writeFileSync(join(project, 'README.md'), '#')
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const handler = install()
    await expect(handler({}, join(project, 'README.md'))).resolves.toEqual({ ok: true, path: null })
    expect(dialogOptions()).toMatchObject({ defaultPath: project })
  })

  it('不存在的路径退到最近的已存在祖先', async () => {
    const project = join(userData, 'repo')
    mkdirSync(project)
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const handler = install()
    await handler({}, join(project, 'missing', 'deeper'))
    expect(dialogOptions()).toMatchObject({ defaultPath: project })
  })

  it('没有可用入参时复用上次成功选择的目录', async () => {
    const first = join(userData, 'first')
    const second = join(userData, 'second')
    mkdirSync(first)
    mkdirSync(second)
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [first] })
    const handler = install()
    await handler({})
    expect(dialogOptions()).not.toHaveProperty('defaultPath')
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [second] })
    await handler({})
    expect(dialogOptions(1)).toMatchObject({ defaultPath: first })
  })

  it('取消不改变上次选择的目录', async () => {
    const first = join(userData, 'first')
    mkdirSync(first)
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [first] })
    const handler = install()
    await handler({})
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(handler({})).resolves.toEqual({ ok: true, path: null })
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await handler({})
    expect(dialogOptions(2)).toMatchObject({ defaultPath: first })
  })

  it('取消与空选择都返回 null，不报错', async () => {
    const handler = install()
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(handler({})).resolves.toEqual({ ok: true, path: null })
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    await expect(handler({})).resolves.toEqual({ ok: true, path: null })
    expect(dialogOptions()).not.toHaveProperty('defaultPath')
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
