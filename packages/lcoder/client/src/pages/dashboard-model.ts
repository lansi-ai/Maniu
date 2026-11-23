/**
 * 总览页的只读派生：进度漏斗、唯一主行动与近期动态。
 *
 * 只读已有投影行，不读磁盘、不发命令、不依赖 React；所有数字都能在需求页与任务页对上。
 */

import { stageOf, type TaskStage } from '../spec/board.ts'
import type { RequirementDocRow, TaskRow } from '../spec/rows.ts'
import { pendingReviewRounds } from './requirement-gate.ts'

/** 需求漏斗：只统计草稿、已确认、已上线三种在途状态。 */
export interface RequirementFunnel {
  readonly draft: number
  readonly confirmed: number
  readonly released: number
}

/** 任务漏斗：六列折成四段后的数量。 */
export type TaskFunnel = Readonly<Record<TaskStage, number>>

/**
 * 统计需求漏斗。
 * @param rows - 需求行。
 * @returns 草稿、已确认与已上线数量；已关闭与未知状态不计入。
 */
export function requirementFunnelOf(rows: readonly RequirementDocRow[]): RequirementFunnel {
  let draft = 0
  let confirmed = 0
  let released = 0
  for (const row of rows) {
    if (row.state === 'draft') draft += 1
    else if (row.state === 'confirmed') confirmed += 1
    else if (row.state === 'released') released += 1
  }
  return { draft, confirmed, released }
}

/**
 * 统计任务漏斗。
 * @param rows - 任务行。
 * @returns 四个阶段的未关闭数量。
 */
export function taskFunnelOf(rows: readonly TaskRow[]): TaskFunnel {
  const funnel: Record<TaskStage, number> = { pending: 0, implementing: 0, verifying: 0, closed: 0 }
  for (const row of rows) funnel[stageOf(row)] += 1
  return funnel
}

/** 主行动的种类；优先级从高到低即联合顺序。 */
export type NextActionKind = 'intake' | 'review' | 'staged' | 'verify' | 'develop' | 'browse'

/** 唯一主行动；`count` 是同一分支里等待处理的条数。 */
export interface NextAction {
  readonly kind: NextActionKind
  readonly count: number
  /** 待裁决评审指向的需求编号。 */
  readonly requirementId?: string
  /** 待裁决评审的最大未决轮次。 */
  readonly round?: number
}

/** 主行动的判定输入。 */
export interface NextActionInput {
  readonly requirements: readonly RequirementDocRow[]
  readonly tasks: readonly TaskRow[]
  /** 项目级活原型是否有未落盘的暂存改动。 */
  readonly staged: boolean
}

/**
 * 按固定优先级选出唯一主行动：空项目 → 待裁决评审 → 暂存原型 → 待验收 → 待开工 → 回顾。
 *
 * 待验收先于待开工：已完成的开发等人工验收才会收口，是当前唯一能推动流程的动作。
 * @param input - 需求、任务与暂存状态。
 * @returns 一个主行动；调用方只渲染这一个入口。
 */
export function nextActionOf(input: NextActionInput): NextAction {
  if (input.requirements.length === 0) return { kind: 'intake', count: 0 }

  let target: { readonly id: string; readonly round: number } | null = null
  let reviewCount = 0
  for (const row of input.requirements) {
    const rounds = pendingReviewRounds(row.reviews)
    const round = rounds[rounds.length - 1]
    if (round === undefined) continue
    reviewCount += 1
    if (target === null || round > target.round || (round === target.round && row.id < target.id)) {
      target = { id: row.id, round }
    }
  }
  if (target !== null) {
    return { kind: 'review', count: reviewCount, requirementId: target.id, round: target.round }
  }

  if (input.staged) return { kind: 'staged', count: 1 }

  const funnel = taskFunnelOf(input.tasks)
  if (funnel.verifying > 0) return { kind: 'verify', count: funnel.verifying }
  if (funnel.pending > 0) return { kind: 'develop', count: funnel.pending }
  return { kind: 'browse', count: 0 }
}

/** 近期动态的一条：需求或任务的最近一次变化。 */
export interface ActivityItem {
  readonly kind: 'requirement' | 'task'
  readonly id: string
  readonly title: string
  readonly at: string
}

/** 近期动态默认条数。 */
export const RECENT_ACTIVITY_LIMIT = 5

function newest(values: readonly (string | undefined)[]): string | undefined {
  let best: string | undefined
  let bestTime = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value === undefined || value === '') continue
    const time = Date.parse(value)
    if (Number.isNaN(time) || time <= bestTime) continue
    best = value
    bestTime = time
  }
  return best
}

/**
 * 取需求最近一次变化的时刻。
 * @param row - 需求行。
 * @returns ISO 时刻；没有任何时间字段时为 undefined。
 */
function requirementActivityAt(row: RequirementDocRow): string | undefined {
  return newest([
    row.openedAt,
    row.confirmedAt,
    row.releasedAt,
    row.closedAt,
    row.approvedAt,
    row.prototype?.generatedAt,
    ...row.versions.map(version => version.at),
    ...row.reviews.map(review => review.at),
    ...(row.amendments ?? []).map(amendment => amendment.at),
  ])
}

/**
 * 取任务最近一次变化的时刻。
 * @param row - 任务行。
 * @returns ISO 时刻；没有开立与交付时间时为 undefined。
 */
function taskActivityAt(row: TaskRow): string | undefined {
  return newest([row.openedAt, row.deliverable?.createdAt, row.deliverable?.updatedAt])
}

/**
 * 合并需求与任务的最近变化，按时间倒序取前若干条。
 * @param requirements - 需求行。
 * @param tasks - 任务行。
 * @param limit - 最多返回的条数。
 * @returns 近期动态；没有可解析时间的行不出现。
 */
export function recentActivityOf(
  requirements: readonly RequirementDocRow[],
  tasks: readonly TaskRow[],
  limit = RECENT_ACTIVITY_LIMIT,
): readonly ActivityItem[] {
  const items: { readonly item: ActivityItem; readonly time: number }[] = []
  for (const row of requirements) {
    const at = requirementActivityAt(row)
    if (at === undefined) continue
    items.push({
      item: { kind: 'requirement', id: row.id, title: row.title ?? row.id, at },
      time: Date.parse(at),
    })
  }
  for (const row of tasks) {
    const at = taskActivityAt(row)
    if (at === undefined) continue
    items.push({
      item: { kind: 'task', id: row.id, title: row.title, at },
      time: Date.parse(at),
    })
  }
  return items
    .sort((left, right) => right.time - left.time || (left.item.id < right.item.id ? -1 : left.item.id > right.item.id ? 1 : 0))
    .slice(0, limit)
    .map(entry => entry.item)
}
