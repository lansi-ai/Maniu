// @vitest-environment jsdom
/** 窗口拖拽层：三条 aria-hidden 空轨道加标题栏拖拽垫，只补命中区域，不包住也不需要页面控件。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowGutter } from '../src/shell/window-gutter.tsx'

/** jsdom 没有 ResizeObserver；记录回调以便手动触发尺寸变化。 */
class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = []

  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this)
  }

  observe(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: FakeResizeObserver })
  FakeResizeObserver.instances.length = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  document.querySelectorAll('.titlebar, .titlebar-tools').forEach((node) => { node.remove() })
})

function rails(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="window-gutter-"]'))
}

function pad(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="titlebar-pad"]')
}

function fakeTitlebar(barRect: DOMRect, toolsRect: DOMRect): { bar: HTMLElement; tools: HTMLElement } {
  const bar = document.createElement('div')
  bar.className = 'titlebar'
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(barRect)
  const tools = document.createElement('div')
  tools.className = 'titlebar-tools'
  vi.spyOn(tools, 'getBoundingClientRect').mockReturnValue(toolsRect)
  document.body.append(bar, tools)
  return { bar, tools }
}

/** 触发最近一次挂载的尺寸观察回调。 */
function resized(): void {
  const observer = FakeResizeObserver.instances.at(-1)
  expect(observer).toBeDefined()
  act(() => { observer?.callback() })
}

describe('WindowGutter', () => {
  it('renders one empty drag rail per window edge', () => {
    act(() => { root.render(<WindowGutter maximized={false} titlebar={false} />) })
    const edges = rails().map(node => node.dataset.edge)
    expect(edges).toEqual(['top', 'left', 'right'])
    for (const rail of rails()) {
      expect(rail.className).toBe('window-gutter')
      expect(rail.getAttribute('aria-hidden')).toBe('true')
      expect(rail.childElementCount).toBe(0)
      expect(rail.textContent).toBe('')
    }
  })

  it('switches to the maximized class when the window is maximized', () => {
    act(() => { root.render(<WindowGutter maximized titlebar={false} />) })
    for (const rail of rails()) {
      expect(rail.className).toBe('window-gutter is-maximized')
      expect(rail.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('leaves page controls as siblings that still receive clicks', () => {
    const onClick = vi.fn()
    act(() => {
      root.render(
        <>
          <WindowGutter maximized={false} titlebar={false} />
          <button type="button" data-testid="page-control" onClick={onClick}>打开</button>
        </>,
      )
    })
    const button = container.querySelector<HTMLElement>('[data-testid="page-control"]')
    expect(button).not.toBeNull()
    for (const rail of rails()) {
      expect(rail.contains(button)).toBe(false)
      expect(rail.querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull()
    }
    act(() => { (button as HTMLElement).click() })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('skips the pad without a titlebar', () => {
    act(() => { root.render(<WindowGutter maximized={false} titlebar={false} />) })
    expect(pad()).toBeNull()

    act(() => { root.render(<WindowGutter maximized={false} titlebar />) })
    expect(pad()).toBeNull()
  })

  it('adds the titlebar pad ending before the tools area', () => {
    fakeTitlebar(new DOMRect(12, 12, 1256, 46), new DOMRect(1000, 12, 268, 34))
    act(() => { root.render(<WindowGutter maximized={false} titlebar />) })
    const node = pad()
    expect(node).not.toBeNull()
    expect(node?.getAttribute('aria-hidden')).toBe('true')
    expect(node?.childElementCount).toBe(0)
    expect(node?.style.top).toBe('12px')
    expect(node?.style.left).toBe('12px')
    expect(node?.style.width).toBe('986px')
    expect(node?.style.height).toBe('46px')
  })

  it('recomputes when the tools area shrinks', () => {
    const { tools } = fakeTitlebar(new DOMRect(12, 12, 1256, 46), new DOMRect(1000, 12, 268, 34))
    act(() => { root.render(<WindowGutter maximized={false} titlebar />) })
    expect(pad()?.style.width).toBe('986px')

    vi.spyOn(tools, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 12, 368, 34))
    resized()
    expect(pad()?.style.width).toBe('886px')
  })

  it('follows the titlebar into the maximized geometry', () => {
    const { bar, tools } = fakeTitlebar(new DOMRect(12, 12, 1256, 46), new DOMRect(1000, 12, 268, 34))
    act(() => { root.render(<WindowGutter maximized={false} titlebar />) })
    expect(pad()?.style.width).toBe('986px')

    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 2548, 46))
    vi.spyOn(tools, 'getBoundingClientRect').mockReturnValue(new DOMRect(2300, 0, 240, 34))
    resized()
    expect(pad()?.style.top).toBe('0px')
    expect(pad()?.style.left).toBe('0px')
    expect(pad()?.style.width).toBe('2298px')
  })
})

describe('拖拽区滤镜红线', () => {
  it('拖拽层与标题栏都不加背景滤镜，作答弹窗也不把滤镜挂到它们身上', () => {
    const index = readFileSync(resolve(process.cwd(), 'packages/lcoder/client/src/index.css'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'packages/lcoder/client/src/styles.css'), 'utf8')
    expect(index).toContain('.window-gutter,\n  .titlebar-pad,\n  .gate-drag {')
    expect(index).toContain('backdrop-filter: none;')
    for (const selector of ['.window-gutter', '.titlebar-pad', '.gate-drag', '.titlebar']) {
      expect(styles).toContain(`${selector} {`)
      expect(styles).toContain('backdrop-filter: none;')
    }
    expect(styles).toContain('.pending-dialog {')
    expect(styles).toContain('backdrop-filter: blur(20px) saturate(140%);')
    expect(styles).not.toContain('.pending-layer')
  })
})
