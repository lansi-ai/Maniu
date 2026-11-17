/** 主窗口最大化/全屏实况的订阅面。 */

import { useEffect, useState } from 'react'
import type { WindowStateInfo } from '@maniu/desktop/contract'

/**
 * 订阅主窗口状态；挂载时补读一次。
 * @returns 最大化与全屏实况。
 */
export function useWindowState(): WindowStateInfo {
  const [state, setState] = useState<WindowStateInfo>({ maximized: false, fullscreen: false })
  useEffect(() => {
    const off = window.lcoder.windowState(setState)
    void window.lcoder.windowStateNow().then(setState).catch(() => undefined)
    return off
  }, [])
  return state
}
