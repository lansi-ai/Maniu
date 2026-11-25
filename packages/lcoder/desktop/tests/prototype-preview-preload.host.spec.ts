// @vitest-environment jsdom
/** 专用 preload：默认不干预原型交互；Alt 点击或选择模式才选中并上报元素信息。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/contract.ts'
import type { PrototypeSelectionInfo } from '../src/contract.ts'

const electron = vi.hoisted(() => ({ invoke: vi.fn(), on: vi.fn(), send: vi.fn(), exposeInMainWorld: vi.fn() }))
vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, on: electron.on, send: electron.send },
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
}))

await import('../src/prototype-preview-preload.ts')

const exposedEntry = electron.exposeInMainWorld.mock.calls.find(call => call[0] === 'lcoderPrototypePreview')
/** 订阅发生在模块加载时；先留存监听器，避免 beforeEach 清空调用记录后拿不到。 */
const inspectListenerCall = electron.on.mock.calls.find(
  call => call[0] === IPC_CHANNELS.prototypeStudioInspectControl,
)

function exposed(): Record<string, (info: PrototypeSelectionInfo) => Promise<void>> {
  if (exposedEntry === undefined) throw new Error('没有暴露专用预览 API')
  return exposedEntry[1] as Record<string, (info: PrototypeSelectionInfo) => Promise<void>>
}

function toggle(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="prototype-preview-select-mode"]')
  if (button === null) throw new Error('没有选择模式开关')
  return button
}

/** 还原跨用例保留的交互状态：按键、选择模式、提交抑制与高亮。 */
function resetInteractions(): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
  if (toggle().getAttribute('aria-pressed') === 'true') toggle().click()
  document.body.innerHTML = '<div id="app"><section class="hero"><button id="go">Go</button></section></div>'
  const button = document.querySelector<HTMLElement>('#go')
  if (button === null) throw new Error('missing button')
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

