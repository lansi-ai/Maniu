/**
 * 人机命令 `task_split_ready`：把需求拆出的 drafting 任务直接推到 `contracted`（看板「待开发」）。
 *
 * 用户已拍板：以需求文档作为这批拆分任务的契约依据，分配岗位后跳过逐任务契约，
 * 直接进待开发。需求本体不推进，仍留在「需求确认」。
 *
 * 四道闸只认拆分任务的形状：起草态、回指方案、已有岗位。
 * 任何一道不过都只回一句话，任务文件一个字节不动。
 *
 * 与 `contract_sign`、`task_contract` 同档：只注册为人机命令，不进任何角色或状态的工具面。
 */
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, loadTask, saveTask, taskPath, transition } from '../kernel/task-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface SplitReadyInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type SplitReadyResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface SplitReadyDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: SplitReadyInvocation) => SplitReadyResult
}

/**
 * 建 `task_split_ready` 命令定义。
 * @param rootInput - 规格根解析，与工具和另外几条命令共用同一条会话来源。
 * @param now - 推进时刻的取值；默认取本机时钟，测试可注入。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createTaskSplitReadyCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): SplitReadyDefinition {
  return {
    name: 'task_split_ready',
    description: '把需求拆分出来、已分配岗位的起草任务直接推到待开发（contracted），需求文档为契约依据',
    input: { hint: '<任务编号>' },
    handler: invocation => advance(rootInput, invocation, now),
  }
}

function advance(rootInput: RootInput, invocation: SplitReadyInvocation, now: () => string): SplitReadyResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要任务编号，例如 /task_split_ready T-02' }

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
    return { kind: 'error', text: `找不到 ${taskId} 的任务文件（${taskPath(root, taskId)}）：${errorMessage(error)}` }
  }
  if (task.state !== 'drafting') {
    return {
      kind: 'error',
      text: `${taskId} 现在在「${task.state}」，只有起草态的拆分任务能直接进入待开发；更往后的状态仍由人手改 YAML`,
    }
  }
  if (task.proposal === undefined) {
    return {
      kind: 'error',
      text: `${taskId} 没有回指需求方案，不是需求拆分出来的任务；这类任务仍走 /contract_sign 与 /task_contract`,
    }
  }
  if (task.role === undefined) {
    return { kind: 'error', text: `${taskId} 还没分配岗位；先 /task_assign ${taskId} <岗位 id>，再进入待开发` }
  }

  const at = now()
  const { task: advanced } = transition(task, 'contracted', at)
  saveTask(root, advanced)

  return {
    kind: 'success',
    text: [
      `${taskId} 已进入「待开发」（contracted，${at}）`,
      `由需求 ${task.proposal} 拆分直接进入待开发，需求文档为契约依据`,
      `写入 ${taskPath(root, taskId)}`,
    ].join('。'),
  }
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
