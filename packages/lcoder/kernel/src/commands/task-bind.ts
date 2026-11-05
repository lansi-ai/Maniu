/**
 * 人机命令 `task_bind`：把当前会话认上指定任务。
 *
 * 三条理由，决定它是命令而不是工具：
 *   1. **不能是工具。** 这条认领关系决定该会话按哪个任务的状态装工具面，模型能自己
 *      认领就等于自己挑工具面——和 `contract_sign` 同一档，PROJECT-RULES §1 是红线。
 *   2. **人机命令正好是这一档。** `@deepseek-ai/dsh-commands` 的执行不产生模型消息，
 *      但 `command/run` 与 `command/done` 会进会话日志：人在工作台点的这一次留得下证据。
 *   3. **前端不写盘。** 规格库只由 kernel 写；浏览器只负责在会话里发起这一次命令。
 *
 * 一条会话同时只认领一条任务：改绑新任务时释放它先前认领的旧任务，否则两条任务的状态
 * 会同时主张这条会话，工具面就没有唯一答案。任务本身的状态不由本命令改动。
 */
import { Task } from '../schema/spec.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, listTasks, saveTask, taskPath } from '../kernel/task-store.js'

/** 一次人机命令调用里 kernel 用到的部分：会话事实加命令名后的原文。 */
export interface BindInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果；形状与 `dsh-commands` 的 `CommandResult` 一致，本包不依赖那个包。 */
export type BindCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义；与 `CommandDefinition` 结构相容。 */
export interface BindCommandDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: BindInvocation) => BindCommandResult
}

/**
 * 建 `task_bind` 命令定义。
 * @param rootInput - 规格根解析，与工具共用同一条会话来源。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createTaskBindCommand(rootInput: RootInput): BindCommandDefinition {
  return {
    name: 'task_bind',
    description: '把当前会话认上指定任务，该会话之后按这条任务的状态装工具面',
    input: { hint: '<任务编号>' },
    handler: invocation => bindTask(rootInput, invocation),
  }
}

function bindTask(rootInput: RootInput, invocation: BindInvocation): BindCommandResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') {
    return { kind: 'error', text: '需要任务编号，例如 /task_bind T-01' }
  }

  const sessionId = invocation.agent?.session.header.id
  if (sessionId === undefined) {
    return { kind: 'error', text: '这条命令要在一场会话里执行：认领关系记的就是会话号，现在没有会话可认' }
  }

  let taskId: string
  try {
    taskId = assertTaskId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可认领的任务；先用 task_draft 立项` }
  }

  let tasks: Task[]
  try {
    tasks = listTasks(root)
  } catch (error: unknown) {
    return { kind: 'error', text: `${root}/tasks 读不懂：${errorMessage(error)}` }
  }

  const target = tasks.find(task => task.id === taskId)
  if (target === undefined) {
    return { kind: 'error', text: `找不到 ${taskId} 的任务文件（${taskPath(root, taskId)}）；先用 task_draft 立项` }
  }
  if (target.session === sessionId) {
    return { kind: 'success', text: `${taskId} 已由本会话认领，无需重复绑定；工具面按 ${taskId} 的 ${target.state} 装配` }
  }

  // 一条会话只认领一条任务：先释放它先前认领的，再写新的，避免两条任务同时主张这条会话。
  // 释放是把 session 这个键整个去掉：留一个空值会让任务文件读不懂，工具面反而全丢。
  const released = tasks.filter(task => task.session === sessionId)
  for (const previous of released) saveTask(root, withoutSession(previous))
  saveTask(root, Task.parse({ ...target, session: sessionId }))

  const notes = [
    `会话 ${sessionId} 已认上 ${taskId}，该会话的工具面按 ${taskId} 的 ${target.state} 装配`,
    target.session === undefined ? '' : `它原先由会话 ${target.session} 认领，现已改到本会话`,
    released.length === 0 ? '' : `同时释放它先前认领的 ${released.map(task => task.id).join('、')}`,
    `写入 ${taskPath(root, taskId)}；任务状态不由本命令改动，仍在 .spec/tasks/${taskId}.yaml 里由人推进`,
  ]

  return { kind: 'success', text: notes.filter(note => note !== '').join('。') }
}

/** 去掉认领关系后的任务：`session` 这个键不出现在落盘文本里，任务文件仍读得懂。 */
function withoutSession(task: Task): Task {
  const rest: Record<string, unknown> = { ...task }
  delete rest.session
  return Task.parse(rest)
}

/** 把抛出物说成人话：只取消息，不带栈。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
