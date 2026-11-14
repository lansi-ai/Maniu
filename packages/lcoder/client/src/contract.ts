/** 渲染端看到的窄 IPC 契约：类型与通道定义来自主进程包，避免两份漂移。 */

import type { LcoderApi } from './index.ts'

export type * from './index.ts'

declare global {
  interface Window {
    readonly lcoder: LcoderApi
  }
}
