// @vitest-environment jsdom
/** 窗口透明边拖拽条：三条 aria-hidden 空轨道，只补命中区域，不包住也不需要页面控件。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowGutter } from '../src/shell/window-gutter.tsx'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

function rails(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="window-gutter-"]'))
}

describe('WindowGutter', () => {
  it('renders one empty drag rail per window edge', () => {
    act(() => { root.render(<WindowGutter />) })
    const edges = rails().map(node => node.dataset.edge)
    expect(edges).toEqual(['top', 'left', 'right'])
    for (const rail of rails()) {
      expect(rail.className).toBe('window-gutter')
      expect(rail.getAttribute('aria-hidden')).toBe('true')
      expect(rail.childElementCount).toBe(0)
      expect(rail.textContent).toBe('')
    }
  })

  it('leaves page controls as siblings that still receive clicks', () => {
    const onClick = vi.fn()
    act(() => {
      root.render(
        <>
          <WindowGutter />
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
})
