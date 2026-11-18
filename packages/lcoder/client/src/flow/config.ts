/** 流程配置的渲染端模型：预制回落、节点查找、岗位到 preset 的折算、过审配齐判定与 `/flow_save` 序列化。 */

import type { MessageKey, Translate } from '../locale.ts'
import type { FlowConfigRow, FlowNodeKind, FlowNodeRow, JobRoleRow, RequirementReviewRow } from '../spec/rows.ts'
import { isBuiltinTalentPreset } from '../talents/model.ts'

/** 节点的固定展示与执行顺序；配置文件里的节点按这个顺序归一。 */
export const FLOW_NODE_ORDER: readonly FlowNodeKind[] = ['intake', 'review', 'revise', 'split']

/** 内核内置预制流程的渲染端同源副本；无 flow.yaml 时各页走它。 */
const PRESET_BY_KIND: Readonly<Record<FlowNodeKind, FlowNodeRow>> = {
  intake: { node: 'intake', roles: ['maniu-intake'], auto: false },
  review: { node: 'review', roles: ['maniu-pm'], auto: true },
  revise: { node: 'revise', roles: ['maniu-intake'], auto: false },
  split: { node: 'split', roles: ['maniu-manager'], auto: false },
}

/** 预制流程的节点清单，按固定顺序。 */
export const PRESET_FLOW_NODES: readonly FlowNodeRow[] = FLOW_NODE_ORDER.map(kind => PRESET_BY_KIND[kind])

/** 配置节可选的内置角色 preset；与装配层十个角色 preset 同源。 */
export const BUILTIN_FLOW_PRESETS: readonly string[] = [
  'maniu-intake',
  'maniu-architect',
  'maniu-pm',
  'maniu-dev',
  'maniu-git',
  'maniu-ops',
  'maniu-review',
  'maniu-scheduler',
  'maniu-flow',
  'maniu-manager',
]

/** 内置 preset 的词典回退键；名册显示名优先于它。 */
export const PRESET_ROLE_KEY: Readonly<Record<string, MessageKey>> = {
  'maniu-intake': 'intake.roleName',
  'maniu-architect': 'op.roleName.architect',
  'maniu-pm': 'op.roleName.pm',
  'maniu-dev': 'op.roleName.dev',
  'maniu-git': 'op.roleName.git',
  'maniu-ops': 'op.roleName.ops',
  'maniu-review': 'op.roleName.review',
  'maniu-scheduler': 'op.roleName.scheduler',
  'maniu-flow': 'op.roleName.flow',
  'maniu-manager': 'op.roleName.manager',
}

/**
 * 归一一份流程配置成四节点清单：缺文件的节点用预制补齐。
 * @param flow - 投影里的 flow.yaml；缺省表示没有配置。
 * @returns 按固定顺序的四个节点。
 */
export function flowNodesOf(flow: FlowConfigRow | null | undefined): readonly FlowNodeRow[] {
  return FLOW_NODE_ORDER.map(kind => flow?.nodes.find(node => node.node === kind) ?? PRESET_BY_KIND[kind])
}

/**
 * 取一类节点的配置；没有配置时用预制节点。
 * @param flow - 投影里的 flow.yaml。
 * @param kind - 节点类型。
 * @returns 该节点的岗位与衔接开关。
 */
export function flowNodeOf(flow: FlowConfigRow | null | undefined, kind: FlowNodeKind): FlowNodeRow {
  return flow?.nodes.find(node => node.node === kind) ?? PRESET_BY_KIND[kind]
}

/**
 * 岗位 id 折算成发起会话用的 preset：内置 preset 原样，名册岗位用继承角色的 preset。
 * @param roleId - 配置里的岗位 id。
 * @param roster - 投影里的岗位名册。
 * @returns preset id；解析不了时为 undefined，由调用方回退节点默认 preset。
 */
export function presetOfRole(roleId: string, roster: readonly JobRoleRow[]): string | undefined {
  if (BUILTIN_FLOW_PRESETS.includes(roleId)) return roleId
  const job = roster.find(entry => entry.id === roleId)
  return job === undefined ? undefined : `maniu-${job.inherits}`
}

