// @vitest-environment jsdom
/** T-323：「原型库」更名为「素材库」，分区 Tab（原型风格模板 / 品牌色板）可切换。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PrototypeLibraryPage } from '../src/pages/prototype-library.tsx'
import { translate, type Translate } from '../src/locale.ts'

const zh: Translate = (key, params) => translate('zh', key, params)

let container: HTMLDivElement
let root: Root

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
  localStorage.clear()
})

async function press(node: Element | null): Promise<void> {
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('素材库页面', () => {
  it('标题与首个分区显示新名称，原型风格模板仍是默认分区', async () => {
    await act(async () => { root.render(<PrototypeLibraryPage t={zh} />) })

    expect(container.querySelector('[data-testid="page-prototype-library"] h2')?.textContent).toBe('素材库')
    expect(container.querySelector('[data-testid="proto-lib-tabs"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="proto-lib-tab-styles"]')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-testid="proto-lib-tab-brand"]')?.getAttribute('aria-selected')).toBe('false')
    expect(container.querySelectorAll('[data-testid="proto-lib-card"]')).toHaveLength(4)
  })

  it('切到品牌色板分区显示预留空态并隐藏风格模板，切回后恢复', async () => {
    await act(async () => { root.render(<PrototypeLibraryPage t={zh} />) })

    await press(container.querySelector('[data-testid="proto-lib-tab-brand"]'))
    expect(container.querySelector('[data-testid="proto-lib-brand-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="proto-lib-brand-empty"]')?.textContent).toContain('品牌色板')
    expect(container.querySelector('.proto-lib-layout')?.hasAttribute('hidden')).toBe(true)
    expect(container.querySelector('[data-testid="proto-lib-tab-brand"]')?.getAttribute('aria-selected')).toBe('true')

    await press(container.querySelector('[data-testid="proto-lib-tab-styles"]'))
    expect(container.querySelector('[data-testid="proto-lib-brand-panel"]')).toBeNull()
    expect(container.querySelector('.proto-lib-layout')?.hasAttribute('hidden')).toBe(false)
  })
})
