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
  /** 出自哪个方案（`P-01`）；省略表示不是拆出来的。 */
  proposal?: string
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

/** 任务编号的唯一形态：与规格条目同一套稳定编号（T-01 / DEMO-014）。 */
const TASK_ID = /^[A-Z]+-\d{2,}$/

/**
 * 校验任务编号形态，不合法就抛。
 * @param id - 调用方（模型或 UI）给出的编号。
 * @returns 原样返回校验过的编号。
 */
export function assertTaskId(id: string): string {
  if (!TASK_ID.test(id)) {
    throw new Error(`非法的任务编号：${id}（应形如 T-014）`)
  }
  return id
}

/**
 * 下一个可用的 `T-<序号>` 编号：取现有 T- 编号的最大序号加一，两位起排。
 * 其它前缀（如 `DEMO-01`）不参与计数，示例数据不会挤占正式编号。
 * @param tasks - 规格库里已有的任务。
 * @returns 未被占用的编号。
 */
export function nextTaskId(tasks: readonly Task[]): string {
  let max = 0
  for (const task of tasks) {
    const digits = /^T-(\d+)$/.exec(task.id)?.[1]
    if (digits !== undefined) max = Math.max(max, Number.parseInt(digits, 10))
  }
  return `T-${String(max + 1).padStart(2, '0')}`
}

/**
 * 标题查重键：空白一律不算差异，比较不区分大小写——中文标题里的空格常常只是
 * 打字噪声，把连续空白换成一个空格仍会判成两个任务。
 */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '')
}

/**
 * 按标题找已存在的任务——立项时同一个诉求写两遍是常见的重复来源。
 * @param tasks - 规格库里已有的任务。
 * @param title - 准备新建的标题。
 * @returns 命中的既有任务；没有则 undefined。
 */
export function findByTitle(tasks: readonly Task[], title: string): Task | undefined {
  const key = titleKey(title)
  return tasks.find(task => titleKey(task.title) === key)
}

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

/**
 * 这条会话该按哪个任务的状态装工具面。
 *
 * 顺序是「会话认领 → 装配层配置 → 看板第一条」：认领关系由人机命令 `/task_bind` 写下，
 * 一仓多会话时每条会话只看自己那条任务的状态，并行的两条不会互相顶掉。
 * 会话号在认领的任务里找不到（换机器、删会话、手写台账）时按未认领处理，回落到后两档，
 * 与未启用认领关系时的行为一致，不报故障也不改任务状态。
 * @param tasks - 按 id 排序的看板任务，通常来自 `listTasks`。
 * @param sessionId - 当前会话号；无会话（headless、启动自检）时传 undefined。
 * @param configuredId - 装配层 `Config.taskId`，没有配置时传 undefined。
 * @returns 决定工具面的任务；一条都对不上时返回 undefined，由调用方按空看板面处理。
 */
export function pickTaskForSession(
  tasks: readonly Task[],
  sessionId: string | undefined,
  configuredId?: string,
): Task | undefined {
  if (sessionId !== undefined) {
    const claimed = tasks.find(task => task.session === sessionId)
    if (claimed !== undefined) return claimed
  }
  if (configuredId !== undefined) return tasks.find(task => task.id === configuredId)
  return tasks[0]
}
