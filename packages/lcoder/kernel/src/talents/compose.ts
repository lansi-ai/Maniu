/**
 * 人才配置到 preset 组合行的折叠。
 *
 * 组合规则：先取基础 preset 的声明行（深拷贝），人设覆盖基础行里的
 * `@deepseek-ai/dsh-persona`，人才列出的插件按同名覆盖基础行、不存在的追加。
 * 同名覆盖只改 `config`，基础行的 `id`、`isolate` 与分组结构保持不变。
 * `tools` / `model` / `budget` 本阶段不生成组合行，由服务层在结果里显式报告。
 */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { TalentConfigInput } from './types.ts'

/** 人设插件包名。 */
export const PERSONA_PLUGIN = '@deepseek-ai/dsh-persona'

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
 * 把人才配置折叠成完整的 preset 组合行。
 * @param base - 基础 preset 的声明行；没有基础 preset 时为空数组。
 * @param config - 已通过结构校验的人才配置。
 * @returns 新的组合行数组，不共享基础行或配置对象。
 */
export function composeTalentPlugins(
  base: readonly PluginRow[],
  config: TalentConfigInput,
): PresetDefinition['plugins'] {
  const rows = base.map(row => structuredClone(row))
  if (config.persona !== undefined) upsert(rows, PERSONA_PLUGIN, { prefix: config.persona })
  for (const plugin of config.plugins ?? []) upsert(rows, plugin.name, plugin.config)
  return rows
}
