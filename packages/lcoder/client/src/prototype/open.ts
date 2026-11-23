/**
 * 从渲染端打开原型工作室与独立预览窗口的共用入口。
 *
 * 工作室与预览都由主进程开窗，渲染端只传 HTML；宿主缺项时静默降级，由调用方决定提示文案。
 */

import type { LcoderApi } from '../contract.ts'
import type { StudioViewMode } from '../prototype-studio/bridge.ts'
import { studioBridge } from '../prototype-studio/bridge.ts'

/**
 * 取渲染端的宿主窄面；没有 preload 时返回 undefined。
 * @returns 宿主 API 或 undefined。
 */
export function lcoderBridge(): Partial<LcoderApi> | undefined {
  return 'lcoder' in window ? window.lcoder : undefined
}

/**
 * 把任意抛出物折成一句可读原因。
 * @param cause - 捕获到的抛出物。
 * @returns 错误消息或字符串化结果。
 */
export function causeText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 打开原型工作室的输入。 */
export interface StudioOpenInput {
  /** 工作室需要一个需求作为上下文。 */
  readonly requirementId: string
  /** 作用域会话号；没有项目时缺省。 */
  readonly sessionId?: string
  readonly html: string
  /** 打开前的正式版 HTML，供对比视图使用。 */
  readonly beforeHtml: string
  readonly mode?: StudioViewMode
}

/**
 * 在独立窗口中打开原型工作室。
 * @param input - 需求上下文、HTML 与视图模式。
 */
export async function openStudio(input: StudioOpenInput): Promise<void> {
  await studioBridge()?.openPrototypeStudio?.({
    requirementId: input.requirementId,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    html: input.html,
    beforeHtml: input.beforeHtml,
    mode: input.mode ?? 'split',
  })
}

/**
 * 在独立窗口中试玩一份原型 HTML。
 * @param html - 要预览的完整 HTML。
 */
export async function openPreview(html: string): Promise<void> {
  await lcoderBridge()?.openPrototypePreview?.(html)
}
