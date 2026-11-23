/**
 * 主窗可用的工作台停靠面。
 *
 * preload 一定提供这两个方法；注入的宿主替身可能没有，所以按结构读取一次，
 * 缺项时主窗不渲染停靠胶囊，而不是抛错挡住整个界面。
 */

import type { LcoderApi, PrototypeStudioDockAction, PrototypeStudioDockState } from '@maniu/desktop/contract'

/** 停靠面：订阅状态与恢复/关闭动作。 */
export interface StudioDockApi {
  readonly onPrototypeStudioDockState?: (listener: (state: PrototypeStudioDockState) => void) => () => void
  readonly controlPrototypeStudioDock?: (action: PrototypeStudioDockAction) => Promise<void>
}

/**
 * 取当前窗口的停靠面。
 * @returns 停靠面；没有 preload 时返回 undefined。
 */
export function studioDockApi(): StudioDockApi | undefined {
  if (!('lcoder' in window)) return undefined
  const host: LcoderApi = window.lcoder
  return host
}
