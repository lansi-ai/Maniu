/**
 * `/flow_status` 的一句话输出解析：把宿主给的 JSON 收成界面能画的判定。
 *
 * 判定由 kernel 算，本模块不重新推导规则；它只在一个边界上做形状校验——
 * 命令输出可能来自旧装配或失败回执，读不懂就返回 null，界面报「读不懂」
 * 而不是拿半份数据画出一份看似正常的计划。
 */
import type { AutomationActionRow, AutomationLimitsRow, AutomationModeRow } from './projection.ts'

/** 引擎能给出的动作；与 kernel 的 `FlowAction` 同名同值。 */
export type FlowActionView =
  | 'draft' | 'contract' | 'sign' | 'implement' | 'verify' | 'close' | 'commit' | 'external' | 'stop'

/** 动作是自动、等人还是仅提示。 */
export type FlowModeView = AutomationModeRow | 'none'

/** 挡住原因四类。 */
export type FlowBlockerKindView = 'signature' | 'dependency' | 'budget' | 'external'

/** 一条挡住原因。 */
export interface FlowBlockerView {
  readonly kind: FlowBlockerKindView
  readonly detail: string
}

/** 一次流程判定。 */
export interface FlowDecisionView {
  readonly action: FlowActionView
  readonly taskId: string | null
  readonly mode: FlowModeView
  readonly reason: string
  readonly blockers: readonly FlowBlockerView[]
}

/** 策略来源与开关。 */
export interface FlowPolicyView {
  readonly source: 'default' | 'file'
  readonly path: string
  readonly hash: string | null
  readonly at: string | null
  readonly actions: Readonly<Record<AutomationActionRow, AutomationModeRow>>
  readonly limits: AutomationLimitsRow
  readonly tasks: readonly string[]
}

/** 一条任务的计划。 */
export interface FlowTaskPlanView {
  readonly id: string
  readonly state: string
  readonly dependsOn: readonly string[]
  readonly decision: FlowDecisionView
  readonly startable: boolean
}

/** 一次完整求值。 */
export interface FlowStatusView {
  readonly policy: FlowPolicyView
  readonly decision: FlowDecisionView
  readonly tasks: readonly FlowTaskPlanView[]
  /** 规格库里实际存在的任务编号。 */
  readonly known: readonly string[]
}

const ACTIONS = new Set<FlowActionView>([
  'draft', 'contract', 'sign', 'implement', 'verify', 'close', 'commit', 'external', 'stop',
])
const MODES = new Set<FlowModeView>(['auto', 'manual', 'none'])
const BLOCKERS = new Set<FlowBlockerKindView>(['signature', 'dependency', 'budget', 'external'])
const ACTION_NAMES: readonly AutomationActionRow[] = ['draft', 'contract', 'sign', 'implement', 'verify', 'close', 'commit']

/**
 * 解析 `/flow_status` 的输出。
 * @param text - 命令成功回执的正文（一行 JSON）。
 * @returns 校验通过的求值；任何必填字段不对就返回 null。
 */
export function parseFlowStatus(text: string): FlowStatusView | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value)) return null

  const policy = parsePolicy(value.policy)
  const decision = parseDecision(value.decision)
  if (policy === null || decision === null) return null

  const tasks = Array.isArray(value.tasks)
    ? value.tasks.map(parseTaskPlan).filter((entry): entry is FlowTaskPlanView => entry !== null)
    : []
  const known = stringArray(value.known)

  return { policy, decision, tasks, known }
}

function parsePolicy(value: unknown): FlowPolicyView | null {
  if (!isRecord(value)) return null
  if (value.source !== 'default' && value.source !== 'file') return null
  const path = textOf(value.path)
  if (path === null) return null
  const actions = parseActions(value.actions)
  if (actions === null) return null
  return {
    source: value.source,
    path,
    hash: nullableText(value.hash),
    at: nullableText(value.at),
    actions,
    limits: parseLimits(value.limits),
    tasks: stringArray(value.tasks),
  }
}

function parseActions(value: unknown): Readonly<Record<AutomationActionRow, AutomationModeRow>> | null {
  if (!isRecord(value)) return null
  const out: Partial<Record<AutomationActionRow, AutomationModeRow>> = {}
  for (const name of ACTION_NAMES) {
    const mode = value[name]
    if (mode !== 'auto' && mode !== 'manual') return null
    out[name] = mode
  }
  return out as Readonly<Record<AutomationActionRow, AutomationModeRow>>
}

function parseLimits(value: unknown): AutomationLimitsRow {
  if (!isRecord(value)) {
    return { tokenBudget: null, maxMinutes: null, maxConsecutiveFailures: null, maxParallel: null }
  }
  return {
    tokenBudget: positiveInt(value.token_budget),
    maxMinutes: positiveInt(value.max_minutes),
    maxConsecutiveFailures: nonNegativeInt(value.max_consecutive_failures),
    maxParallel: positiveInt(value.max_parallel),
  }
}

function parseDecision(value: unknown): FlowDecisionView | null {
  if (!isRecord(value)) return null
  const action = typeof value.action === 'string' ? value.action : ''
  if (!ACTIONS.has(action as FlowActionView)) return null
  const mode = typeof value.mode === 'string' ? value.mode : ''
  if (!MODES.has(mode as FlowModeView)) return null
  const reason = textOf(value.reason)
  if (reason === null) return null
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.map(parseBlocker).filter((entry): entry is FlowBlockerView => entry !== null)
    : []
  return {
    action: action as FlowActionView,
    taskId: nullableText(value.taskId),
    mode: mode as FlowModeView,
    reason,
    blockers,
  }
}

function parseBlocker(value: unknown): FlowBlockerView | null {
  if (!isRecord(value)) return null
  const kind = typeof value.kind === 'string' ? value.kind : ''
  const detail = textOf(value.detail)
  if (!BLOCKERS.has(kind as FlowBlockerKindView) || detail === null) return null
  return { kind: kind as FlowBlockerKindView, detail }
}

function parseTaskPlan(value: unknown): FlowTaskPlanView | null {
  if (!isRecord(value)) return null
  const id = textOf(value.id)
  const state = textOf(value.state)
  const decision = parseDecision(value.decision)
  if (id === null || state === null || decision === null) return null
  return {
    id,
    state,
    dependsOn: stringArray(value.dependsOn),
    decision,
    startable: value.startable === true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}
