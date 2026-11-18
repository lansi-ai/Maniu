// @vitest-environment jsdom
/** 设置页外观三态：点击后写 localStorage、经 IPC 落盘，并切换 html 主题类与 data-skin。 */
import { act } from 'react'
import type { JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate, type Translate } from '../src/locale.ts'
import { usePreferences } from '../src/prefs.ts'
import { SettingsPage } from '../src/pages/settings.tsx'

const t: Translate = (key, params) => translate('zh', key, params)

let container: HTMLDivElement
let root: Root
let writes: Record<string, unknown>[]

function Harness(): JSX.Element {
  const prefs = usePreferences()
  return <SettingsPage t={t} prefs={prefs} />
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  writes = []
  localStorage.clear()
  document.documentElement.className = ''
  delete document.documentElement.dataset.skin
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async () => ({ ok: true, value: { rows: [], status: 'ready', error: null, credentialError: null, writable: false } })),
      onEvent: () => () => {},
      appInfo: async () => ({ version: '0.0.0' }),
      readPreferences: async () => ({ skin: 'dark', font: 'system', locale: 'zh' }),
      writePreferences: async (patch: Record<string, unknown>) => { writes.push(patch); return patch },
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
  localStorage.clear()
  document.documentElement.className = ''
  delete document.documentElement.dataset.skin
})

async function render(): Promise<void> {
  await act(async () => { root.render(<Harness />) })
}

async function click(testId: string): Promise<void> {
  const node = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  expect(node).not.toBeNull()
  await act(async () => { node?.click() })
}

describe('设置页外观三态', () => {
  it('点击浅色：localStorage、IPC 与 html class 同步', async () => {
    await render()
    await click('settings-appearance-light')
    expect(localStorage.getItem('lcoder.skin')).toBe('light')
    expect(writes).toEqual([{ skin: 'light' }])
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.skin).toBe('light')
  })

  it('点击暗黑：切回 dark 并落盘', async () => {
    await render()
    await click('settings-appearance-light')
    await click('settings-appearance-dark')
    expect(localStorage.getItem('lcoder.skin')).toBe('dark')
    expect(writes.at(-1)).toEqual({ skin: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
    expect(document.documentElement.dataset.skin).toBe('dark')
  })

  it('跟随系统 Switch 反映 system 状态并可由胶囊切换', async () => {
    await render()
    await click('settings-appearance-system')
    expect(localStorage.getItem('lcoder.skin')).toBe('system')
    expect(writes.at(-1)).toEqual({ skin: 'system' })
    expect(document.documentElement.dataset.skin).toBe('system')
    expect(document.documentElement.classList.contains('dark') || document.documentElement.classList.contains('light')).toBe(true)
    const sw = container.querySelector<HTMLElement>('[data-testid="settings-follow-system"]')
    expect(sw?.getAttribute('data-selected')).toBe('true')
  })
})
