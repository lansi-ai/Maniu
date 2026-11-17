/**
 * `.spec/flow.yaml` 的读写口：流程节点与岗位配置的唯一落盘实现。
 *
 * 三条口径：
 *   1. **缺文件走内置预制流程。** 旧项目没有 `flow.yaml` 照常解析与运行；
 *      预制流程是内核事实（`PRESET_FLOW`），不靠 schema 的空对象兜底。
 *   2. **岗位必须可解析。** 每项 role 是内置 preset（`maniu-<内置角色>`）或
 *      `roles.yaml` 岗位 id；读盘与写盘都查，解析不了当场响，不静默跳过。
 *   3. **只有人能写。** 落盘口只被人机命令 `/flow_save` 调用，模型工具面不含它。
 *
 * 每次调用都重读磁盘：配置改了，下一次编排与过审判断立刻按新配置走。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { ZodError } from 'zod'

import { FlowConfig } from '../schema/spec.js'
import type { RequirementReview } from '../schema/spec.js'
import { isBuiltinRole } from '../schema/roles.js'
import { loadRoles, rolesPath } from './role-store.js'

/** 配置相对规格根的位置。 */
export const FLOW_CONFIG_FILE = 'flow.yaml'

/**
 * 流程配置文件路径。
 * @param root - 规格根（`.spec`）。
 * @returns 配置文件的绝对或相对路径；文件不存在时也返回这个位置。
 */
export function flowConfigPath(root: string): string {
  return join(root, FLOW_CONFIG_FILE)
}

/** 缺文件时的内置预制流程：评审自动衔接，其余节点人工触发。 */
export const PRESET_FLOW: FlowConfig = FlowConfig.parse({
  nodes: [
    { node: 'intake', roles: ['maniu-intake'], auto: false },
    { node: 'review', roles: ['maniu-pm'], auto: true },
    { node: 'revise', roles: ['maniu-intake'], auto: false },
    { node: 'split', roles: ['maniu-manager'], auto: false },
  ],
})

/** 内置 preset 的固定前缀；与装配层的十个角色 preset 同源。 */
const BUILTIN_PRESET_PREFIX = 'maniu-'

/** 一次读取的结果，连同来源事实。 */
export interface FlowConfigSnapshot {
  readonly config: FlowConfig
  /** `preset` 表示没有文件，走内置预制流程；过审配齐门槛只对 `file` 生效。 */
  readonly source: 'preset' | 'file'
  readonly path: string
}

/**
 * 读流程配置；文件不存在时返回内置预制流程。
 * @param root - 规格根（`.spec`）。
 * @returns 配置与来源。
 * @throws 文件读不懂、形状非法或岗位解析不了时抛出——配错要当场响。
 */
export function loadFlowConfig(root: string): FlowConfigSnapshot {
  const path = flowConfigPath(root)
  if (!existsSync(path)) return { config: PRESET_FLOW, source: 'preset', path }

  let doc: unknown
  try {
    doc = parseYaml(readFileSync(path, 'utf8'))
  } catch (error: unknown) {
    throw new Error(`流程配置不是能读的 YAML（${path}）：${errorMessage(error)}`)
  }
  const config = parseFlowConfig(doc, path)
  assertRolesResolvable(root, config, path)
  return { config, source: 'file', path }
}

/**
 * 写流程配置：先过 schema 与岗位解析，再整文件落盘。
 * @param root - 规格根（`.spec`）。
 * @param input - 完整节点配置；来自命令的 JSON，尚未校验。
 * @returns 写入的路径与校验后的配置。
 * @throws 形状非法或岗位解析不了时抛出，不落盘。
 */
export function saveFlowConfig(root: string, input: unknown): { readonly path: string; readonly config: FlowConfig } {
  const path = flowConfigPath(root)
  const parsed = parseFlowConfig(input, path)
  assertRolesResolvable(root, parsed, path)
  writeFileSync(path, stringifyYaml(parsed), 'utf8')
  return { path, config: parsed }
}

/**
 * 恢复预制流程：删除配置文件，回到内置预制。
 * @param root - 规格根（`.spec`）。
 * @returns true 表示删掉了一份已有配置；false 表示本来就没有文件。
 */
export function resetFlowConfig(root: string): boolean {
  const path = flowConfigPath(root)
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

/**
 * 配齐过审还缺哪些评审署名：review 节点每个配置岗位都要有一轮署该岗位的评审。
 * @param config - 流程配置。
 * @param reviews - 需求已有的评审轮次。
 * @returns 缺署名的岗位 id，按配置顺序；没有 review 节点或已配齐时为空数组。
 */
export function missingReviewSignatures(config: FlowConfig, reviews: readonly RequirementReview[]): string[] {
  const review = config.nodes.find(node => node.node === 'review')
  if (review === undefined) return []
  return review.roles.filter(id => !reviews.some(entry => entry.role === id))
}

/** 按 schema 解析并把错误说成人话。 */
function parseFlowConfig(doc: unknown, path: string): FlowConfig {
  try {
    return FlowConfig.parse(doc)
  } catch (error: unknown) {
    throw new Error(`流程配置非法（${path}）：${configErrorMessage(error)}`)
  }
}

/** 逐项查岗位可解析；解析不了把 id 与出处一起点出来。 */
function assertRolesResolvable(root: string, config: FlowConfig, path: string): void {
  let roles: ReturnType<typeof loadRoles>
  try {
    roles = loadRoles(root)
  } catch (error: unknown) {
    throw new Error(`读 ${rolesPath(root)} 失败：${errorMessage(error)}`)
  }
  const known = new Set(roles.map(entry => entry.id))
  const unknown: string[] = []
  for (const node of config.nodes) {
    for (const id of node.roles) {
      const preset = id.startsWith(BUILTIN_PRESET_PREFIX) && isBuiltinRole(id.slice(BUILTIN_PRESET_PREFIX.length))
      if (!preset && !known.has(id)) unknown.push(id)
    }
  }
  if (unknown.length > 0) {
    throw new Error(`流程配置里的岗位解析不了（${path}）：${unknown.join('、')}；只能是内置 preset（maniu-<角色>）或 ${rolesPath(root)} 里的岗位`)
  }
}

/** schema 错误的人话：逐条带字段路径。 */
function configErrorMessage(error: unknown): string {
  if (!(error instanceof ZodError)) return errorMessage(error)
  return error.issues.map((issue) => {
    const where = issue.path.length === 0 ? '' : `${issue.path.join('.')}：`
    return `${where}${issue.message}`
  }).join('；')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
