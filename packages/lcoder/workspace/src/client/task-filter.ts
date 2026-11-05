/**
 * 任务看板的筛选判据：纯函数，只吃已经投影好的任务行与卡片状态。
 *
 * 判据不读盘、不调远程、不订阅，所以每一条都能被单测钉死，`Shell.tsx` 里只剩开关与渲染。
 * 「轨」不在这里出现：`.spec` 的任务没有 track 字段，规格条目的 `module` 是唯一现成的分组维度，
 * 按它分组要先定归属口径（一条任务绑多条跨模块规则时算谁的），留待契约层决定。
 */
import type { TaskCardStatus } from './task-session.ts'

/** 可筛选的任务字段子集；投影行的一个切片，便于测试直接造数据。 */
export interface FilterableTask {
  readonly id: string
  readonly title: string
  readonly grade: string
  readonly rules: readonly string[]
}

/** 会话维度的筛选档：全部、有会话认领、正在动（在跑、等人回答或等首个回合）。 */
export type SessionFilter = 'any' | 'claimed' | 'active'

/** 一条生效的筛选判据；`grades` 为空表示不限分级，`text` 为空表示不限关键字。 */
export interface TaskFilter {
  readonly grades: readonly string[]
  readonly session: SessionFilter
  readonly text: string
}

/** 看板默认态：不过滤。 */
export const EMPTY_TASK_FILTER: TaskFilter = { grades: [], session: 'any', text: '' }

/** 分级可选项，按 A → B → C 的固定顺序呈现。 */
export const TASK_GRADE_CHOICES: readonly string[] = ['A', 'B', 'C']

/**
 * 判据是否真的在过滤；用于决定按钮上要不要显示「生效中」的标记。
 * @param filter - 当前判据。
 * @returns 有任一条判据生效则为 true。
 */
export function isFilterActive(filter: TaskFilter): boolean {
  return filter.grades.length > 0 || filter.session !== 'any' || filter.text.trim() !== ''
}

/**
 * 会话维度上，这条卡片状态属于哪一档。
 * @param status - 卡片状态。
 * @param session - 筛选档。
 * @returns 该档是否命中。
 */
function matchesSession(status: TaskCardStatus, session: SessionFilter): boolean {
  if (session === 'any') return true
  if (session === 'claimed') return status !== 'unstarted'
  return status === 'running' || status === 'awaitingInteraction' || status === 'awaitingFirstTurn'
}

/**
 * 单条任务是否命中判据。
 *
 * 关键字大小写不敏感，命中范围是任务号、标题、分级与规则号——这四样都印在卡片上，
 * 所以「看到什么就能搜什么」，不需要用户先知道内部字段名。
 * @param task - 任务行。
 * @param status - 这条任务当前的卡片状态；会话维度按它判。
 * @param filter - 当前判据。
 * @returns 命中则为 true。
 */
export function matchesTask(task: FilterableTask, status: TaskCardStatus, filter: TaskFilter): boolean {
  if (filter.grades.length > 0 && !filter.grades.includes(task.grade)) return false
  if (!matchesSession(status, filter.session)) return false
  const text = filter.text.trim().toLowerCase()
  if (text === '') return true
  const haystack = [task.id, task.title, task.grade, ...task.rules].join(' ').toLowerCase()
  return haystack.includes(text)
}

/**
 * 按判据筛出一列里的任务，保持原顺序。
 * @param tasks - 该列的全部任务。
 * @param filter - 当前判据。
 * @param statusOf - 取某条任务的卡片状态。
 * @returns 命中的任务；判据不生效时原样返回同一个数组。
 */
export function filterTasks<T extends FilterableTask>(
  tasks: readonly T[],
  filter: TaskFilter,
  statusOf: (task: T) => TaskCardStatus,
): readonly T[] {
  if (!isFilterActive(filter)) return tasks
  return tasks.filter(task => matchesTask(task, statusOf(task), filter))
}
