/**
 * 人机命令 `task_contract`：人确认契约已签，把任务从 `drafting` 推到 `contracted`。
 *
 * 为什么单独一条命令、不让签署顺带推：签名与状态是两件事——签了不等于开工，中间隔着
 * 人的决定。两条命令各写一件事，失败也分得清：签名写坏了状态没动，状态推不动签名还在。
 *
 * 只做这一条边。更往后的状态推进仍按人手写 YAML 的口径，这里不做通用 advance——
 * 通用转移会把状态机判断从「图的合法边」扩成「一张命令表」，收不回来。
 *
 * 与 `contract_sign` 同档：人机命令，不进任何角色或状态的工具面。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { loadContractFact } from '../kernel/contract.js'
import { assertTaskId, loadTask, saveTask, taskPath, transition } from '../kernel/task-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface ContractAdvanceInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type ContractAdvanceResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface ContractAdvanceDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: ContractAdvanceInvocation) => ContractAdvanceResult
}

/**
 * 建 `task_contract` 命令定义。
 * @param rootInput - 规格根解析，与工具和另外两条命令共用同一条会话来源。
 * @param now - 推进时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createTaskContractCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): ContractAdvanceDefinition {
  return {
    name: 'task_contract',
    description: '确认契约已由人签署，把任务从起草推到已签约',
    input: { hint: '<任务编号>' },
    handler: invocation => advance(rootInput, invocation, now),
  }
}

function advance(rootInput: RootInput, invocation: ContractAdvanceInvocation, now: () => string): ContractAdvanceResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要任务编号，例如 /task_contract T-01' }

  let taskId: string
  try {
    taskId = assertTaskId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可推进的任务` }
  }

  let task
  try {
    task = loadTask(root, taskId)
  } catch (error: unknown) {
    return { kind: 'error', text: `读不到任务 ${taskId}（${taskPath(root, taskId)}）：${errorMessage(error)}` }
  }
  if (task.state !== 'drafting') {
    return { kind: 'error', text: `${taskId} 现在在「${task.state}」，只有起草态才需要这一步；更往后的状态仍由人手改 YAML` }
  }

  let fact
  try {
    fact = loadContractFact(root, taskId)
  } catch (error: unknown) {
    return { kind: 'error', text: `契约文件读不懂：${errorMessage(error)}` }
  }
  if (fact === null) {
    return { kind: 'error', text: `找不到 ${taskId} 的契约；先起草或手写 .spec/contracts/${taskId}.contract.yaml` }
  }
  if (fact.contract.sig === null) {
    return { kind: 'error', text: `${taskId} 的契约还没签；先在任务详情里点「签署契约」` }
  }
  if (fact.contract.sig.by !== 'human') {
    return { kind: 'error', text: `${taskId} 的契约是 agent 签的，不算数；要人重新签` }
  }
  if (fact.contract.sig.hash !== fact.bodyHash) {
    return { kind: 'error', text: `${taskId} 的契约在签署后正文被改过，签名作废；要人重签` }
  }

  const at = now()
  const { task: advanced } = transition(task, 'contracted', at)
  saveTask(root, advanced)

  return {
    kind: 'success',
    text: `${taskId} 已进入「已签约」（${at}）。契约签名覆盖当前正文，实施需要的工具面从下一次求值起放开。`,
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
