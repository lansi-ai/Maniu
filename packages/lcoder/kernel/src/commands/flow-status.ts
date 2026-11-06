/**
 * 人机命令 `flow_status`：把当前策略、下一步动作与逐任务计划交给工作台。
 *
 * 为什么是命令而不是工具：流程判定属于状态机，PROJECT-RULES 要求它不落进界面。
 * 浏览器只把这份 JSON 画出来，不自己判断哪条任务能开始。命令不写任务状态，
 * 也不替模型做决定；它只是一次只读求值，和 `/task_schedule` 同一档。
 *
 * 输出是一行 JSON：`policy`（策略来源与开关）、`decision`（整体下一步）、
 * `tasks`（逐任务判定与 `startable`）。读不懂策略或任务文件时返回错误文本，
 * 不吞成一份看起来正常的空计划。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { loadFlowPlan } from '../kernel/flow-store.js'
import { assertTaskId } from '../kernel/task-store.js'

/** 一次最多评估的任务数；超过这个量说明调用方传错了，拒绝比静默截断好。 */
const MAX_TASKS = 200

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface FlowStatusInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type FlowStatusCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface FlowStatusCommandDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: FlowStatusInvocation) => FlowStatusCommandResult
}

/**
 * 建 `flow_status` 命令定义。
 * @param rootInput - 规格根解析，与工具和另外几条命令共用同一条会话来源。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createFlowStatusCommand(rootInput: RootInput): FlowStatusCommandDefinition {
  return {
    name: 'flow_status',
    description: '只读求值：返回当前策略、下一步动作与逐任务计划（一行 JSON）',
    input: { hint: '[任务编号，逗号或空格分隔；省略表示全部]' },
    handler: invocation => status(rootInput, invocation),
  }
}

function status(rootInput: RootInput, invocation: FlowStatusInvocation): FlowStatusCommandResult {
  const raw = invocation.rawInput.trim()
  let taskIds: string[] = []
  if (raw !== '') {
    const parts = raw.split(/[\s,]+/u).filter(part => part !== '')
    if (parts.length > MAX_TASKS) {
      return { kind: 'error', text: `一次最多评估 ${String(MAX_TASKS)} 条任务，收到 ${String(parts.length)} 条` }
    }
    try {
      taskIds = [...new Set(parts.map(part => assertTaskId(part)))]
    } catch (error: unknown) {
      return { kind: 'error', text: errorMessage(error) }
    }
  }

  const root = resolveRoot(rootInput, invocation)
  let plan: ReturnType<typeof loadFlowPlan>
  try {
    plan = loadFlowPlan(root, taskIds)
  } catch (error: unknown) {
    return {
      kind: 'error',
      text: `${hasSpecRoot(root) ? root : '规格库'} 读不懂，无法求流程：${errorMessage(error)}`,
    }
  }

  const states = new Map(plan.tasks.map(task => [task.id, task]))
  const payload = {
    policy: {
      source: plan.policy.source,
      path: plan.policy.path,
      hash: plan.policy.hash,
      at: plan.policy.at,
      actions: plan.policy.policy.actions,
      limits: plan.policy.policy.limits,
      tasks: plan.policy.policy.tasks,
    },
    decision: plan.decision,
    tasks: plan.plans.map((entry) => {
      const fact = states.get(entry.taskId)
      return {
        id: entry.taskId,
        state: fact?.state ?? 'closed',
        dependsOn: fact?.dependsOn ?? [],
        decision: entry.decision,
        startable: entry.startable,
      }
    }),
    known: plan.taskIds,
  }

  return { kind: 'success', text: JSON.stringify(payload) }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
