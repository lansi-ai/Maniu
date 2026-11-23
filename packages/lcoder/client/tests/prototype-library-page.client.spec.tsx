// @vitest-environment jsdom
/** T-310：原型库页面导航挂载、实时沙箱预览、新建/复制/编辑/删除与 PrototypePanel 联动单测。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/app.tsx'
import { PrototypeLibraryPage } from '../src/pages/prototype-library.tsx'
import { PrototypePanel, type PrototypePanelProps } from '../src/pages/prototype-panel.tsx'
import { BUILTIN_PROTOTYPE_LIBRARIES, setDefaultPrototypeLibraryId } from '../src/prototype/libraries.ts'
import type { RequirementDocRow } from '../src/spec/rows.ts'

const ROW: RequirementDocRow = {
  id: 'REQ-10',
  title: '移动审批中心',
  text: '# 移动审批中心\n\n支持待办卡片浏览与一键审批。',
  state: 'draft',
  options: [],
  versions: [],
  reviews: [],
}

let container: HTMLDivElement
let root: Root

function setInputValue(node: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = node instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 必须通过 call 绑定当前表单元素。
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(node, value)
  node.dispatchEvent(new Event('input', { bubbles: true }))
}

function setSelectValue(node: HTMLSelectElement, value: string): void {
  // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 必须通过 call 绑定 select 元素。
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  setter?.call(node, value)
  node.dispatchEvent(new Event('change', { bubbles: true }))
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

async function pressElement(node: Element | null): Promise<void> {
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await flush()
}

function installMinimalWindowApi(): void {
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async (namespace: string, method: string) => {
        if (namespace === 'lcoderCloud' && method === 'state') {
          return {
            ok: true,
            value: { ok: true, value: { signedIn: true, needsLogin: false, user: null, quota: null, estimate: null, lastError: null } },
          }
        }
        if (namespace === 'session' && method === 'list') return { ok: true, value: { items: [] } }
        return { ok: true, value: {} }
      }),
      hostState: () => () => {},
      hostStateNow: async () => ({ kind: 'ready', url: 'http://127.0.0.1:1' }),
      openStream: async () => 'stream-1',
      cancelStream: async () => {},
      onStreamFrame: () => () => {},
      onEvent: () => () => {},
      onWaterfall: () => () => {},
      onWaterfallCancel: () => () => {},
      eventResult: async () => {},
      window: async () => {},
      onCloseRequest: () => () => {},
      confirmClose: async () => {},
      windowState: () => () => {},
      windowStateNow: async () => ({ maximized: false, fullscreen: false }),
      appInfo: async () => ({ version: '0.0.0' }),
      update: async () => ({ kind: 'unavailable', version: '0.0.0', reason: 'no-feed' }),
      setLocale: async () => {},
      readPreferences: async () => ({ skin: 'dark', font: 'system', locale: 'zh', lastPickedDirectory: null }),
      writePreferences: async () => ({ skin: 'dark', font: 'system', locale: 'zh', lastPickedDirectory: null }),
      pickDirectory: async () => null,
    },
  })
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') },
  })
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
  localStorage.clear()
})

describe('左侧菜单与原型库挂载', () => {
  it('原型库菜单位于人才库正下方、设置上方，点击后打开原型库页面', async () => {
    installMinimalWindowApi()
    await act(async () => { root.render(<App />) })
    await flush()

    const navIds = [...container.querySelectorAll('[data-testid^="nav-"]')]
      .map(node => node.getAttribute('data-testid'))
    const talentsIndex = navIds.indexOf('nav-talents')
    const protoIndex = navIds.indexOf('nav-prototype-library')
    const settingsIndex = navIds.indexOf('nav-settings')

    expect(talentsIndex).toBeGreaterThanOrEqual(0)
    expect(protoIndex).toBe(talentsIndex + 1)
    expect(settingsIndex).toBe(protoIndex + 1)

    await pressElement(container.querySelector('[data-testid="nav-prototype-library"]'))
    expect(container.querySelector('[data-testid="page-prototype-library"]')).not.toBeNull()
  })
})

describe('PrototypeLibraryPage', () => {
  it('展示内置 4 套库、沙箱 iframe 隔离预览并支持切换与设为默认', async () => {
    await act(async () => { root.render(<PrototypeLibraryPage />) })
    await flush()

    const cards = [...container.querySelectorAll('[data-testid="proto-lib-card"]')]
    expect(cards).toHaveLength(4)
    expect(cards[0]?.getAttribute('data-library-id')).toBe('heroui-glass')
    expect(cards[0]?.getAttribute('data-selected')).toBe('true')
    expect(cards[0]?.querySelector('[data-testid="proto-lib-edit"]')).toBeNull()
    expect(cards[0]?.querySelector('[data-testid="proto-lib-delete"]')).toBeNull()

    const iframe = container.querySelector('iframe[data-testid="proto-lib-preview-iframe"]')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('')
    expect(iframe?.hasAttribute('allow-scripts')).toBe(false)
    expect(iframe?.hasAttribute('allow-same-origin')).toBe(false)
    const enterprise = BUILTIN_PROTOTYPE_LIBRARIES[1]
    const glass = BUILTIN_PROTOTYPE_LIBRARIES[0]
    expect(enterprise).toBeDefined()
    expect(glass).toBeDefined()
    expect(iframe?.getAttribute('srcdoc')).toBe(glass?.previewHtml)

    await pressElement(cards[1] ?? null)
    expect(container.querySelector('[data-testid="proto-lib-detail"]')?.getAttribute('data-library-id')).toBe('enterprise-admin')
    expect(container.querySelector('iframe[data-testid="proto-lib-preview-iframe"]')?.getAttribute('srcdoc'))
      .toBe(enterprise?.previewHtml)

    const setDefaultBtn = cards[2]?.querySelector('[data-testid="proto-lib-set-default"]') ?? null
    await pressElement(setDefaultBtn)
    expect(cards[2]?.querySelector('[data-testid="proto-lib-default-badge"]')).not.toBeNull()
  })

  it('支持复制内置库、新建自定义库、编辑及二次确认删除', async () => {
    await act(async () => { root.render(<PrototypeLibraryPage />) })
    await flush()

    // 复制内置第 2 套库
    const enterprise = BUILTIN_PROTOTYPE_LIBRARIES[1]
    expect(enterprise).toBeDefined()
    const secondCard = container.querySelectorAll('[data-testid="proto-lib-card"]')[1] ?? null
    await pressElement(secondCard?.querySelector('[data-testid="proto-lib-duplicate"]') ?? null)

    const nameInput = document.querySelector<HTMLInputElement>('[data-testid="proto-lib-form-name"]')
    const tokensInput = document.querySelector<HTMLTextAreaElement>('[data-testid="proto-lib-form-tokens"]')
    expect(nameInput?.value).toContain(enterprise?.name ?? '')
    expect(tokensInput?.value).toBe(enterprise?.designTokens)

    await act(async () => {
      if (nameInput !== null) setInputValue(nameInput, '企业蓝白定制版')
    })
    await pressElement(document.querySelector('[data-testid="proto-lib-form-submit"]'))

    let customCards = [...container.querySelectorAll('[data-testid="proto-lib-card"][data-builtin="false"]')]
    expect(customCards).toHaveLength(1)
    expect(customCards[0]?.textContent).toContain('企业蓝白定制版')

    // 编辑自定义库
    await pressElement(customCards[0]?.querySelector('[data-testid="proto-lib-edit"]') ?? null)
    const editName = document.querySelector<HTMLInputElement>('[data-testid="proto-lib-form-name"]')
    await act(async () => {
      if (editName !== null) setInputValue(editName, '企业蓝白定制版 V2')
    })
    await pressElement(document.querySelector('[data-testid="proto-lib-form-submit"]'))
    customCards = [...container.querySelectorAll('[data-testid="proto-lib-card"][data-builtin="false"]')]
    expect(customCards[0]?.textContent).toContain('企业蓝白定制版 V2')

    // 新建自定义库（校验空名称后再提交）
    await pressElement(container.querySelector('[data-testid="proto-lib-create"]'))
    await pressElement(document.querySelector('[data-testid="proto-lib-form-submit"]'))
    expect(document.querySelector('[data-testid="proto-lib-form-error"]')).not.toBeNull()

    await act(async () => {
      const n = document.querySelector<HTMLInputElement>('[data-testid="proto-lib-form-name"]')
      const tk = document.querySelector<HTMLTextAreaElement>('[data-testid="proto-lib-form-tokens"]')
      const gd = document.querySelector<HTMLTextAreaElement>('[data-testid="proto-lib-form-guidelines"]')
      if (n !== null) setInputValue(n, '医疗工作站风')
      if (tk !== null) setInputValue(tk, 'primary: #0D9488')
      if (gd !== null) setInputValue(gd, '1. 顶部使用浅绿状态条')
    })
    await pressElement(document.querySelector('[data-testid="proto-lib-form-submit"]'))

    customCards = [...container.querySelectorAll('[data-testid="proto-lib-card"][data-builtin="false"]')]
    expect(customCards).toHaveLength(2)

    // 删除新建的自定义库（需确认）
    await pressElement(customCards[1]?.querySelector('[data-testid="proto-lib-delete"]') ?? null)
    expect(customCards[1]?.querySelector('[data-testid="proto-lib-delete-confirm"]')).not.toBeNull()
    await pressElement(customCards[1]?.querySelector('[data-testid="proto-lib-delete-confirm"]') ?? null)

    customCards = [...container.querySelectorAll('[data-testid="proto-lib-card"][data-builtin="false"]')]
    expect(customCards).toHaveLength(1)
  })
})

describe('PrototypePanel 素材库联动', () => {
  it('默认选中默认库、支持同步默认变更、将所选素材库注入提示词并可跳转原型库', async () => {
    const generate = vi.fn(async (_prompt: string) => ({ ok: true, message: 'ok' }))
    const manage = vi.fn()
    const props: PrototypePanelProps = {
      row: ROW,
      scopeSessionId: 'session-1',
      running: false,
      onGenerate: generate,
      onReload: vi.fn(),
      onManageLibraries: manage,
      call: vi.fn(async () => ({ ok: true as const, value: { ok: true } })),
    }

    await act(async () => { root.render(<PrototypePanel {...props} />) })
    await flush()

    const select = container.querySelector<HTMLSelectElement>('[data-testid="prototype-library-select"]')
    expect(select).not.toBeNull()
    expect(select?.value).toBe('heroui-glass')

    // 外部切换默认库后自动同步
    await act(async () => {
      setDefaultPrototypeLibraryId('minimal-linear')
    })
    await flush()
    expect(container.querySelector<HTMLSelectElement>('[data-testid="prototype-library-select"]')?.value).toBe('minimal-linear')

    // 在面板中切换到 mobile-card 并生成
    await act(async () => {
      const node = container.querySelector<HTMLSelectElement>('[data-testid="prototype-library-select"]')
      if (node !== null) setSelectValue(node, 'mobile-card')
    })
    await pressElement(container.querySelector('[data-testid="prototype-generate"]'))

    const mobile = BUILTIN_PROTOTYPE_LIBRARIES[3]
    expect(mobile).toBeDefined()
    expect(generate).toHaveBeenCalledTimes(1)
    const prompt = generate.mock.calls[0]?.[0] ?? ''
    expect(prompt).toContain(mobile?.name ?? '')
    expect(prompt).toContain(mobile?.designTokens ?? '')
    expect(prompt).toContain(mobile?.componentGuidelines ?? '')

    await pressElement(container.querySelector('[data-testid="prototype-library-manage"]'))
    expect(manage).toHaveBeenCalledTimes(1)
  })
})
