/**
 * 需求页的派生数据：进度、关联任务、更新时间、筛选与看板分列。
 *
 * 九态一律调用 kernel 的 `requirementProgress` 折出，界面不另写一套判断；
 * 这里只负责把投影行与任务对起来、按视图顺序排好，供表格与看板共用。
 */
import { requirementProgress } from '@lcoder/kernel/src/schema/requirement-progress.ts'
import type { RequirementProgressId } from '@lcoder/kernel/src/schema/requirement-progress.ts'

export type { RequirementProgressId }
import type { LcoderWorkspaceKey } from '../locales.ts'
import type { RequirementDocRow } from '../projection.ts'
import type { ShellTask } from './shell-data.ts'

/** 一条需求的稳定编号形态；旧流程的纯文档需求用方案编号，不满足这个形态。 */
export const REQUIREMENT_ID_PATTERN = /^REQ-\d{2,}$/

/**
 * 是不是新流程的需求编号。
 * @param id - 投影里的需求编号。
 * @returns 形如 `REQ-01` 时为 true。
 */
export function isRequirementId(id: string): boolean {
  return REQUIREMENT_ID_PATTERN.test(id)
}

/** 需求看板列：前八态依次成列，已取消由「显示已取消」切换单列。 */
export const REQUIREMENT_BOARD_COLUMNS: readonly RequirementProgressId[] = [
  'incomplete',
  'pending',
  'confirmed',
  'split',
  'developing',
  'testing',
  'ready-release',
  'released',
]

/** 九态到词典键；表格、看板与详情共用这一份。 */
export const REQUIREMENT_PROGRESS_LABEL: Readonly<Record<RequirementProgressId, LcoderWorkspaceKey>> = {
  cancelled: 'shell.requirementStateCancelled',
  released: 'shell.requirementStateReleased',
  incomplete: 'shell.requirementStateIncomplete',
  pending: 'shell.requirementStatePending',
  confirmed: 'shell.requirementStateConfirmed',
  developing: 'shell.requirementStateDeveloping',
  testing: 'shell.requirementStateTesting',
  'ready-release': 'shell.requirementStateReadyRelease',
  split: 'shell.requirementStateSplit',
}

/** 一列需求在表格与看板上的展示值。 */
export interface RequirementViewRow {
  readonly row: RequirementDocRow
  /** kernel 折出的九态之一。 */
  readonly progress: RequirementProgressId
  /** 回指这条需求的任务，按投影顺序。 */
  readonly tasks: readonly ShellTask[]
  /** 最近一次状态变化的时刻；文件里四个时刻都缺失时为 undefined。 */
  readonly updatedAt?: string
  /** 同名正文是否非空；详情与拆分都以此判断完整性。 */
  readonly hasDocument: boolean
}

/** 需求筛选：关键字与九态多选；空状态集表示不按状态过滤。 */
export interface RequirementFilter {
  readonly text: string
  readonly states: readonly RequirementProgressId[]
}

/** 清空后的筛选。 */
export const EMPTY_REQUIREMENT_FILTER: RequirementFilter = { text: '', states: [] }

/**
 * 筛选是否生效；入口据此显示计数与清除。
 * @param filter - 当前筛选。
 * @returns 有关键字或状态条件时为 true。
 */
export function isRequirementFilterActive(filter: RequirementFilter): boolean {
  return filter.text.trim() !== '' || filter.states.length > 0
}

/**
 * 回指一条需求的任务。
 *
 * 新流程读 `requirement`，旧任务只有 `proposal`；两者都按编号匹配，
 * 旧仓库的数据仍能挂回对应需求。
 * @param row - 需求行。
 * @param tasks - 当前投影里的全部任务。
 * @returns 按投影顺序的回指任务。
 */
export function requirementTasksOf(row: RequirementDocRow, tasks: readonly ShellTask[]): readonly ShellTask[] {
  return tasks.filter(task => task.requirement === row.id || (task.requirement === undefined && task.proposal === row.id))
}

/** 需求 YAML 里可缺省的状态折成 kernel 认识的四态；读不懂按起草处理。 */
function stateOf(row: RequirementDocRow): 'draft' | 'confirmed' | 'released' | 'closed' {
  return row.state === 'confirmed' || row.state === 'released' || row.state === 'closed' ? row.state : 'draft'
}

/** 四个时刻里最近的一个；都没写时 undefined，界面显示破折号。 */
function updatedAtOf(row: RequirementDocRow): string | undefined {
  const stamps = [row.openedAt, row.confirmedAt, row.releasedAt, row.closedAt]
    .filter((value): value is string => value !== undefined && value !== '')
  if (stamps.length === 0) return undefined
  return stamps.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest))
}

/**
 * 把需求行与任务折成带进度的展示行，默认按编号排序。
 * @param rows - `.spec/requirements/` 的投影行。
 * @param tasks - 当前投影里的全部任务。
 * @returns 按编号升序的展示行。
 */
export function requirementViewRows(
  rows: readonly RequirementDocRow[],
  tasks: readonly ShellTask[],
): readonly RequirementViewRow[] {
  return [...rows]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((row) => {
      const related = requirementTasksOf(row, tasks)
      const hasDocument = row.text.trim() !== ''
      const updatedAt = updatedAtOf(row)
      return {
        row,
        progress: requirementProgress({
          state: stateOf(row),
          hasDocument,
          tasks: related.map(task => task.state),
        }),
        tasks: related,
        hasDocument,
        ...(updatedAt === undefined ? {} : { updatedAt }),
      }
    })
}

/** 关键字命中编号、标题或正文。 */
function matchesText(view: RequirementViewRow, text: string): boolean {
  if (text === '') return true
  const needle = text.toLowerCase()
  return view.row.id.toLowerCase().includes(needle)
    || (view.row.title ?? '').toLowerCase().includes(needle)
    || view.row.text.toLowerCase().includes(needle)
}

/**
 * 按关键字与状态筛选，已取消默认不出现。
 * @param views - 展示行。
 * @param filter - 当前筛选。
 * @param showCancelled - 是否把已取消一起纳入。
 * @returns 满足条件的行，保持编号顺序。
 */
export function filterRequirementViews(
  views: readonly RequirementViewRow[],
  filter: RequirementFilter,
  showCancelled: boolean,
): readonly RequirementViewRow[] {
  const text = filter.text.trim()
  return views.filter((view) => {
    if (!showCancelled && view.progress === 'cancelled') return false
    if (filter.states.length > 0 && !filter.states.includes(view.progress)) return false
    return matchesText(view, text)
  })
}

/**
 * 按进度分到看板列；只返回非空列，列顺序固定。
 * @param views - 已筛选的展示行。
 * @param columns - 要分的列，按视觉顺序。
 * @returns 每列的行；没有行的列不出现。
 */
export function groupRequirements(
  views: readonly RequirementViewRow[],
  columns: readonly RequirementProgressId[],
): readonly { readonly id: RequirementProgressId; readonly rows: readonly RequirementViewRow[] }[] {
  return columns.flatMap((id) => {
    const rows = views.filter(view => view.progress === id)
    return rows.length === 0 ? [] : [{ id, rows }]
  })
}
