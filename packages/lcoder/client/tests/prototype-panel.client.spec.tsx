// @vitest-environment jsdom
/** T-299：原型区——参考图上传、样式摘要、沙箱预览、区块重生成、采纳与二次确认清除。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrototypePanel, type PrototypePanelProps } from '../src/pages/prototype-panel.tsx'
import type { RequirementDocRow } from '../src/spec/rows.ts'
import type { PrototypeSelectionInfo, RemoteResult } from '../src/contract.ts'

const HTML = '<!doctype html><html><head><title>原型</title></head><body><nav>导航</nav><h1>原型</h1><section><ul><li>内容</li></ul></section><footer>页脚</footer></body></html>'

const ROW: RequirementDocRow = {
  id: 'REQ-01',
  title: '登录改造',
  text: '# 登录改造\n\n邮箱登录与验证码入口。',
  state: 'draft',
  options: [],
  versions: [],
  reviews: [],
}

const QUALITY = {
  passed: ['parseable', 'sections', 'no-unsafe-markup'],
  failed: [],
  keywordHitRate: 1,
  keywords: ['登录改造', '邮箱登录'],
  hits: ['登录改造', '邮箱登录'],
  misses: [],
}

const REGISTERED: RequirementDocRow = {
  ...ROW,
  prototype: {
    path: 'prototypes/REQ-01/index.html',
    generatedAt: '2026-11-20T00:00:00.000Z',
    references: [],
    quality: QUALITY,
  },
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
})

interface Harness {
  readonly call: ReturnType<typeof vi.fn>
  readonly generate: ReturnType<typeof vi.fn>
  readonly reload: ReturnType<typeof vi.fn>
  readonly props: PrototypePanelProps
}

/** 默认把 workspaceFiles.read 回成原型 HTML；其余走假 Remote。 */
function harness(row: RequirementDocRow = ROW): Harness {
  const call = vi.fn(async (namespace: string, method: string, _args: object): Promise<RemoteResult> => {
    if (namespace === 'workspaceFiles' && method === 'read') return { ok: true, value: { text: HTML } }
    if (namespace === 'prototype' && method === 'prefetch') {
      return {
        ok: true,
        value: {
          url: 'https://example.com', title: '示例', headings: [], text: '正文节选',
          colors: ['#123456'], font: 'Inter', layout: 'flex', buttonStyle: '圆角', truncated: false,
        },
      }
    }
    if (namespace === 'prototype' && method === 'uploadRef') {
      return { ok: true, value: { path: `prototypes/${row.id}/refs/a.png`, bytes: 3 } }
    }
    return { ok: true, value: { ok: true } }
  })
  const generate = vi.fn(async () => ({ ok: true, message: '会话已发起' }))
  const reload = vi.fn()
  const props: PrototypePanelProps = {
    row,
    scopeSessionId: 'session-scope',
    running: false,
    onGenerate: generate,
    onReload: reload,
    call,
  }
  return { call, generate, reload, props }
}

/** 主窗 preload 的替身：记录打开预览调用，并可向面板投递点选上报。 */
function installWindowApi(): {
  readonly open: ReturnType<typeof vi.fn>
  readonly emit: (info: PrototypeSelectionInfo) => void
} {
  const listeners: Array<(info: PrototypeSelectionInfo) => void> = []
  const open = vi.fn(async (_html: string): Promise<void> => {})
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      openPrototypePreview: open,
      onPrototypeSelection: (listener: (info: PrototypeSelectionInfo) => void) => {
        listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
    },
  })
  return { open, emit: (info) => { for (const listener of [...listeners]) listener(info) } }
}

async function render(props: PrototypePanelProps): Promise<void> {
  await act(async () => { root.render(<PrototypePanel {...props} />) })
}

async function click(testId: string): Promise<void> {
  const node = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (node === null) throw new Error(`missing ${testId}`)
  await act(async () => { node.click() })
}

