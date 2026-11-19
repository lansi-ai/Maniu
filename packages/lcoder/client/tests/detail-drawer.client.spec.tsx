// @vitest-environment jsdom
/** 详情抽屉外壳：顶栏、放大/还原切换、关闭复位与子树状态保持。 */
import { act } from 'react'
import type { JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate, type Translate } from '../src/locale.ts'
import { DetailDrawer } from '../src/pages/detail-drawer.tsx'

const zh: Translate = (key, params) => translate('zh', key, params)
const en: Translate = (key, params) => translate('en', key, params)

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe(): void {}
      disconnect(): void {}
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

interface RenderOptions {
  readonly t?: Translate
  readonly onClose?: () => void
  readonly actions?: JSX.Element
  readonly defaultExpanded?: boolean
}

function render(options: RenderOptions = {}): void {
  act(() => {
    root.render(
      <section
        className="page"
        ref={(node: HTMLElement | null) => {
          if (node === null) return
          node.getBoundingClientRect = () => new DOMRect(10, 40, 900, 600)
        }}
      >
        <DetailDrawer
          {...options.t === undefined ? {} : { t: options.t }}
          testId="sample-drawer"
          closeTestId="sample-close"
          onClose={options.onClose ?? (() => undefined)}
          head={<h3>样例标题</h3>}
          {...options.actions === undefined ? {} : { actions: options.actions }}
          {...options.defaultExpanded === undefined ? {} : { defaultExpanded: options.defaultExpanded }}
          attributes={{ 'data-sample': 'yes' }}
        >
          <input data-testid="sample-input" />
          <p>正文</p>
        </DetailDrawer>
      </section>,
    )
  })
}

function toggle(): void {
  const button = container.querySelector<HTMLElement>('[data-testid="sample-drawer-expand"]')
  expect(button).not.toBeNull()
  act(() => { button?.click() })
}

describe('DetailDrawer', () => {
  it('渲染顶栏、附加控制、关闭按钮与主体', () => {
    const onClose = vi.fn()
    render({ t: zh, onClose, actions: <button type="button" data-testid="sample-refresh">刷新</button> })
    const aside = container.querySelector<HTMLElement>('[data-testid="sample-drawer"]')
    expect(aside?.getAttribute('data-sample')).toBe('yes')
    expect(aside?.querySelector('h3')?.textContent).toBe('样例标题')
    expect(aside?.querySelector('[data-testid="sample-refresh"]')).not.toBeNull()
    expect(aside?.querySelector('[data-testid="sample-close"]')?.textContent).toBe('关闭')
    expect(aside?.querySelector('[data-testid="sample-input"]')).not.toBeNull()
    act(() => { aside?.querySelector<HTMLElement>('[data-testid="sample-close"]')?.click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('放大后按宿主可见矩形固定定位，还原后回到右栏', () => {
    render()
    const aside = container.querySelector<HTMLElement>('[data-testid="sample-drawer"]')
    const button = container.querySelector<HTMLElement>('[data-testid="sample-drawer-expand"]')
    expect(aside?.getAttribute('data-expanded')).toBe('false')
    expect(aside?.classList.contains('is-expanded')).toBe(false)
    expect(button?.getAttribute('aria-label')).toBe('放大')
    expect(button?.getAttribute('aria-pressed')).toBe('false')
    expect(button?.getAttribute('title')).toBe('放大')
    toggle()
    expect(aside?.getAttribute('data-expanded')).toBe('true')
    expect(aside?.classList.contains('is-expanded')).toBe(true)
    expect(button?.getAttribute('aria-label')).toBe('还原')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
    expect(aside?.style.position).toBe('fixed')
    expect(aside?.style.top).toBe('40px')
    expect(aside?.style.left).toBe('10px')
    expect(aside?.style.width).toBe('900px')
    expect(aside?.style.height).toBe('600px')
    toggle()
    expect(aside?.getAttribute('data-expanded')).toBe('false')
    expect(button?.getAttribute('aria-label')).toBe('放大')
    expect(aside?.style.position).toBe('')
  })

  it('defaultExpanded 让抽屉打开即放大，仍可还原回右栏', () => {
    render({ defaultExpanded: true })
    const aside = container.querySelector<HTMLElement>('[data-testid="sample-drawer"]')
    const button = container.querySelector<HTMLElement>('[data-testid="sample-drawer-expand"]')
    expect(aside?.getAttribute('data-expanded')).toBe('true')
    expect(aside?.classList.contains('is-expanded')).toBe(true)
    expect(button?.getAttribute('aria-label')).toBe('还原')
    toggle()
    expect(aside?.getAttribute('data-expanded')).toBe('false')
    expect(button?.getAttribute('aria-label')).toBe('放大')
    expect(aside?.style.position).toBe('')
  })

  it('放大与还原不重建子树：输入值与滚动位置都保留', () => {
    render()
    const aside = container.querySelector<HTMLElement>('[data-testid="sample-drawer"]')
    const body = aside?.querySelector<HTMLElement>('.detail-drawer-body')
    const input = container.querySelector<HTMLInputElement>('[data-testid="sample-input"]')
    act(() => {
      input!.value = '半句输入'
      body!.scrollTop = 120
    })
    toggle()
    expect(container.querySelector<HTMLInputElement>('[data-testid="sample-input"]')).toBe(input)
    expect(input?.value).toBe('半句输入')
    expect(body?.scrollTop).toBe(120)
    toggle()
    expect(container.querySelector<HTMLInputElement>('[data-testid="sample-input"]')).toBe(input)
    expect(input?.value).toBe('半句输入')
    expect(body?.scrollTop).toBe(120)
  })

  it('关闭后再次打开是收起的，词典与英文按钮文案齐全', () => {
    render()
    toggle()
    act(() => { root.unmount() })
    root = createRoot(container)
    render({ t: en })
    const aside = container.querySelector<HTMLElement>('[data-testid="sample-drawer"]')
    const button = container.querySelector<HTMLElement>('[data-testid="sample-drawer-expand"]')
    expect(aside?.getAttribute('data-expanded')).toBe('false')
    expect(aside?.style.position).toBe('')
    expect(button?.getAttribute('aria-label')).toBe('Maximize')
    expect(container.querySelector('[data-testid="sample-close"]')?.textContent).toBe('Close')
    toggle()
    expect(button?.getAttribute('aria-label')).toBe('Restore')
  })
})
