/**
 * 看板自动重读：`.spec` 是外部随时可改的文件，看板自己跟上，不等下一次操作。
 *
 * 有工作区且页面可见时每 {@link BOARD_REFRESH_MS} 毫秒重读一次；页面隐藏时停表，
 * 回到前台或窗口重新获得焦点时立即补读一次。重读走外壳既有的 `setReload` 路径，
 * 读取失败仍由投影 effect 的 `setProblems` 说明。
 */
import { useEffect } from 'react'

/** 自动重读间隔：十秒足够看见外部改动，也不至于一直读盘。 */
export const BOARD_REFRESH_MS = 10_000

/**
 * 按间隔与前台状态触发看板重读。
 * @param enabled - 是否启用；没有工作区时为 false，不建定时器也不挂监听。
 * @param refresh - 重读动作；引用变化会重建定时器与监听，调用方用稳定回调。
 */
export function useBoardRefresh(enabled: boolean, refresh: () => void): void {
  useEffect(() => {
    if (!enabled) return
    let timer: number | null = null
    const stop = (): void => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const start = (): void => {
      if (timer !== null) return
      timer = window.setInterval(refresh, BOARD_REFRESH_MS)
    }
    /** 手动重读与定时器共用同一次读取，并把下一次定时往后推，避免紧挨着读两遍。 */
    const reread = (): void => {
      stop()
      refresh()
      start()
    }
    const onVisibility = (): void => {
      if (document.hidden) {
        stop()
        return
      }
      reread()
    }
    const onFocus = (): void => {
      if (document.hidden) return
      reread()
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, refresh])
}