/** 内置角色 id 集合；与内置 preset 清单同源。 */
const BUILTIN_ROLE_IDS: ReadonlySet<string> = new Set(BUILTIN_FLOW_PRESETS.map(id => id.slice('maniu-'.length)))

/**
 * preset 的内置根：`maniu-<内置角色>` 取角色后缀；其余 preset 没有内置根。
 * @param presetId - 会话或署名里的 preset id。
 * @returns 内置角色 id；不是内置 preset 时为 undefined。
 */
export function presetRoot(presetId: string): string | undefined {
  if (!presetId.startsWith('maniu-')) return undefined
  const role = presetId.slice('maniu-'.length)
  return BUILTIN_ROLE_IDS.has(role) ? role : undefined
}

/**
 * 配置条目的内置根：内置 preset 取其角色，名册岗位取 inherits。
 * @param roleId - 配置里的岗位 id。
 * @param roster - 投影里的岗位名册。
 * @returns 内置角色 id；解析不了时为 undefined。
 */
export function entryRoot(roleId: string, roster: readonly JobRoleRow[]): string | undefined {
  return presetRoot(roleId) ?? roster.find(entry => entry.id === roleId)?.inherits
}

/**
 * 配齐过审还缺哪些评审岗位：与 kernel `requirement_approve` 同口径——
 * 有 flow.yaml 且配置了 review 节点时，按配置顺序为每个条目消费一轮根相等的署名评审，
 * 一轮只消费给一个条目；无署名或非内置 preset 的轮不可消费。没有配置文件时不要求配齐。
 * @param flow - 投影里的 flow.yaml；缺省表示没有配置。
 * @param roster - 投影里的岗位名册。
 * @param reviews - 需求已有的评审轮次。
 * @returns 无轮可消费的岗位 id，按配置顺序；没有 review 节点或已配齐时为空数组。
 */
export function missingReviewRoles(
  flow: FlowConfigRow | null | undefined,
  roster: readonly JobRoleRow[],
  reviews: readonly RequirementReviewRow[],
): string[] {
  const review = flow?.nodes.find(node => node.node === 'review')
  if (review === undefined) return []
  const pool = reviews
    .flatMap((entry) => {
      const signRoot = entry.role === undefined ? undefined : presetRoot(entry.role)
      return signRoot === undefined ? [] : [{ round: entry.round, root: signRoot }]
    })
    .sort((left, right) => left.round - right.round)
  const consumed = new Set<number>()
  const missing: string[] = []
  for (const id of review.roles) {
    const root = entryRoot(id, roster)
    const match = pool.find(item => !consumed.has(item.round) && item.root === root)
    if (match === undefined) missing.push(id)
    else consumed.add(match.round)
  }
  return missing
}

/**
 * 序列化成 `/flow_save` 命令行。
 * @param nodes - 完整节点配置。
 * @returns 可直接经命令通道执行的整行。
 */
export function flowSaveLine(nodes: readonly FlowNodeRow[]): string {
  return `/flow_save ${JSON.stringify({ nodes })}`
}

/** 岗位显示名所需的来源：名册显示名、岗位名册与取词函数。 */
export interface FlowRoleLabelContext {
  readonly presetNames?: Readonly<Record<string, string>>
  readonly roster: readonly JobRoleRow[]
  readonly t: Translate
}

/**
 * 岗位显示名：preset 名册优先，其次词典回退与名册岗位名，最后原样 id。
 * @param id - 岗位 id（preset 或名册岗位）。
 * @param ctx - 显示名来源。
 * @returns 可直接渲染的名字。
 */
export function flowRoleLabel(id: string, ctx: FlowRoleLabelContext): string {
  const named = ctx.presetNames?.[id]
  if (named !== undefined) return named
  const key = PRESET_ROLE_KEY[id]
  if (key !== undefined) return ctx.t(key)
  return ctx.roster.find(entry => entry.id === id)?.name ?? id
}

/**
 * 岗位来源标注：内置 preset 为内置岗位，名册岗位与其余为自定义岗位。
 * @param id - 岗位 id。
 * @param ctx - 取词函数。
 * @returns 来源文案。
 */
export function flowRoleSource(id: string, t: Translate): string {
  return t(isBuiltinTalentPreset(id) ? 'op.sourceBuiltin' : 'op.sourceCustom')
}
