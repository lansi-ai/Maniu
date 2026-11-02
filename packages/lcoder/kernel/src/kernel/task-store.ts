/**
 * 任务对象与状态机：状态的唯一写入口。
 *
 * 三条刻意的设计：
 *   1. **转移表是数据，不是 if-else。** 加状态只改表，不改函数。
 *   2. **transition 不改入参，返回新对象。** 隐式改状态是这类系统最常见的漂移来源。
 *   3. **非法转移抛错，不返回 null。** 上层必须显式处理，而不是静默忽略。
 *
 * 状态机只管图：某条边存不存在。「能不能进 contracted」还取决于契约是否签署，
 * 那是谓词（P3）的事，不塞进这里——否则规则和流程会缠死在一起。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { Task, TaskState } from '../schema/spec.js'
import { listFiles, matchPattern } from '../schema/validate.js'

/** 合法转移表。空数组 = 终态。 */
export const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  drafting: ['contracted', 'closed'],
  // contracted → drafting：契约作废，需重签
  contracted: ['implementing', 'drafting', 'closed'],
  // implementing → contracted：中途要改契约，必须重签。**不能直接 closed**——
  // 没经过 verifying 就没有证据，收口等于凭空宣布完成。
  implementing: ['verifying', 'contracted'],
  // verifying → implementing：验收不过，退回改
  verifying: ['closed', 'implementing'],
  closed: [],
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to)
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly taskId: string,
    readonly from: TaskState,
    readonly to: TaskState,
  ) {
    super(`任务 ${taskId} 不允许从 ${from} 迁移到 ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

export interface TaskEvent {
  type: 'task/transition'
  task_id: string
  from: TaskState
  to: TaskState
  at: string
}

export interface TransitionResult {
  task: Task
  event: TaskEvent
}

/**
 * 申请状态转移。返回新任务与一条可写入会话日志的事件。
 * @param at ISO 时间，由调用方给（保持纯函数的可测性）
 */
export function transition(task: Task, to: TaskState, at: string): TransitionResult {
  if (!canTransition(task.state, to)) {
    throw new IllegalTransitionError(task.id, task.state, to)
  }

  return {
    task: {
      ...task,
      state: to,
      closed_at: to === 'closed' ? at : null,
    },
    event: { type: 'task/transition', task_id: task.id, from: task.state, to, at },
  }
}

export interface OpenTaskInput {
  id: string
  title: string
  grade: Task['grade']
  rules?: string[]
  scope?: Task['scope']
  evidence_required?: string[]
  opened_at: string
}

/** 开新任务：一律从 drafting 起。 */
export function openTask(input: OpenTaskInput): Task {
  return Task.parse({
    ...input,
    state: 'drafting',
    closed_at: null,
  })
}

// ── 落盘 ────────────────────────────────────────────────────

export function taskPath(root: string, id: string): string {
  return join(root, 'tasks', `${id}.yaml`)
}

export function saveTask(root: string, task: Task): string {
  const path = taskPath(root, task.id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyYaml(Task.parse(task)), 'utf8')
  return path
}

export function loadTask(root: string, id: string): Task {
  return Task.parse(parseYaml(readFileSync(taskPath(root, id), 'utf8')))
}

export function listTasks(root: string): Task[] {
  return listFiles(root)
    .filter(f => matchPattern('tasks/*.yaml', f))
    .map(f => Task.parse(parseYaml(readFileSync(join(root, f), 'utf8'))))
    .sort((a, b) => a.id.localeCompare(b.id))
}