describe('PrototypePanel', () => {
  it('生成按钮把需求正文、样式摘要与参考图拼进提示词，并用原型人才后台发起', async () => {
    const h = harness()
    await render(h.props)
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('[data-testid="prototype-url-input"]')
      if (input === null) throw new Error('no url input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'https://example.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('prototype-url-prefetch')
    expect(container.querySelector('[data-testid="prototype-summary"]')).not.toBeNull()
    await click('prototype-generate')

    expect(h.generate).toHaveBeenCalledTimes(1)
    const prompt = String(h.generate.mock.calls[0]?.[0] ?? '')
    expect(prompt).toContain('REQ-01')
    expect(prompt).toContain('邮箱登录与验证码入口')
    expect(prompt).toContain('https://example.com')
    expect(prompt).toContain('prototype_draft')
  })

  it('预览 iframe 固定 sandbox="" 且只有 srcDoc，没有 allow-scripts / allow-same-origin', async () => {
    const h = harness(REGISTERED)
    await render(h.props)
    const frame = container.querySelector('iframe[data-testid="prototype-iframe"]')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.hasAttribute('allow-scripts')).toBe(false)
    expect(frame?.hasAttribute('allow-same-origin')).toBe(false)
    expect(frame?.getAttribute('srcdoc')).toBe(HTML)
  })

  it('区块级重生成附加区块标识并覆盖同一路径', async () => {
    const h = harness(REGISTERED)
    await render(h.props)
    const buttons = container.querySelectorAll('[data-testid="prototype-regenerate-section"]')
    expect(buttons.length).toBe(5)
    await click('prototype-regenerate-section')
    const prompt = String(h.generate.mock.calls[0]?.[0] ?? '')
    expect(prompt).toContain('区块级重生成')
    expect(prompt).toContain('顶部导航')
    expect(prompt).toContain('prototype_draft')
  })

  it('区块重做在发起中显示进行中状态，完成后给出该区块的回执', async () => {
    let resolveGenerate: ((answer: { readonly ok: boolean; readonly message: string }) => void) | undefined
    const generate = vi.fn((_prompt: string) => new Promise<{ readonly ok: boolean; readonly message: string }>((resolve) => {
      resolveGenerate = resolve
    }))
    const h = harness(REGISTERED)
    await render({ ...h.props, onGenerate: generate })
    const chip = container.querySelector<HTMLElement>('[data-testid="prototype-regenerate-section"][data-section="顶部导航"]')
    if (chip === null) throw new Error('missing section chip')
    await act(async () => { chip.click() })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(chip.getAttribute('data-state')).toBe('running')
    expect(container.querySelector('[data-testid="prototype-section-status"]')?.textContent).toContain('顶部导航')
    expect(String(generate.mock.calls[0]?.[0] ?? '')).toContain('只重做「顶部导航」区块')

    await act(async () => { resolveGenerate?.({ ok: true, message: '会话已发起' }) })
    expect(container.querySelector('[data-testid="prototype-section-status"]')).toBeNull()
    expect(container.querySelector('[data-testid="prototype-section-done"]')?.textContent).toContain('顶部导航')
  })

  it('采纳写回执；清除需二次确认后才调用宿主接口', async () => {
    const h = harness(REGISTERED)
    await render(h.props)
    await click('prototype-adopt')
    expect(h.call).toHaveBeenCalledWith('prototype', 'adopt', { input: { sessionId: 'session-scope', requirementId: 'REQ-01' } })

    expect(container.querySelector('[data-testid="prototype-clear-confirm"]')).toBeNull()
    await click('prototype-clear')
    expect(container.querySelector('[data-testid="prototype-clear-confirm"]')).not.toBeNull()
    expect(h.call).not.toHaveBeenCalledWith('prototype', 'clear', expect.anything())
    await click('prototype-clear-yes')
    expect(h.call).toHaveBeenCalledWith('prototype', 'clear', { input: { sessionId: 'session-scope', requirementId: 'REQ-01' } })
  })

  it('展示质量结果与关键词命中情况', async () => {
    const h = harness(REGISTERED)
    await render(h.props)
    expect(container.querySelector('[data-testid="prototype-quality"]')?.getAttribute('data-ok')).toBe('true')
    const keywords = container.querySelector('[data-testid="prototype-keywords"]')?.textContent ?? ''
    expect(keywords).toContain('2/2')
  })

  it('质量校验达标时主推采纳', async () => {
    const h = harness(REGISTERED)
    await render(h.props)
    expect(container.querySelector('[data-testid="prototype-quality-next"]')?.getAttribute('data-recommend')).toBe('adopt')
    const guide = container.querySelector('[data-testid="prototype-quality-guide"]')?.textContent ?? ''
    expect(guide).toContain('采纳')
    await click('prototype-quality-adopt')
    expect(h.call).toHaveBeenCalledWith('prototype', 'adopt', { input: { sessionId: 'session-scope', requirementId: 'REQ-01' } })
  })

  it('关键词未命中较多时主推重新生成并提示可补参考', async () => {
    const missed: RequirementDocRow = {
      ...ROW,
      prototype: {
        path: 'prototypes/REQ-01/index.html',
        generatedAt: '2026-11-20T00:00:00.000Z',
        references: [],
        quality: {
          passed: ['parseable', 'sections', 'no-unsafe-markup'],
          failed: [],
          keywordHitRate: 0.5,
          keywords: ['登录改造', '邮箱登录'],
          hits: ['登录改造'],
          misses: ['邮箱登录'],
        },
      },
    }
    const h = harness(missed)
    await render(h.props)
    expect(container.querySelector('[data-testid="prototype-quality-next"]')?.getAttribute('data-recommend')).toBe('regenerate')
    const guide = container.querySelector('[data-testid="prototype-quality-guide"]')?.textContent ?? ''
    expect(guide).toContain('1')
    expect(guide).toContain('参考')
    await click('prototype-quality-regenerate')
    expect(h.generate).toHaveBeenCalledTimes(1)
    expect(String(h.generate.mock.calls[0]?.[0] ?? '')).not.toContain('区块级重生成')
  })

  it('生成失败显示可读错误', async () => {
    const h = harness()
    await render({ ...h.props, onGenerate: vi.fn(async () => ({ ok: false, message: '会话发起失败' })) })
    await click('prototype-generate')
    expect(container.querySelector('[data-testid="prototype-error"]')?.textContent).toContain('会话发起失败')
  })

  it('独立窗口按钮把已读 HTML 交给主进程，iframe 仍保留 sandbox=""', async () => {
    const h = harness(REGISTERED)
    const api = installWindowApi()
    await render(h.props)
    await click('prototype-open-window')
    expect(api.open).toHaveBeenCalledExactlyOnceWith(HTML)
    const frame = container.querySelector('iframe[data-testid="prototype-iframe"]')
    expect(frame?.getAttribute('sandbox')).toBe('')
  })

  it('点选上报显示选中卡，输入指令后按元素修改模式发起会话', async () => {
    const h = harness(REGISTERED)
    const api = installWindowApi()
    await render(h.props)
    const info: PrototypeSelectionInfo = {
      domPath: 'body:nth-child(2) > button:nth-child(3)',
      html: '<button class="submit">登录</button>',
      css: 'color: #333; font-size: 16px',
    }
    await act(async () => { api.emit(info) })
    expect(container.querySelector('[data-testid="prototype-selection-card"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-selection-path"]')?.textContent).toContain(info.domPath)
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('[data-testid="prototype-selection-instruction"]')
      if (input === null) throw new Error('no selection input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '把按钮改成主色')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('prototype-selection-apply')
    expect(h.generate).toHaveBeenCalledTimes(1)
    const prompt = String(h.generate.mock.calls[0]?.[0] ?? '')
    expect(prompt).toContain(info.domPath)
    expect(prompt).toContain(info.html)
    expect(prompt).toContain(info.css)
    expect(prompt).toContain('把按钮改成主色')
    expect(prompt).toContain('prototype_patch')
  })

  it('元素级修改后已打开的预览窗口收到刷新，不重复堆积新窗口', async () => {
    let current = HTML
    const call = vi.fn(async (namespace: string, method: string, _args: object): Promise<RemoteResult> => {
      if (namespace === 'workspaceFiles' && method === 'read') return { ok: true, value: { text: current } }
      return { ok: true, value: { ok: true } }
    })
    const h = harness(REGISTERED)
    const api = installWindowApi()
    const props: PrototypePanelProps = { ...h.props, call }
    await render(props)
    await click('prototype-open-window')
    expect(api.open).toHaveBeenCalledTimes(1)

    const changed = HTML.replace('<h1>原型</h1>', '<h1>原型已改</h1>')
    current = changed
    const updatedRow: RequirementDocRow = {
      ...REGISTERED,
      prototype: {
        path: 'prototypes/REQ-01/index.html',
        generatedAt: '2026-11-21T00:00:00.000Z',
        references: [],
        quality: QUALITY,
      },
    }
    await act(async () => { root.render(<PrototypePanel {...props} row={updatedRow} />) })
    expect(api.open).toHaveBeenCalledTimes(2)
    expect(api.open).toHaveBeenLastCalledWith(changed)
  })
})
