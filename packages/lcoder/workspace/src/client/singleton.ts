/**
 * 两个常驻调度角色的单例会话解析：配置号 → 同 preset 的现存会话 → 新建。
 *
 * 判定是纯函数，调用方只负责执行（切浮层、写回 `.spec/agents.yaml`、改名）。
 * 失效的判定只有一条：配置的会话不在当前工作区，或它的 `agentPreset` 对不上；
 * 两种情况都按未绑定处理，先找同 preset 的那条，找不到才新建——这正好覆盖
 * 换机器、删会话与编号过期三种情形。
 */
import type { LcoderWorkspaceKey } from './locales.ts'

/** 常驻角色；与 `.spec/agents.yaml` 的字段一一对应。 */
export type AgentRole = 'scheduler' | 'flow'

/** 一个常驻角色的装配事实与展示文案。 */
export interface AgentRoleDef {
  readonly role: AgentRole
  /** Agent preset 的 id，创建会话时按它指名。 */
  readonly preset: string
  /** `.spec/agents.yaml` 里的字段。 */
  readonly key: 'schedulerSession' | 'flowSession'
  /** 会话标题与顶栏入口都用的角色名。 */
  readonly titleKey: LcoderWorkspaceKey
}

/** 两个常驻角色；顺序即顶栏顺序。 */
export const AGENT_ROLES: Readonly<Record<AgentRole, AgentRoleDef>> = {
  scheduler: { role: 'scheduler', preset: 'maniu-scheduler', key: 'schedulerSession', titleKey: 'shell.scheduler' },
  flow: { role: 'flow', preset: 'maniu-flow', key: 'flowSession', titleKey: 'shell.flowAgent' },
}

/** 工作区里一条候选会话的已知事实。 */
export interface AgentSessionCandidate {
  readonly sessionId: string
  /** 会话投影里的 preset；读不到时为 undefined。 */
  readonly agentPreset?: string
}

/** 解析结果：复用一条现存会话，或按 preset 新建。 */
export type AgentSessionResolution =
  | { readonly kind: 'use'; readonly sessionId: string; readonly configured: boolean }
  | { readonly kind: 'create' }

/**
 * 解析某个常驻角色应使用哪条会话。
 *
 * 配置号还在、并且 preset 对得上（或读不到 preset）时直接复用；否则接受
 * 第一条 preset 相同的工作区会话；都没有才新建。读不到 preset 不否决配置号：
 * 投影可能还没加载，宁可用配置也不要在同一仓库里再造第二条。
 * @param role - 常驻角色。
 * @param configured - `.spec/agents.yaml` 里登记过的会话号。
 * @param live - 当前工作区的会话。
 * @returns 复用或新建。
 */
export function resolveAgentSession(
  role: AgentRole,
  configured: string | undefined,
  live: readonly AgentSessionCandidate[],
): AgentSessionResolution {
  const def = AGENT_ROLES[role]
  if (configured !== undefined) {
    const row = live.find(candidate => candidate.sessionId === configured)
    if (row !== undefined && (row.agentPreset === undefined || row.agentPreset === def.preset)) {
      return { kind: 'use', sessionId: row.sessionId, configured: true }
    }
  }
  const match = live.find(candidate => candidate.agentPreset === def.preset)
  if (match !== undefined) return { kind: 'use', sessionId: match.sessionId, configured: false }
  return { kind: 'create' }
}

/**
 * 只读地找一条现存会话，供顶栏显示入口状态；找不到返回 undefined，不触发新建。
 * @param role - 常驻角色。
 * @param configured - 配置的会话号。
 * @param live - 当前工作区的会话。
 * @returns 现存会话号或 undefined。
 */
export function liveAgentSession(
  role: AgentRole,
  configured: string | undefined,
  live: readonly AgentSessionCandidate[],
): string | undefined {
  const resolved = resolveAgentSession(role, configured, live)
  return resolved.kind === 'use' ? resolved.sessionId : undefined
}

/**
 * 会话标题要不要校正成角色名。
 * @param current - 会话当前标题；读不到时为 undefined。
 * @param expected - 角色名。
 * @returns 空标题或与角色名不同时为 true。
 */
export function titleNeedsFix(current: string | undefined, expected: string): boolean {
  return current === undefined || current !== expected
}
