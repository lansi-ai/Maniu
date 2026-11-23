/** 任务看板的六列与筛选；列是展示派生，不写回任务文件。 */

import type { TaskRow } from './rows.ts'

/** 看板列 id。 */
export type BoardColumnId = 'drafting' | 'discussion' | 'contracted' | 'implementing' | 'verifying' | 'closed'

/** 一列。 */
export interface BoardColumn {
  readonly id: BoardColumnId
  readonly label: string
}

/** 看板六列，顺序即视觉顺序。 */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { id: 'drafting', label: '需求确认' },
  { id: 'discussion', label: '方案讨论' },
  { id: 'contracted', label: '已签约' },
  { id: 'implementing', label: '实施中' },
  { id: 'verifying', label: '验证中' },
  { id: 'closed', label: '已收口' },
]

/** 任务状态的中文名。 */
export const STATE_LABELS: Readonly<Record<string, string>> = {
  drafting: '起草',
  contracted: '已签约',
  implementing: '实施中',
  verifying: '验证中',
  closed: '已收口',
  unknown: '未知状态',
}

/**
 * 看板列：drafting 里已标轨或有岗位的进「方案讨论」，其余留在「需求确认」。
 * @param task - 任务行。
 * @returns 列 id。
 */
export function boardColumnOf(task: TaskRow): BoardColumnId {
  if (task.state === 'contracted' || task.state === 'implementing'
    || task.state === 'verifying' || task.state === 'closed') return task.state
  if (task.state === 'drafting') {
    return task.track === undefined && task.role === undefined ? 'drafting' : 'discussion'
  }
  return 'drafting'
}

/** 一条任务的运行态。 */
export type TaskRunStatus = 'idle' | 'running' | 'queued'

/**
 * 从认领会话与宿主会话列表推出运行态。
 * @param task - 任务行。
 * @param runningSessions - 正在跑的会话 id。
 * @returns 运行态；未认领为 idle。
 */
export function runStatusOf(task: TaskRow, runningSessions: ReadonlySet<string>): TaskRunStatus {
  if (task.session === undefined) return 'idle'
  return runningSessions.has(task.session) ? 'running' : 'queued'
}

/** 筛选条件。 */
export interface TaskFilter {
  readonly text: string
  readonly grade: string
  readonly column: string
  readonly session: string
  readonly role: string
}

/** 空筛选。 */
export const emptyTaskFilter: TaskFilter = { text: '', grade: '', column: '', session: '', role: '' }

/**
 * 按筛选条件过滤任务。
 * @param tasks - 全部任务。
 * @param filter - 筛选条件。
 * @returns 命中的任务。
 */
export function filterTasks(tasks: readonly TaskRow[], filter: TaskFilter): TaskRow[] {
  const text = filter.text.trim().toLowerCase()
  return tasks.filter((task) => {
    if (filter.grade !== '' && task.grade !== filter.grade) return false
    if (filter.column !== '' && boardColumnOf(task) !== filter.column) return false
    if (filter.session !== '' && task.session !== filter.session) return false
    if (filter.role !== '' && task.role !== filter.role) return false
    if (text === '') return true
    return `${task.id} ${task.title} ${task.description} ${task.rules.join(' ')}`.toLowerCase().includes(text)
  })
}

/** 任务漏斗阶段：把六列折成「待开工 / 开发中 / 待验收 / 已完成」四段。 */
export type TaskStage = 'pending' | 'implementing' | 'verifying' | 'closed'

/** 阶段与看板列的对应，顺序即总览漏斗的视觉顺序。 */
export const TASK_STAGES: readonly { readonly id: TaskStage; readonly columns: readonly BoardColumnId[] }[] = [
  { id: 'pending', columns: ['drafting', 'discussion', 'contracted'] },
  { id: 'implementing', columns: ['implementing'] },
  { id: 'verifying', columns: ['verifying'] },
  { id: 'closed', columns: ['closed'] },
]

/**
 * 任务所属的漏斗阶段。
 * @param task - 任务行。
 * @returns 六列折叠后的阶段。
 */
export function stageOf(task: TaskRow): TaskStage {
  switch (boardColumnOf(task)) {
    case 'drafting':
    case 'discussion':
    case 'contracted':
      return 'pending'
    case 'implementing':
      return 'implementing'
    case 'verifying':
      return 'verifying'
    case 'closed':
      return 'closed'
  }
}

/** 一条需求的状态分类。 */
export function requirementStateLabel(state: string | undefined): string {
  if (state === 'draft') return '草稿'
  if (state === 'confirmed') return '已确认'
  if (state === 'released') return '已上线'
  if (state === 'closed') return '已关闭'
  return '未知状态'
}

/** 任务在某一列里的排序：编号升序。 */
export function sortTasks(tasks: readonly TaskRow[]): TaskRow[] {
  return [...tasks].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}
