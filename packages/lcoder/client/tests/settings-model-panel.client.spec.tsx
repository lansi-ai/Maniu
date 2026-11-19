// @vitest-environment jsdom
/** 模型服务卡：默认折叠服务列表，点展开后列出全部 provider 明细行。 */
import { act } from 'react'
import type { JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate, type Translate } from '../src/locale.ts'
import { ModelPanel } from '../src/pages/model-panel.tsx'

const t: Translate = (key, params) => translate('zh', key, params)

const DIRECTORY = [
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm.deepseek', settingsPath: ['apiKey'], declared: true, nativeAuth: undefined },
  { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm.openai', settingsPath: ['apiKey'], declared: true, nativeAuth: undefined },
]
const REGISTERED = [
  { id: 'deepseek-official', name: 'DeepSeek' },
  { id: 'openai', name: 'OpenAI' },
]
const CATALOG = {
  groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
  default: { provider: 'deepseek-official', model: 'deepseek-chat' },
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async (namespace: string, method: string) => {
        if (namespace === 'settings' && method === 'describe') return { ok: true, value: { namespaces: [], writable: false } }
        if (namespace === 'llm' && method === 'listConfigurableProviders') return { ok: true, value: DIRECTORY }
        if (namespace === 'llm' && method === 'listProviders') return { ok: true, value: REGISTERED }
        if (namespace === 'session' && method === 'modelCatalog') return { ok: true, value: CATALOG }
        if (namespace === 'credentials' && method === 'describe') return { ok: true, value: {} }
        return { ok: false, error: { code: 'unexpected', message: `${namespace}.${method}` } }
      }),
      onEvent: () => () => {},
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
})

function App(): JSX.Element {
  return <ModelPanel t={t} />
}

async function render(): Promise<void> {
  await act(async () => { root.render(<App />) })
  await act(async () => {})
}

function query(testId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="settings-provider-row"]'))
}

describe('模型服务卡折叠', () => {
  it('默认折叠：只显示默认模型摘要，不渲染 provider 明细行', async () => {
    await render()
    expect(query('settings-models')).not.toBeNull()
    expect(query('settings-models-readonly')).not.toBeNull()
    expect(query('settings-default-model')?.textContent).toContain('DeepSeek · DeepSeek Chat')
    expect(rows()).toHaveLength(0)
  })

  it('点击展开后渲染全部 provider 行，再点收起后隐藏', async () => {
    await render()
    const toggle = query('settings-models-toggle')
    expect(toggle).not.toBeNull()
    expect(toggle?.textContent).toContain('展开服务列表（2）')

    await act(async () => { toggle?.click() })
    expect(rows()).toHaveLength(2)
    expect(rows().map(row => row.getAttribute('data-provider'))).toEqual(['deepseek-official', 'openai'])
    expect(query('settings-models-toggle')?.textContent).toContain('收起')

    await act(async () => { query('settings-models-toggle')?.click() })
    expect(rows()).toHaveLength(0)
  })
})
