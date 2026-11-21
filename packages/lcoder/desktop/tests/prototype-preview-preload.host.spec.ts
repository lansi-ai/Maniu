// @vitest-environment jsdom
/** 专用 preload：只暴露 reportSelection；点选检查器高亮、拦截页面行为并上报元素信息。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'
import type { PrototypeSelectionInfo } from '../src/contract.ts'

const electron = vi.hoisted(() => ({ invoke: vi.fn(), exposeInMainWorld: vi.fn() }))
vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke },
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
}))

await import('../src/prototype-preview-preload.ts')

const exposedEntry = electron.exposeInMainWorld.mock.calls.find(call => call[0] === 'lcoderPrototypePreview')

beforeEach(() => {
  vi.clearAllMocks()
  electron.invoke.mockResolvedValue(undefined)
  document.body.innerHTML = '<div id="app"><section class="hero"><button id="go">Go</button></section></div>'
  // preload 在 DOM 已就绪时也会安装检查器；重复派发是空操作。
  document.dispatchEvent(new Event('DOMContentLoaded'))
})

function exposed(): Record<string, (info: PrototypeSelectionInfo) => Promise<void>> {
  if (exposedEntry === undefined) throw new Error('没有暴露专用预览 API')
  return exposedEntry[1] as Record<string, (info: PrototypeSelectionInfo) => Promise<void>>
}

describe('prototype-preview-preload', () => {
  it('只暴露 reportSelection，并经专用通道上报元素信息', async () => {
    const api = exposed()
    expect(Object.keys(api)).toEqual(['reportSelection'])
    const report = api.reportSelection
    if (report === undefined) throw new Error('没有 reportSelection')
    const info: PrototypeSelectionInfo = { domPath: 'body > div', html: '<div></div>', css: 'color: red' }
    await report(info)
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.prototypeSelectionReport, info)
  })

  it('hover 高亮元素；点击拦截原型行为并上报 DOM 路径与元素片段', () => {
    const button = document.querySelector<HTMLElement>('#go')
    if (button === null) throw new Error('missing button')
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(button.style.getPropertyValue('outline')).toContain('2px solid')

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)

    expect(electron.invoke).toHaveBeenCalledTimes(1)
    const [channel, info] = electron.invoke.mock.calls[0] as [string, PrototypeSelectionInfo]
    expect(channel).toBe(IPC_CHANNELS.prototypeSelectionReport)
    expect(info.domPath).toBe('body:nth-child(2) > div#app:nth-child(1) > section.hero:nth-child(1) > button#go:nth-child(1)')
    expect(info.html).toContain('<button id="go"')
    expect(info.html).toContain('>Go</button>')
    expect(typeof info.css).toBe('string')
  })

  it('上报前剥掉脚本与事件属性，不给模型灌入可执行内容', () => {
    document.body.innerHTML = '<div id="x" onclick="alert(1)"><script>alert(2)</script><span>hi</span></div>'
    const target = document.querySelector<HTMLElement>('#x')
    if (target === null) throw new Error('missing target')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const info = electron.invoke.mock.calls[0]?.[1] as PrototypeSelectionInfo
    expect(info.html).not.toContain('<script')
    expect(info.html).not.toContain('onclick')
  })

  it('表单提交同样被拦截，原型自身导航不干扰点选', () => {
    document.body.innerHTML = '<form id="f"><button id="b">提交</button></form>'
    const form = document.querySelector<HTMLFormElement>('#f')
    if (form === null) throw new Error('missing form')
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(submit)
    expect(submit.defaultPrevented).toBe(true)
  })
})
