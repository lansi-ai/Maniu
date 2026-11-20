/**
 * `@maniu/kernel/prototype` 的 Cordis 入口：全局挂载原型宿主 Remote。
 *
 * 与云端控制器同档：它在第一条会话出现之前就注册 `prototype` 命名空间，
 * 供需求详情的网页样式预取、参考图上传与原型清除调用。网页抓取能力来自
 * 宿主已启用的 `ctx.web`（web-fetch-http 提供方）；拿不到时 `prefetch`
 * 返回显式失败，不静默降级。
 */
import type { Context } from '@deepseek-ai/cordis'

import { PrototypeController } from './controller.js'

/** 插件名，与 loader 行一致。 */
export const name = 'lcoder-prototype'

/**
 * 挂载原型 Remote 服务。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx: Context): void {
  new PrototypeController(ctx)
}
