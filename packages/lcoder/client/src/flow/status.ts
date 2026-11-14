/** `/flow_status` 的 JSON 回执 → 可展示的流程判定。 */

/** 流程动作。 */
export type FlowAction = 'draft' | 'contract' | 'sign' | 'implement' | 'verify' | 'close' | 'commit' | 'external' | 'stop'

/** 动作模式。 */
export type FlowMode = 'auto' | 'manual' | 'none'

/** 一条挡住原因。 */
export interface FlowBlocker {
  readonly kind: string
  readonly detail: string
}

/** 一次流程判定。 */
export interface FlowDecision {
  readonly action: FlowAction
  readonly taskId: string | null
  readonly mode: FlowMode
  readonly reason: string
  readonly blockers: readonly FlowBlocker[]
}

/** 一条任务的计划。 */
export interface FlowTaskPlan {
  readonly id: string
  readonly state: string
  readonly dependsOn: readonly string[]
  readonly decision: FlowDecision
  readonly startable: boolean
}

/** 一次完整求值。 */
export interface FlowStatus {
  readonly decision: FlowDecision
  readonly tasks: readonly FlowTaskPlan[]
  readonly policySource: string
  readonly policyPath: string
  readonly known: readonly string[]
}

const ACTIONS = new Set<string>(['draft', 'contract', 'sign', 'implement', 'verify', 'close', 'commit', 'external', 'stop'])
const MODES = new Set<string>(['auto', 'manual', 'none'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function decisionOf(value: unknown): FlowDecision | undefined {
  if (!isRecord(value) || typeof value.action !== 'string' || !ACTIONS.has(value.action)
    || typeof value.mode !== 'string' || !MODES.has(value.mode) || typeof value.reason !== 'string') return undefined
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.kind !== 'string' || typeof entry.detail !== 'string') return []
      return [{ kind: entry.kind, detail: entry.detail }]
    })
    : []
  return {
    action: value.action as FlowAction,
    taskId: typeof value.taskId === 'string' ? value.taskId : null,
    mode: value.mode as FlowMode,
    reason: value.reason,
    blockers,
  }
}

/**
 * 解析 `/flow_status` 的一行 JSON。
 * @param text - 命令回执正文。
 * @returns 校验通过的求值；读不懂为 undefined。
 */
export function parseFlowStatus(text: string): FlowStatus | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const decision = decisionOf(value.decision)
  if (decision === undefined) return undefined
  const policy = isRecord(value.policy) ? value.policy : {}
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.state !== 'string') return []
      const taskDecision = decisionOf(entry.decision)
      if (taskDecision === undefined) return []
      return [{
        id: entry.id,
        state: entry.state,
        dependsOn: strings(entry.dependsOn),
        decision: taskDecision,
        startable: entry.startable === true,
      }]
    })
    : []
  return {
    decision,
    tasks,
    policySource: typeof policy.source === 'string' ? policy.source : '—',
    policyPath: typeof policy.path === 'string' ? policy.path : '—',
    known: strings(value.known),
  }
}
