/** preload 把工作台停靠面暴露给主窗：订阅通道与恢复/关闭动作。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'
import type { LcoderApi } from '../src/contract.ts'

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

describe('preload 工作台停靠面', () => {
  it('订阅停靠通道，回传状态并返回取消订阅', async () => {
    const listener = vi.fn()
    const off = (await api()).onPrototypeStudioDockState(listener)
    expect(electron.on).toHaveBeenCalledWith(IPC_CHANNELS.prototypeStudioDockState, expect.any(Function))
    const handler = electron.on.mock.calls[0]?.[1] as (event: unknown, state: unknown) => void
    handler({}, { open: true, minimized: true, requirementId: 'R-1' })
    expect(listener).toHaveBeenCalledWith({ open: true, minimized: true, requirementId: 'R-1' })
    off()
    expect(electron.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.prototypeStudioDockState, handler)
  })

  it('恢复与关闭都走主窗到主进程的停靠动作通道', async () => {
    const host = await api()
    electron.invoke.mockResolvedValue(undefined)
    await host.controlPrototypeStudioDock('restore')
    expect(electron.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioRestore, 'restore')
    await host.controlPrototypeStudioDock('close')
    expect(electron.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.prototypeStudioRestore, 'close')
  })
})
