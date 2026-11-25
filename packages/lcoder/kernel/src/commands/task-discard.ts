/**
 * 人机命令 `task_discard`：删除处于起草态（`drafting` / 看板「待确认」）的无用任务。
 *
 * 仅允许删除 `drafting` 状态且未被其他任务 `depends_on` 引用的任务文件，
 * 若关联需求存在 `split-plan.yaml`，同步剔除对应条目。
 */
import { unlinkSync } from 'node:fs'
import { loadSplitPlan, saveSplitPlan } from '../kernel/requirement-store.js'
import { hasSpecRoot, resolveRoot } from '../kernel/spec-root.js'
import type { RootInput, SpecRootContext } from '../kernel/spec-root.js'
import { assertTaskId, listTasks, loadTask, taskPath } from '../kernel/task-store.js'

/** 一次人机命令调用里 kernel 用到的部分。 */
export interface TaskDiscardInvocation extends SpecRootContext {
  readonly rawInput: string
}

/** 命令结果。 */
export type TaskDiscardResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 注册进命令面所需的最小定义。 */
export interface TaskDiscardDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: TaskDiscardInvocation) => TaskDiscardResult
}

/**
 * 建 `task_discard` 命令定义。
 * @param rootInput - 规格根解析。
 * @param now - 同步更新 split-plan 的时间戳函数。
 * @returns 可直接交给 `ctx.commands.register` 的定义。
 */
export function createTaskDiscardCommand(
  rootInput: RootInput,
  now: () => string = () => new Date().toISOString(),
): TaskDiscardDefinition {
  return {
    name: 'task_discard',
    description: '删除一条处于待确认（drafting）状态的无用任务；已进入开发或被其他任务依赖时拒绝删除',
    input: { hint: '<任务编号>' },
    handler: invocation => discard(rootInput, invocation, now),
  }
}

function discard(rootInput: RootInput, invocation: TaskDiscardInvocation, now: () => string): TaskDiscardResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') return { kind: 'error', text: '需要任务编号，例如 /task_discard T-06' }

  let taskId: string
  try {
    taskId = assertTaskId(raw)
  } catch (error: unknown) {
    return { kind: 'error', text: errorMessage(error) }
  }

  const root = resolveRoot(rootInput, invocation)
  if (!hasSpecRoot(root)) {
    return { kind: 'error', text: `这个仓库还没有 .spec 规格库（${root}），没有可删除的任务` }
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
      text: `${taskId} 当前处于「${task.state}」，只有待确认（drafting）状态的任务允许删除`,
    }
  }

  const dependents = listTasks(root)
    .filter(other => other.id !== taskId && other.depends_on.includes(taskId))
    .map(other => other.id)
  if (dependents.length > 0) {
    return {
      kind: 'error',
      text: `${taskId} 仍被任务 ${dependents.join('、')} 依赖；请先调整或删除这些后置任务`,
    }
  }

  const file = taskPath(root, taskId)
  unlinkSync(file)

  if (task.requirement !== undefined) {
    const plan = loadSplitPlan(root, task.requirement)
    if (plan !== undefined && plan.tasks.some(entry => entry.task === taskId)) {
      saveSplitPlan(root, {
        requirement: plan.requirement,
        at: now(),
        tasks: plan.tasks.filter(entry => entry.task !== taskId),
      })
    }
  }

  return {
    kind: 'success',
    text: `已删除待确认任务 ${taskId}（${task.title}）。`,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
