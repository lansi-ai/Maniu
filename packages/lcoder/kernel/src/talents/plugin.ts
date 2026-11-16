/**
 * `@lcoder/kernel/talents` 的 Cordis 入口：全局挂载人才库宿主动态 preset 服务。
 *
 * 这个插件不归属任何角色 preset；它要在第一条会话出现之前就能接收人才列表，
 * 让新会话直接选到 `talent-<id>`。注册的动态 preset 由本服务持有，插件卸载时
 * 一并注销。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { AgentTalents } from './service.ts'

/** 插件名，与 loader 行一致。 */
export const name = 'lcoder-talents'

/** 依赖 preset registry、本机包清单、会话查询与 Session 存储。 */
export const inject = ['agentPresets', 'pluginPackages', 'sessionQuery', 'sessions']

/**
 * 挂载人才库服务并接管动态 preset 的注销。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx: Context): void {
  const service = new AgentTalents(ctx)
  ctx.effect(() => () => service.disposeTalents(), 'lcoder-talents: dynamic presets')
}
