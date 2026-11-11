// @vitest-environment jsdom
/**
 * 登录页标题栏自绘拖拽：pointerdown 记录起点、pointermove 跟随、三种收尾方式
 * 都发一次 end，标题栏上的交互件不参与拖拽。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useWindowDrag } from '../src/client/shell/window-drag.ts'
import type { DesktopWindowBridge, DesktopWindowDragRequest } from '../src/client/shell/window-chrome.ts'

afterEach(cleanup)

/** 记录每一次拖拽消息的窗口桥。 */
function bridgeOf(): { bridge: DesktopWindowBridge; requests: DesktopWindowDragRequest[] } {
  const requests: DesktopWindowDragRequest[] = []
  const bridge: DesktopWindowBridge = {
    command: async () => {},
    drag: async (request) => { requests.push(request) },
    state: async () => ({ maximized: false, fullscreen: false }),
    subscribe: () => () => {},
  }
  return { bridge, requests }
}

/** 只放一条登录页标题栏，验证处理器绑定后的行为。 */
function Titlebar({ bridge, enabled = true }: {
  readonly bridge: DesktopWindowBridge | undefined
  readonly enabled?: boolean
}): ReactNode {
  const drag = useWindowDrag(bridge, enabled)
  return (
    <header data-testid="bar" {...drag}>
      <button type="button">close</button>
    </header>
  )
}

/** 按下标题栏空白处。 */
function pressAt(screenX: number, screenY: number): void {
  fireEvent.pointerDown(screen.getByTestId('bar'), {
    button: 0, isPrimary: true, pointerId: 1, screenX, screenY,
  })
}

describe('登录页标题栏拖拽', () => {
  it('按下记录起点，移动跟随屏幕坐标，抬起收尾', () => {
    const { bridge, requests } = bridgeOf()
    render(<Titlebar bridge={bridge} />)
    pressAt(100, 50)
    fireEvent.pointerMove(screen.getByTestId('bar'), { pointerId: 1, screenX: 130, screenY: 80 })
    fireEvent.pointerUp(screen.getByTestId('bar'), { pointerId: 1 })
    expect(requests).toEqual([
      { phase: 'start', screenX: 100, screenY: 50 },
      { phase: 'move', screenX: 130, screenY: 80 },
      { phase: 'end' },
    ])
  })

  it('取消与窗口失焦都结束拖拽', () => {
    const { bridge, requests } = bridgeOf()
    render(<Titlebar bridge={bridge} />)
    pressAt(10, 20)
    fireEvent.pointerCancel(screen.getByTestId('bar'), { pointerId: 1 })
    expect(requests.at(-1)).toEqual({ phase: 'end' })

    requests.length = 0
    pressAt(10, 20)
    fireEvent(window, new Event('blur'))
    expect(requests.at(-1)).toEqual({ phase: 'end' })
  })

  it('按钮上按下、非主键、别的指针都不拖动窗口', () => {
    const { bridge, requests } = bridgeOf()
    render(<Titlebar bridge={bridge} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'close' }), {
      button: 0, isPrimary: true, pointerId: 1, screenX: 5, screenY: 5,
    })
    fireEvent.pointerDown(screen.getByTestId('bar'), {
      button: 2, isPrimary: true, pointerId: 1, screenX: 5, screenY: 5,
    })
    expect(requests).toEqual([])
    pressAt(10, 20)
    fireEvent.pointerMove(screen.getByTestId('bar'), { pointerId: 9, screenX: 90, screenY: 90 })
    expect(requests).toEqual([{ phase: 'start', screenX: 10, screenY: 20 }])
  })

  it('没有窗口桥或离开登录页时不发消息', () => {
    const { bridge, requests } = bridgeOf()
    const first = render(<Titlebar bridge={undefined} />)
    pressAt(10, 20)
    expect(requests).toEqual([])
    first.unmount()

    const second = render(<Titlebar bridge={bridge} enabled={false} />)
    pressAt(10, 20)
    expect(requests).toEqual([])
    second.unmount()
  })
})
