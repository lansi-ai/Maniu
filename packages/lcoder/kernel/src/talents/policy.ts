/**
 * `@lcoder/kernel/talents-policy`：人才 preset 末尾的运行时策略行。
 *
 * 这一行只由 {@link composeTalentPlugins} 生成，配置来自已校验的人才配置。
 * Agent 加入该 preset 时：工具白名单按 agent 作用域收窄工具面，未知工具让
 * 创建失败而不是静默放行；默认模型写进新会话的模型选择，恢复的历史会话保持
 * 它自己记录的模型。空白名单不生成策略，也就不限制。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-tools'
import { presetIdOf } from './validate.ts'

/** 插件名，与组合行里的包名一致。 */
export const name = 'lcoder-talent-policy'

/** 依赖 preset 注册表以确认 Agent 绑定的就是本行所属的 preset。 */
export const inject = ['agentPresets']

/** 策略行的静态配置。 */
export interface TalentPolicyConfig {
  /** 云端人才 id。 */
  readonly talentId: string
  /** 工具白名单；调用方保证非空且已通过服务层校验。 */
  readonly tools?: readonly string[]
  /** 人才默认模型。 */
  readonly model?: {
    /** 已注册的模型 provider。 */
    readonly provider: string
    /** provider 内的模型 id。 */
    readonly modelId: string
  }
}

function restrictTools(agent: Agent, talentId: string, tools: readonly string[]): void {
  try {
    agent.ctx.tools.restrict({ allow: [...tools] })
  } catch (error: unknown) {
    throw new Error(`talent ${talentId}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/**
 * 挂载策略行：按 Agent 创建事件施加白名单与默认模型。
 * @param ctx - preset 作用域上下文。
 * @param config - 由组合行固定的静态配置。
 */
export function apply(ctx: Context, config: TalentPolicyConfig): void {
  const presetId = presetIdOf(config.talentId)
  const tools = config.tools !== undefined && config.tools.length > 0 ? config.tools : undefined
  const model = config.model
  ctx.on('agent/created', ({ agent, source }) => {
    if (ctx.agentPresets.composedPreset(agent.ctx) !== presetId) return
    if (tools !== undefined) restrictTools(agent, config.talentId, tools)
    // 恢复的历史会话已经记有模型选择，人才默认值只定新会话。
    if (model !== undefined && source !== 'resume') {
      agent.model.select({ provider: model.provider, model: model.modelId })
    }
  })
}
