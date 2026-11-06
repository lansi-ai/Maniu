/**
 * 流程引擎：根据任务集合、门禁事实、自动化策略与已用量，决定「下一步做什么」。
 *
 * 三层分工，与分配层（`scheduling.ts`）平行：
 *   1. **分配层决定交给谁，本层决定下一步做什么**，两层互不读对方的判定。
 *   2. **纯函数。** 不读盘、不调远程、不看时钟；同样的输入永远给同样的动作与理由。
 *      磁盘事实由 `flow-store` 装配，执行器另接——动作仍走已有的人机命令或 kernel 内部 API，
 *      不给模型任何新工具。
 *   3. **输出必须能被追问。** 每个判定带理由与「被什么挡住」：等人签、等依赖、等预算、等外部动作。
 *
 * 停止条件先于一切任务检查：预算用尽时不该再挑一条任务出来显得还有活干。
 */
import type { AutomationMode, AutomationPolicy, TaskState } from '../schema/spec.js'
import { describeSelfSignFailure, evaluateSelfSignGate } from './sign-gate.js'

/** 引擎能给出的下一动作；`external` 永远只作为「等人做」的提示出现。 */
export type FlowAction =
  | 'draft'
  | 'contract'
  | 'sign'
  | 'implement'
  | 'verify'
  | 'close'
  | 'commit'
  | 'external'
  | 'stop'

/** 挡住原因只有这四类；策略为手动的动作不算「被挡」，由 `mode` 表达。 */
export type FlowBlockerKind = 'signature' | 'dependency' | 'budget' | 'external'

/** 一条挡住原因：类别加人可读的说明。 */
export interface FlowBlocker {
  readonly kind: FlowBlockerKind
  /** 人可读的说明。 */
  readonly detail: string
}

/** 一个任务的已知事实；全部由调用方从磁盘或运行时采集。 */
export interface FlowTaskFacts {
  readonly id: string
  readonly state: TaskState
  /** 前置任务编号；收口才算满足。 */
  readonly dependsOn: readonly string[]
  /** 任务的 `scope.irreversible`。 */
  readonly irreversible: readonly string[]
  /** 契约文件是否存在。 */
  readonly contractExists: boolean
  /** 是否存在签名且签名覆盖当前正文。 */
  readonly signatureValid: boolean
  /** 是否有非空的评审复核证据。 */
  readonly reviewEvidence: boolean
  /** 收口要求的证据是否都非空。 */
  readonly evidenceComplete: boolean
  /** 是否已经本地提交。 */
  readonly committed: boolean
  /** 收口后仍需要的外部动作（push、部署、环境变更）；永远由人执行。 */
  readonly externalActions: readonly string[]
}

/** 停止条件已用量；缺省按 0 处理。 */
export interface FlowUsage {
  readonly tokens: number
  readonly minutes: number
  readonly consecutiveFailures: number
  /** 当前在跑的会话或动作数。 */
  readonly running: number
}

/** 一次判定的输入：任务事实、策略与已用量。 */
export interface FlowInput {
  readonly tasks: readonly FlowTaskFacts[]
  readonly policy: AutomationPolicy
  readonly usage?: Partial<FlowUsage>
}

/** 一次判定：动作、归属任务、是否自动，以及理由与挡住原因。 */
export interface FlowDecision {
  readonly action: FlowAction
  /** `draft`、全局 `stop` 与无任务的 `external` 为 null。 */
  readonly taskId: string | null
  /** `none` 只用于 `stop` 与 `external`。 */
  readonly mode: AutomationMode | 'none'
  readonly reason: string
  readonly blockers: readonly FlowBlocker[]
}

const ZERO_USAGE: FlowUsage = { tokens: 0, minutes: 0, consecutiveFailures: 0, running: 0 }

/**
 * 求下一步动作。
 * @param input - 任务事实、策略与已用量。
 * @returns 下一动作与理由；被挡住时 `blockers` 非空。
 */
export function decideFlow(input: FlowInput): FlowDecision {
  const usage: FlowUsage = { ...ZERO_USAGE, ...input.usage }
  const budget = budgetBlocker(input.policy, usage)
  if (budget !== undefined) {
    return { action: 'stop', taskId: null, mode: 'none', reason: '停止条件已触发，流程不再自动推进', blockers: [budget] }
  }

  const tasks = scopeTasks(input.tasks, input.policy)
  if (tasks.length === 0) {
    return {
      action: 'draft',
      taskId: null,
      mode: input.policy.actions.draft,
      reason: '策略范围内的任务为空，先起草任务',
      blockers: [],
    }
  }

  // 依赖是否满足看全量任务，不看策略范围：范围只决定驱动谁，不改变别人已经收口的事实。
  const byId = new Map(input.tasks.map(task => [task.id, task]))
  const closed = new Set(input.tasks.filter(task => task.state === 'closed').map(task => task.id))
  const open = tasks.filter(task => task.state !== 'closed')

  if (open.length === 0) return closedTail(tasks, input.policy)

  let firstBlocked: FlowDecision | undefined
  for (const task of open) {
    const decision = decideTask(task, byId, closed, input.policy)
    if (decision.blockers.length === 0) return decision
    firstBlocked ??= decision
  }
  return firstBlocked ?? { action: 'stop', taskId: null, mode: 'none', reason: '没有可推进的任务', blockers: [] }
}

