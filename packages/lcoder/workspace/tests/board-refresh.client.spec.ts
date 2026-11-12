// @vitest-environment jsdom
/**
 * 看板自动重读：有工作区且页面可见时每十秒读一次；隐藏停表，回前台与窗口
 * 重新获得焦点时立即补读一次；卸载后定时器与监听都撤掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { BOARD_REFRESH_MS, useBoardRefresh } from '../src/client/shell/board-refresh.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (document as { hidden?: boolean }).hidden
})

/** 在 jsdom 里伪造页面可见性；`afterEach` 负责撤掉。 */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

describe('看板自动重读', () => {
  it('有工作区且可见时每十秒读一次', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    renderHook(() => { useBoardRefresh(true, refresh) })

    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS - 1) })
    expect(refresh).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS) })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('没有工作区时不建定时器，也不挂监听', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    renderHook(() => { useBoardRefresh(false, refresh) })

    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS * 3) })
    fireEvent.focus(window)
    expect(refresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('页面隐藏时停表，隐藏中的 focus 不读', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    renderHook(() => { useBoardRefresh(true, refresh) })

    setHidden(true)
    fireEvent(document, new Event('visibilitychange'))
    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS * 2) })
    fireEvent.focus(window)
    expect(refresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('起手就隐藏的窗口不建定时器', () => {
    vi.useFakeTimers()
    setHidden(true)
    const refresh = vi.fn()
    renderHook(() => { useBoardRefresh(true, refresh) })

    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS * 2) })
    expect(refresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('回到前台立即补读一次，并恢复定时', () => {
    vi.useFakeTimers()
    setHidden(true)
    const refresh = vi.fn()
    renderHook(() => { useBoardRefresh(true, refresh) })

    setHidden(false)
    fireEvent(document, new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS) })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('窗口重新获得焦点立即读一次，下一次定时顺延', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    renderHook(() => { useBoardRefresh(true, refresh) })

    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS - 2_000) })
    fireEvent.focus(window)
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS - 1) })
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(1) })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('卸载后定时器与监听都撤掉', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    const { unmount } = renderHook(() => { useBoardRefresh(true, refresh) })

    unmount()
    act(() => { vi.advanceTimersByTime(BOARD_REFRESH_MS * 2) })
    fireEvent.focus(window)
    fireEvent(document, new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
