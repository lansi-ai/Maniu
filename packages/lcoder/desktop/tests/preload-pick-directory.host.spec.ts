/** preload 把目录选择的回执翻成 string | null；失败以可读原因抛出。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LcoderApi } from '../src/contract.ts'
import { IPC_CHANNELS } from '../src/contract.ts'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
}))

async function api(): Promise<LcoderApi> {
  await import('../src/preload.ts')
  const entry = electron.exposeInMainWorld.mock.calls.find(call => call[0] === 'lcoder')
  expect(entry).toBeDefined()
  return entry![1] as LcoderApi
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('preload pickDirectory', () => {
  it('转发选中路径', async () => {
    electron.invoke.mockResolvedValue({ ok: true, path: 'E:/repo' })
    await expect((await api()).pickDirectory()).resolves.toBe('E:/repo')
    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.pickDirectory)
  })

  it('取消映射为 null', async () => {
    electron.invoke.mockResolvedValue({ ok: true, path: null })
    await expect((await api()).pickDirectory()).resolves.toBeNull()
  })

  it('失败抛出带原因的错', async () => {
    electron.invoke.mockResolvedValue({ ok: false, message: '无法打开系统目录选择框：chooser failed' })
    await expect((await api()).pickDirectory()).rejects.toThrow('无法打开系统目录选择框：chooser failed')
  })
})