/** 停止条件：按 token、时长、连续失败、并发上限的顺序判，第一条触发就停。 */
function budgetBlocker(policy: AutomationPolicy, usage: FlowUsage): FlowBlocker | undefined {
  const limits = policy.limits
  if (limits.token_budget !== undefined && usage.tokens >= limits.token_budget) {
    return { kind: 'budget', detail: `token 已用 ${String(usage.tokens)}，预算 ${String(limits.token_budget)}` }
  }
  if (limits.max_minutes !== undefined && usage.minutes >= limits.max_minutes) {
    return { kind: 'budget', detail: `已运行 ${String(usage.minutes)} 分钟，上限 ${String(limits.max_minutes)}` }
  }
  if (
    limits.max_consecutive_failures !== undefined &&
    usage.consecutiveFailures >= limits.max_consecutive_failures
  ) {
    return {
      kind: 'budget',
      detail: `连续失败 ${String(usage.consecutiveFailures)} 次，上限 ${String(limits.max_consecutive_failures)}`,
    }
  }
  if (limits.max_parallel !== undefined && usage.running >= limits.max_parallel) {
    return { kind: 'budget', detail: `正在跑 ${String(usage.running)} 条，并发上限 ${String(limits.max_parallel)}` }
  }
  return undefined
}

/** 策略的任务范围：空数组表示全部。 */
function scopeTasks(tasks: readonly FlowTaskFacts[], policy: AutomationPolicy): FlowTaskFacts[] {
  if (policy.tasks.length === 0) return [...tasks].sort(byId)
  const wanted = new Set(policy.tasks)
  return tasks.filter(task => wanted.has(task.id)).sort(byId)
}

function byId(a: FlowTaskFacts, b: FlowTaskFacts): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 所有任务都收口之后：先本地提交，再把外部动作交还给人，最后才是真正结束。 */
function closedTail(tasks: readonly FlowTaskFacts[], policy: AutomationPolicy): FlowDecision {
  const uncommitted = tasks.find(task => !task.committed)
  if (uncommitted !== undefined) {
    return {
      action: 'commit',
      taskId: uncommitted.id,
      mode: policy.actions.commit,
      reason: `${uncommitted.id} 已收口，尚未本地提交`,
      blockers: [],
    }
  }

  const external = tasks.find(task => task.externalActions.length > 0)
  if (external !== undefined) {
    return {
      action: 'external',
      taskId: external.id,
      mode: 'none',
      reason: `${external.id} 收口后还有外部动作，等人工执行`,
      blockers: [{
        kind: 'external',
        detail: `外部不可逆动作只能由人执行：${external.externalActions.join('、')}`,
      }],
    }
  }

  return { action: 'stop', taskId: null, mode: 'none', reason: '任务都已收口，没有待办', blockers: [] }
}

/** 单条未收口任务的下一动作。 */
function decideTask(
  task: FlowTaskFacts,
  tasks: ReadonlyMap<string, FlowTaskFacts>,
  closed: ReadonlySet<string>,
  policy: AutomationPolicy,
): FlowDecision {
  const unmet = task.dependsOn.filter(id => !closed.has(id))
  if (unmet.length > 0) {
    return {
      action: 'stop',
      taskId: task.id,
      mode: 'none',
      reason: `${task.id} 的前置任务还没收口`,
      blockers: [{
        kind: 'dependency',
        detail: `等这些任务收口：${unmet.map(id => (tasks.has(id) ? id : `${id}（不存在）`)).join('、')}`,
      }],
    }
  }

  switch (task.state) {
    case 'drafting':
      return drafting(task, policy)
    case 'contracted':
      return {
        action: 'implement',
        taskId: task.id,
        mode: policy.actions.implement,
        reason: `${task.id} 的契约已确认，进入实施`,
        blockers: [],
      }
    case 'implementing':
      return {
        action: 'verify',
        taskId: task.id,
        mode: policy.actions.verify,
        reason: `${task.id} 实施中，下一步跑验证`,
        blockers: [],
      }
    case 'verifying':
      if (task.evidenceComplete) {
        return {
          action: 'close',
          taskId: task.id,
          mode: policy.actions.close,
          reason: `${task.id} 证据已齐，可以申请收口`,
          blockers: [],
        }
      }
      return {
        action: 'verify',
        taskId: task.id,
        mode: policy.actions.verify,
        reason: `${task.id} 的证据还没齐，继续验证`,
        blockers: [],
      }
    case 'closed':
      // 调用方已把 closed 的任务挑出去；这里只保留穷尽分支。
      return { action: 'stop', taskId: task.id, mode: 'none', reason: '任务已收口', blockers: [] }
    default: {
      const exhaustive: never = task.state
      throw new Error(`未处理的任务状态：${String(exhaustive)}`)
    }
  }
}

/** 起草态：先有契约，再谈签署。 */
function drafting(task: FlowTaskFacts, policy: AutomationPolicy): FlowDecision {
  if (!task.contractExists) {
    return {
      action: 'contract',
      taskId: task.id,
      mode: policy.actions.contract,
      reason: `${task.id} 还没有契约，下一步起草契约`,
      blockers: [],
    }
  }

  if (task.signatureValid) {
    return {
      action: 'sign',
      taskId: task.id,
      mode: policy.actions.sign,
      reason: `${task.id} 的契约已签且覆盖当前正文，确认后进入已签约`,
      blockers: [],
    }
  }

  const gate = evaluateSelfSignGate({
    signAuto: policy.actions.sign === 'auto',
    irreversible: task.irreversible,
    reviewEvidence: task.reviewEvidence,
  })
  if (gate.allowed) {
    return {
      action: 'sign',
      taskId: task.id,
      mode: 'auto',
      reason: `${task.id} 的契约未签；三项补偿闸成立，可由 AI 自签并记录授权依据`,
      blockers: [],
    }
  }

  return {
    action: 'sign',
    taskId: task.id,
    mode: 'manual',
    reason: `${task.id} 的契约未签，需要人签署`,
    blockers: [{ kind: 'signature', detail: `等人签：${describeSelfSignFailure(gate)}` }],
  }
}
