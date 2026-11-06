/**
 * 流程引擎的磁盘装配：把 `.spec` 里的事实读成 `decideFlow` 的输入。
 *
 * 读盘与判定刻意分开：`flow.ts` 保持纯函数，本模块只做「文件 → 事实」的翻译，
 * 不缓存、不订阅、不写盘。每次调用都重读任务、契约与证据，
 * 所以签了字、挂了证据、改了策略，下一次判定立刻反映。
 *
 * `committed`、`externalActions` 与停止条件已用量不是 `.spec` 里的事实，
 * 由调用方按运行时状态传入；缺省按「未提交、无外部动作、用量为零」处理。
 */
import { hasSpecRoot } from './spec-root.js'
import { listTasks } from './task-store.js'
import { loadContractFact } from './contract.js'
import { loadEvidence, hasReviewEvidence } from './evidence-store.js'
import { loadAutomationPolicy } from './automation.js'
import type { AutomationPolicyFact } from './automation.js'
import { decideFlow, planFlow } from './flow.js'
import type { FlowDecision, FlowTaskFacts, FlowTaskPlan, FlowUsage } from './flow.js'

/** 运行时才知道、`.spec` 里没有的事实。 */
export interface FlowRuntimeFacts {
  readonly usage?: Partial<FlowUsage>
  /** 任务是否已经本地提交；缺省一律按未提交处理。 */
  readonly committed?: Readonly<Record<string, boolean>>
  /** 收口后仍需人做外部动作的任务；缺省表示没有。 */
  readonly externalActions?: Readonly<Record<string, readonly string[]>>
}

/** 一次磁盘判定的结果，连同策略来源。 */
export interface FlowSnapshot {
  readonly decision: FlowDecision
  readonly tasks: readonly FlowTaskFacts[]
  readonly policy: AutomationPolicyFact
}

/**
 * 读规格库并求下一步动作。
 * @param root - 规格根。
 * @param runtime - 运行时事实（用量、提交状态、外部动作）。
 * @returns 判定、任务事实与策略来源。
 * @throws 任务或契约文件读不懂，或自动化策略非法时抛出——读不懂就不猜。
 */
export function loadFlowSnapshot(root: string, runtime: FlowRuntimeFacts = {}): FlowSnapshot {
  const policy = loadAutomationPolicy(root)
  const tasks = hasSpecRoot(root) ? listTasks(root) : []
  const facts = tasks.map((task): FlowTaskFacts => {
    const contract = loadContractFact(root, task.id)
    const evidence = loadEvidence(root, task.id)
    return {
      id: task.id,
      state: task.state,
      dependsOn: task.depends_on,
      irreversible: task.scope.irreversible,
      contractExists: contract !== null,
      signatureValid: contract !== null && contract.contract.sig !== null && contract.contract.sig.hash === contract.bodyHash,
      reviewEvidence: hasReviewEvidence(evidence),
      evidenceComplete: task.evidence_required.every(name => (evidence[name] ?? 0) > 0),
      committed: runtime.committed?.[task.id] ?? false,
      externalActions: runtime.externalActions?.[task.id] ?? [],
    }
  })

  return {
    decision: decideFlow({
      tasks: facts,
      policy: policy.policy,
      ...(runtime.usage === undefined ? {} : { usage: runtime.usage }),
    }),
    tasks: facts,
    policy,
  }
}

/** 一次磁盘判定的计划视图：整体判定之外，再给每条任务一份计划。 */
export interface FlowPlanSnapshot extends FlowSnapshot {
  readonly plans: readonly FlowTaskPlan[]
  /** 规格库里实际存在的任务编号，供界面区分「选中了但文件已删」。 */
  readonly taskIds: readonly string[]
}

/**
 * 读规格库并给出整体判定与逐任务计划。
 * @param root - 规格根。
 * @param taskIds - 要逐条评估的任务编号；空数组表示全部。
 * @param runtime - 运行时事实（用量、提交状态、外部动作）。
 * @returns 判定、任务事实、策略来源与逐任务计划。
 * @throws 任务或契约文件读不懂，或自动化策略非法时抛出——读不懂就不猜。
 */
export function loadFlowPlan(
  root: string,
  taskIds: readonly string[] = [],
  runtime: FlowRuntimeFacts = {},
): FlowPlanSnapshot {
  const snapshot = loadFlowSnapshot(root, runtime)
  const plans = planFlow(taskIds, {
    tasks: snapshot.tasks,
    policy: snapshot.policy.policy,
    ...(runtime.usage === undefined ? {} : { usage: runtime.usage }),
  })
  return { ...snapshot, plans, taskIds: snapshot.tasks.map(task => task.id) }
}