beforeEach(() => {
  vi.clearAllMocks()
  electron.invoke.mockResolvedValue(undefined)
  resetInteractions()
  // preload 在 DOM 已就绪时也会安装检查器；重复派发是空操作。
  document.dispatchEvent(new Event('DOMContentLoaded'))
})

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

  it('普通点击不拦截、不上报，原型自身监听照常收到', () => {
    const button = document.querySelector<HTMLElement>('#go')
    if (button === null) throw new Error('missing button')
    const seen: string[] = []
    button.addEventListener('click', () => seen.push('go'))

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(seen).toEqual(['go'])
    expect(electron.invoke).not.toHaveBeenCalled()
  })

  it('Alt+Click 拦截并上报元素信息，DOM 路径、片段与样式正确且保持高亮', () => {
    const button = document.querySelector<HTMLElement>('#go')
    if (button === null) throw new Error('missing button')

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })
    button.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(button.style.getPropertyValue('outline')).toContain('2px solid')
    expect(electron.invoke).toHaveBeenCalledTimes(1)
    const [channel, info] = electron.invoke.mock.calls[0] as [string, PrototypeSelectionInfo]
    expect(channel).toBe(IPC_CHANNELS.prototypeSelectionReport)
    expect(info.domPath).toBe('body:nth-child(2) > div#app:nth-child(1) > section.hero:nth-child(1) > button#go:nth-child(1)')
    expect(info.html).toContain('<button id="go"')
    expect(info.html).toContain('>Go</button>')
    expect(typeof info.css).toBe('string')
  })

  it('注入可见悬浮提示条；点开关本身不上报，开启后普通点击选中，关闭后恢复可交互', () => {
    const bar = document.querySelector<HTMLElement>('[data-testid="prototype-preview-hint"]')
    if (bar === null) throw new Error('没有悬浮提示条')
    expect(bar.textContent).toContain('按住 Alt 点击元素选中')
    expect(bar.style.position).toBe('fixed')
    expect(bar.style.zIndex).toBe('2147483647')
    expect(toggle().textContent).toContain('选择模式')

    const button = document.querySelector<HTMLElement>('#go')
    if (button === null) throw new Error('missing button')

    toggle().click()
    expect(electron.invoke).not.toHaveBeenCalled()
    expect(toggle().getAttribute('aria-pressed')).toBe('true')

    const selectClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(selectClick)
    expect(selectClick.defaultPrevented).toBe(true)
    expect(electron.invoke).toHaveBeenCalledTimes(1)

    toggle().click()
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(electron.invoke).toHaveBeenCalledTimes(1)

    const normalClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(normalClick)
    expect(normalClick.defaultPrevented).toBe(false)
    expect(electron.invoke).toHaveBeenCalledTimes(1)
  })

  it('普通悬停不高亮；Alt 按住或选择模式下悬停高亮', () => {
    const button = document.querySelector<HTMLElement>('#go')
    if (button === null) throw new Error('missing button')

    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(button.style.getPropertyValue('outline')).toBe('')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }))
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(button.style.getPropertyValue('outline')).toContain('2px solid')

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
    expect(button.style.getPropertyValue('outline')).toBe('')

    toggle().click()
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(button.style.getPropertyValue('outline')).toContain('2px solid')
  })

  it('Alt 按键不交给窗口：keydown 与 keyup 都拦住，其它按键放行', () => {
    const altDown = new KeyboardEvent('keydown', { key: 'Alt', bubbles: true, cancelable: true })
    window.dispatchEvent(altDown)
    expect(altDown.defaultPrevented).toBe(true)

    const altUp = new KeyboardEvent('keyup', { key: 'Alt', bubbles: true, cancelable: true })
    window.dispatchEvent(altUp)
    expect(altUp.defaultPrevented).toBe(true)

    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    window.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
  })

  it('普通提交放行；只有选中动作触发的提交才拦截', () => {
    document.body.innerHTML = '<form id="f"><button id="b">提交</button></form>'
    const form = document.querySelector<HTMLFormElement>('#f')
    if (form === null) throw new Error('missing form')

    const normal = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(normal)
    expect(normal.defaultPrevented).toBe(false)

    const button = document.querySelector<HTMLElement>('#b')
    if (button === null) throw new Error('missing button')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))

    const selected = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(selected)
    expect(selected.defaultPrevented).toBe(true)

    const after = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  it('上报前剥掉脚本与事件属性，不给模型灌入可执行内容', () => {
    document.body.innerHTML = '<div id="x" onclick="alert(1)"><script>alert(2)</script><span>hi</span></div>'
    const target = document.querySelector<HTMLElement>('#x')
    if (target === null) throw new Error('missing target')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    const info = electron.invoke.mock.calls[0]?.[1] as PrototypeSelectionInfo
    expect(info.html).not.toContain('<script')
    expect(info.html).not.toContain('onclick')
  })

  it('原型运行期抛错时在提示条显示可见报错，点击关闭不触发元素上报', () => {
    const banner = document.querySelector<HTMLElement>('[data-testid="prototype-preview-error"]')
    const text = document.querySelector<HTMLElement>('[data-testid="prototype-preview-error-text"]')
    const dismiss = document.querySelector<HTMLButtonElement>('[data-testid="prototype-preview-error-dismiss"]')
    if (banner === null || text === null || dismiss === null) throw new Error('缺少运行时报错提示节点')

    window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: Cannot set properties of null' }))
    expect(banner.style.display).toBe('flex')
    expect(text.textContent).toContain('原型脚本报错')
    expect(text.textContent).toContain('TypeError: Cannot set properties of null')

    dismiss.click()
    expect(banner.style.display).toBe('none')
    expect(electron.invoke).not.toHaveBeenCalled()
  })

  it('上报元素的可读短名：aria-label 优先，其次可见文本，再退回标签标识', () => {
    const button = document.querySelector<HTMLElement>('#go')
    if (button === null) throw new Error('missing button')

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    expect((electron.invoke.mock.calls[0]?.[1] as PrototypeSelectionInfo).label).toBe('Go')

    electron.invoke.mockClear()
    button.setAttribute('aria-label', '  前往   下一步  ')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    expect((electron.invoke.mock.calls[0]?.[1] as PrototypeSelectionInfo).label).toBe('前往 下一步')

    electron.invoke.mockClear()
    button.removeAttribute('aria-label')
    button.textContent = ''
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    expect((electron.invoke.mock.calls[0]?.[1] as PrototypeSelectionInfo).label).toBe('button#go')
  })

  it('工作台下行 select/interact 同步选择模式与提示条开关', () => {
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    sendControl({ interactionMode: 'select' })
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(toggle().textContent).toContain('选择模式：开')

    const button = document.querySelector<HTMLElement>('#go')
    if (button === null) throw new Error('missing button')
    const selectClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(selectClick)
    expect(selectClick.defaultPrevented).toBe(true)
    expect(electron.invoke).toHaveBeenCalledTimes(1)

    sendControl({ interactionMode: 'interact' })
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(toggle().textContent).toContain('选择模式：关')
    const normalClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(normalClick)
    expect(normalClick.defaultPrevented).toBe(false)
    expect(electron.invoke).toHaveBeenCalledTimes(1)
  })

  it('工作台下行 highlightDomPaths 标记匹配元素，空数组清除标记', () => {
    const button = document.querySelector<HTMLElement>('#go')
    if (button === null) throw new Error('missing button')
    const path = 'body:nth-child(2) > div#app:nth-child(1) > section.hero:nth-child(1) > button#go:nth-child(1)'
    sendControl({ highlightDomPaths: [path] })
    expect(button.getAttribute('data-lcoder-changed')).toBe('true')
    expect(button.style.getPropertyValue('outline')).toContain('dashed')

    sendControl({ highlightDomPaths: [] })
    expect(button.hasAttribute('data-lcoder-changed')).toBe(false)
    expect(button.style.getPropertyValue('outline')).toBe('')
  })

  it('卡片容器自身没有文本时，从内层标题取可读元素名', () => {
    document.body.innerHTML = '<div class="mini"><h3>本月已提交报销总额</h3><span>￥12,000</span></div>'
    const target = document.querySelector<HTMLElement>('.mini')
    if (target === null) throw new Error('missing card')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    expect((electron.invoke.mock.calls.at(-1)?.[1] as PrototypeSelectionInfo).label).toBe('本月已提交报销总额')

    // 内层没有标题/强调子节点时，退到整段文本的首段。
    document.body.innerHTML = '<div class="mini"><div>本月已提交报销总额</div> <div>共 12 笔</div></div>'
    const plain = document.querySelector<HTMLElement>('.mini')
    if (plain === null) throw new Error('missing card')
    plain.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    expect((electron.invoke.mock.calls.at(-1)?.[1] as PrototypeSelectionInfo).label).toBe('本月已提交报销总额')
  })

  it('工作台画布收到下行控制后收起提示条，只在运行时报错时露出红条且节点保留', () => {
    const bar = document.querySelector<HTMLElement>('[data-testid="prototype-preview-hint"]')
    const banner = document.querySelector<HTMLElement>('[data-testid="prototype-preview-error"]')
    if (bar === null || banner === null) throw new Error('缺少提示条节点')

    sendControl({ interactionMode: 'select' })
    expect(bar.style.display).toBe('none')
    expect(document.querySelector('[data-testid="prototype-preview-select-mode"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="prototype-preview-hint"]')).not.toBeNull()

    window.dispatchEvent(new ErrorEvent('error', { message: 'ReferenceError: x is not defined' }))
    expect(bar.style.display).toBe('flex')
    expect(banner.style.display).toBe('flex')

    document.querySelector<HTMLButtonElement>('[data-testid="prototype-preview-error-dismiss"]')?.click()
    expect(banner.style.display).toBe('none')
    expect(bar.style.display).toBe('none')
  })

  it('并排对比下发 compareBadge 与 resizeEdge，渲染角标并支持拖拽中缝按 screenX 稳定上报 deltaX，清空时移除', () => {
    sendControl({ compareBadge: '修改前 · 正式版', resizeEdge: 'right' })
    const badge = document.querySelector<HTMLElement>('[data-testid="prototype-compare-badge"]')
    const handle = document.querySelector<HTMLElement>('[data-testid="prototype-compare-resize-handle"]')
    const grip = document.querySelector<HTMLElement>('[data-testid="prototype-compare-resize-grip"]')
    if (badge === null || handle === null || grip === null) throw new Error('缺少并排对比角标、抓手或把手胶囊')
    expect(badge.textContent).toBe('修改前 · 正式版')
    expect(badge.style.pointerEvents).toBe('none')
    expect(handle.style.width).toBe('10px')
    expect(handle.style.cursor).toBe('col-resize')
    expect(handle.title).toBe('左右拖动调整对比宽度')
    expect(handle.getAttribute('data-edge')).toBe('right')

    // 拖动中即使 clientX 因视图平移/缩放反向跳变，仍只按 screenX 计算稳定增量，不抖动。
    handle.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, screenX: 100, clientX: 4,
    }))
    handle.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, cancelable: true, screenX: 118, clientX: -12,
    }))
    handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }))
    expect(electron.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.prototypeStudioCompareResize, { deltaX: 18 })

    sendControl({ compareBadge: '' })
    expect(document.querySelector('[data-testid="prototype-compare-badge"]')).toBeNull()
    expect(document.querySelector('[data-testid="prototype-compare-resize-handle"]')).toBeNull()
    expect(document.querySelector('[data-testid="prototype-compare-resize-grip"]')).toBeNull()
  })
})

/** 触发 preload 订阅的工作台检查器控制。 */
function sendControl(payload: unknown): void {
  const entry = inspectListenerCall
  if (entry === undefined) throw new Error('没有订阅工作台检查器控制')
  const listener = entry[1] as (event: unknown, value: unknown) => void
  listener({}, payload)
}
