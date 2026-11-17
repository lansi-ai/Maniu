/**
 * 人才配置到 preset 组合行的折叠。
 *
 * 组合规则：先取基础 preset 的声明行（深拷贝），人设覆盖基础行里的
 * `@deepseek-ai/dsh-persona`，人才列出的插件按同名覆盖基础行、不存在的追加。
 * 同名行无论位于顶层还是分组内都算同一行：分组内的行就地改 `config`，
 * 不另加一条顶层行，避免同一服务在挂载时注册两次。同名覆盖只改 `config`，
 * 基础行的 `id`、`isolate` 与分组结构保持不变。
 * 工具白名单与默认模型落到末尾的策略行：白名单在 Agent 创建时按
 * agent 作用域收窄工具面，模型写入新会话的模型选择；空 `tools` 表示不限制。
 */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { TalentConfigInput } from './types.ts'
import type { TalentPolicyConfig } from './policy.ts'

/** 人设插件包名。 */
export const PERSONA_PLUGIN = '@deepseek-ai/dsh-persona'

/** 人才运行时策略行插件包名。 */
export const TALENT_POLICY_PLUGIN = '@maniu/kernel/talents-policy'

/** 策略行在 preset 内的行 id。 */
export const TALENT_POLICY_ROW = 'talent-policy'

type PluginRow = PresetDefinition['plugins'][number]

/** 一个可替换的行位置；跨组合查找列内元素时用。 */
interface RowSlot {
  readonly rows: PluginRow[]
  readonly index: number
}

function replaceConfig(row: PluginRow, config: unknown): PluginRow {
  const next = { ...row }
  if (config === undefined) delete next.config
  else next.config = config
  return next
}

/** 分组行的子行；非分组行返回 undefined。 */
function nestedRows(row: PluginRow): PluginRow[] | undefined {
  if (row.group !== true || !Array.isArray(row.config)) return undefined
  return row.config as PluginRow[]
}

/** 先找同层、再下探分组，同一层按声明顺序，保证组合内的同名插件只留一行。 */
function locate(rows: readonly PluginRow[], matches: (row: PluginRow) => boolean): RowSlot | undefined {
  for (const [index, row] of rows.entries()) {
    if (row.group !== true && matches(row)) return { rows: rows as PluginRow[], index }
  }
  for (const row of rows) {
    const nested = nestedRows(row)
    if (nested === undefined) continue
    const found = locate(nested, matches)
    if (found !== undefined) return found
  }
  return undefined
}

function upsert(rows: PluginRow[], name: string, config: unknown): void {
  const existing = locate(rows, row => row.name === name)
  if (existing === undefined) {
    rows.push(config === undefined ? { name } : { name, config })
    return
  }
  existing.rows[existing.index] = replaceConfig(existing.rows[existing.index] as PluginRow, config)
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
