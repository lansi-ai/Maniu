/**
 * `@maniu/kernel/talents` 的 Cordis 入口：全局挂载人才库宿主动态 preset 服务。
 *
 * 这个插件不归属任何角色 preset；它要在第一条会话出现之前就能接收人才列表，
 * 让新会话直接选到 `talent-<id>`。注册的动态 preset 由本服务持有，插件卸载时
 * 一并注销。模型请求发往云端时，这里按会话把人才归属头交给网关。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools'
import { CLOUD_USER_ROUTE } from '../cloud/types.ts'
import { TALENT_ID_HEADER, TALENT_SESSION_HEADER } from './headers.ts'
import { AgentTalents } from './service.ts'

/** 插件名，与 loader 行一致。 */
export const name = 'lcoder-talents'

/** 依赖 preset registry、本机包清单、工具面、会话查询与 Session 存储。 */
export const inject = ['agentPresets', 'pluginPackages', 'tools', 'sessionQuery', 'sessions']

/**
 * 挂载人才库服务并接管动态 preset 的注销。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx: Context): void {
  const service = new AgentTalents(ctx)
  ctx.effect(() => () => service.disposeTalents(), 'lcoder-talents: dynamic presets')
  ctx.effect(() => ctx.on('llm-pi-ai/request-headers', (request, headers, next) => {
    if (request.provider === CLOUD_USER_ROUTE && request.sessionId !== undefined) {
      headers.set(TALENT_SESSION_HEADER, request.sessionId)
      const talentId = service.talentIdForSession(request.sessionId)
      if (talentId !== undefined) headers.set(TALENT_ID_HEADER, talentId)
    }
    return next()
  }), 'lcoder-talents: gateway attribution headers')
}
