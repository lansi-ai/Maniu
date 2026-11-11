/**
 * 登录页标题栏的自绘拖拽。
 *
 * 原生 `-webkit-app-region: drag` 不向页面派发鼠标事件，登录页标题栏上的悬停装饰
 * 因此失效；这里改为 pointerdown 捕获指针，把指针的屏幕坐标交给主进程，由主进程
 * 按按下时的窗口偏移移动窗口。pointerup、pointercancel、窗口失焦与离开登录页都收尾；
 * 标题栏上的按钮等交互件不参与拖拽。工作台顶栏仍用原生 drag 区。
 */
import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DesktopWindowBridge, DesktopWindowDragRequest } from './window-chrome.ts'

/** 标题栏上不触发拖拽的元素。 */
const INTERACTIVE = 'button, input, textarea, select, a, summary, [role="button"]'

/** 绑定到登录页标题栏的指针事件处理器。 */
export interface WindowDragHandlers {
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void
}

/**
 * 把标题栏上的指针拖拽翻译成主进程的窗口移动。
 * @param bridge - 桌面窗口桥；Web 与 macOS 没有它，处理器什么也不做。
 * @param enabled - 只在登录页启用；离开登录页时结束进行中的拖拽。
 * @returns 绑定到标题栏的指针事件处理器。
 */
export function useWindowDrag(bridge: DesktopWindowBridge | undefined, enabled: boolean): WindowDragHandlers {
  const active = useRef<{ element: HTMLElement; pointerId: number } | undefined>(undefined)

  const send = useCallback((request: DesktopWindowDragRequest): void => {
    const drag = bridge?.drag
    if (drag === undefined) return
    void drag.call(bridge, request).catch((error: unknown) => {
      console.error('LCoder window drag failed', error)
    })
  }, [bridge])

  const finish = useCallback((): void => {
    const current = active.current
    active.current = undefined
    if (current !== undefined && current.element.isConnected
      && typeof current.element.hasPointerCapture === 'function'
      && current.element.hasPointerCapture(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId)
    }
    send({ phase: 'end' })
  }, [send])

  useEffect(() => {
    if (!enabled) {
      if (active.current !== undefined) finish()
      return
    }
    window.addEventListener('blur', finish)
    return () => { window.removeEventListener('blur', finish) }
  }, [enabled, finish])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || event.button !== 0 || !event.isPrimary) return
    if (event.target instanceof Element && event.target.closest(INTERACTIVE) !== null) return
    const element = event.currentTarget
    active.current = { element, pointerId: event.pointerId }
    if (typeof element.setPointerCapture === 'function') {
      try {
        element.setPointerCapture(event.pointerId)
      } catch (error: unknown) {
        // jsdom 没有真实的指针序列；捕获失败不影响坐标换算。
        console.error('LCoder window drag: pointer capture unavailable', error)
      }
    }
    send({ phase: 'start', screenX: event.screenX, screenY: event.screenY })
  }, [enabled, send])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const current = active.current
    if (!enabled || current === undefined || current.pointerId !== event.pointerId) return
    send({ phase: 'move', screenX: event.screenX, screenY: event.screenY })
  }, [enabled, send])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (active.current?.pointerId !== event.pointerId) return
    finish()
  }, [finish])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (active.current?.pointerId !== event.pointerId) return
    finish()
  }, [finish])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
