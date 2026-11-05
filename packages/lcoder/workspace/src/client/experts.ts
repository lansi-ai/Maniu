/**
 * 专家名册的读法：把装配层声明的 Agent preset 说成用户看得懂的「专家」，并从声明里取出提示词。
 *
 * 数据源只有两个，都是宿主已有的远程面：`agentPresets.list` 给名册（id、名称、描述、顺序、
 * 装载失败原因），`agentPresets.read` 给那份 preset 的子插件清单 YAML。提示词不是单独存的字段，
 * 它是清单里 persona 那一行的 `config.prefix`，所以这里只做解析，不另存一份副本——
 * 另存就会有两处真值，装配改了而面板没改。
 */
import { parse as parseYaml } from 'yaml'

/** 名册里的一位专家；`broken` 有值表示这棵 preset 树装载失败。 */
export interface ExpertRow {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly order?: number
  readonly broken?: string
}

/** 一位专家的提示词读取结果。 */
export interface ExpertPrompt {
  readonly id: string
  /** 声明清单原文（宿主按 Loader 自己的方言 dump 出来的）。 */
  readonly document: string
  /** persona 的 prefix；这份声明没有 persona 行时为 null。 */
  readonly prompt: string | null
}

/** 名册行的最小输入形状；远程返回的行了这里用到的字段即可，测试可直接造数据。 */
export interface RosterRow {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly broken?: string
}

/**
 * 把远程名册整理成按 `order` 排序的专家行。
 *
 * 排序按装配声明的 order，没有 order 的排在后面按 id 比——上游 standard 等 preset 也在名册里，
 * 这里不筛掉它们：用户问的是「系统内置了多少个专家」，答案必须是宿主真实注册的全部。
 * @param rows - `agentPresets.list` 返回的行。
 * @returns 排好序的专家行；名称缺省时回落到 id。
 */
export function expertsFromRoster(rows: readonly RosterRow[]): readonly ExpertRow[] {
  return rows
    .map(row => ({
      id: row.id,
      name: row.name ?? row.id,
      ...(row.description === undefined ? {} : { description: row.description }),
      ...(row.order === undefined ? {} : { order: row.order }),
      ...(row.broken === undefined ? {} : { broken: row.broken }),
    }))
    .sort((left, right) => {
      const order = (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
      return order !== 0 ? order : left.id.localeCompare(right.id)
    })
}

/**
 * 从一份 preset 声明里取 persona 的提示词。
 *
 * 认行按 `id: persona` 或模块名以 `/dsh-persona` 结尾，两种写法在装配源里都出现过。
 * 读不懂的 YAML、没有 persona 行、prefix 不是字符串，都返回 null 而不抛——
 * 面板要能继续显示声明原文，把「没有提示词」和「解析失败」这两件事分开说。
 * @param document - `agentPresets.read` 返回的声明清单。
 * @returns persona 的 prefix；取不到时为 null。
 */
export function personaPromptOf(document: string): string | null {
  let parsed: unknown
  try {
    parsed = parseYaml(document)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as { id?: unknown; name?: unknown; config?: unknown }
    const isPersona = row.id === 'persona'
      || (typeof row.name === 'string' && row.name.endsWith('/dsh-persona'))
    if (!isPersona) continue
    const config = row.config
    if (typeof config !== 'object' || config === null) return null
    const prefix = (config as { prefix?: unknown }).prefix
    return typeof prefix === 'string' && prefix !== '' ? prefix : null
  }
  return null
}
