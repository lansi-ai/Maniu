/**
 * 人才配置到 preset 组合行的折叠。
 *
 * 组合规则：先取基础 preset 的声明行（深拷贝），人设覆盖基础行里的
 * `@deepseek-ai/dsh-persona`，人才列出的插件按同名覆盖基础行、不存在的追加。
 * 同名覆盖只改 `config`，基础行的 `id`、`isolate` 与分组结构保持不变。
 * 工具白名单与默认模型落到末尾的策略行：白名单在 Agent 创建时按
 * agent 作用域收窄工具面，模型写入新会话的模型选择；空 `tools` 表示不限制。
 */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { TalentConfigInput } from './types.ts'
import type { TalentPolicyConfig } from './policy.ts'

/** 人设插件包名。 */
export const PERSONA_PLUGIN = '@deepseek-ai/dsh-persona'

/** 人才运行时策略行插件包名。 */
export const TALENT_POLICY_PLUGIN = '@lcoder/kernel/talents-policy'

/** 策略行在 preset 内的行 id。 */
export const TALENT_POLICY_ROW = 'talent-policy'

type PluginRow = PresetDefinition['plugins'][number]

function replaceConfig(row: PluginRow, config: unknown): PluginRow {
  const next = { ...row }
  if (config === undefined) delete next.config
  else next.config = config
  return next
}

function upsert(rows: PluginRow[], name: string, config: unknown): void {
  const index = rows.findIndex(row => row.group !== true && row.name === name)
  if (index === -1) {
    rows.push(config === undefined ? { name } : { name, config })
    return
  }
  rows[index] = replaceConfig(rows[index] as PluginRow, config)
}

/**
 * 构造人才配置需要的运行时策略行；两项都没有时不生成。
 * @param talentId - 云端人才 id。
 * @param config - 已通过结构校验的人才配置。
 * @returns 策略行配置，或 undefined。
 */
export function talentPolicyConfig(talentId: string, config: TalentConfigInput): TalentPolicyConfig | undefined {
  const tools = config.tools !== undefined && config.tools.length > 0 ? [...config.tools] : undefined
  const model = config.model === undefined ? undefined : { provider: config.model.provider, modelId: config.model.modelId }
  if (tools === undefined && model === undefined) return undefined
  return { talentId, ...tools === undefined ? {} : { tools }, ...model === undefined ? {} : { model } }
}

/**
 * 把人才配置折叠成完整的 preset 组合行。
 * @param base - 基础 preset 的声明行；没有基础 preset 时为空数组。
 * @param talent - 人才 id 与已通过结构校验的配置。
 * @returns 新的组合行数组，不共享基础行或配置对象。
 */
export function composeTalentPlugins(
  base: readonly PluginRow[],
  talent: { readonly talentId: string; readonly config: TalentConfigInput },
): PresetDefinition['plugins'] {
  const rows = base.map(row => structuredClone(row))
  if (talent.config.persona !== undefined) upsert(rows, PERSONA_PLUGIN, { prefix: talent.config.persona })
  for (const plugin of talent.config.plugins ?? []) upsert(rows, plugin.name, plugin.config)
  const policy = talentPolicyConfig(talent.talentId, talent.config)
  if (policy !== undefined) rows.push({ id: TALENT_POLICY_ROW, name: TALENT_POLICY_PLUGIN, config: policy })
  return rows
}
