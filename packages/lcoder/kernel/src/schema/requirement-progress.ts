/**
 * 需求进度：把「需求状态 + 正文是否存在 + 关联任务状态」折成一个稳定 id。
 *
 * 这张表只回答「这条需求现在处在哪一步」，不写任何文件、不读磁盘、不依赖运行时包，
 * 所以宿主与浏览器投影可以共用同一份判定。中文显示名交给界面词典，
 * 这里只出 id——两处各写一套文案时，状态与标签迟早会对不上。
 */
import type { RequirementState, TaskState } from './spec.js'

/** 需求在界面上可能处的九种进度。 */
export type RequirementProgressId =
  | 'cancelled'
  | 'released'
  | 'incomplete'
  | 'pending'
  | 'confirmed'
  | 'developing'
  | 'testing'
  | 'ready-release'
  | 'split'

/** 一条需求与它的关联任务；任务状态只取判定需要的三态语义。 */
export interface RequirementProgressInput {
  /** YAML 里写的需求状态。 */
  readonly state: RequirementState
  /** 同名 `.md` 是否存在且正文非空。 */
  readonly hasDocument: boolean
  /** 回指这条需求的全部任务状态；没有任务就是空数组。 */
  readonly tasks: readonly TaskState[]
}

/**
 * 按固定优先级折出进度。
 *
 * 顺序是刻意的：终态先于一切中间态，正文缺失先于「待确认」——一条没有正文的
 * confirmed 需求仍然要先补齐正文才有可执行内容；任务进展只在前面的条件都不成立时才有意义。
 * @param input - 需求状态、正文是否存在、关联任务状态。
 * @returns 优先级最高的进度 id。
 */
export function requirementProgress(input: RequirementProgressInput): RequirementProgressId {
  const { state, hasDocument, tasks } = input
  if (state === 'closed') return 'cancelled'
  if (state === 'released') return 'released'
  if (!hasDocument) return 'incomplete'
  if (state === 'draft') return 'pending'
  if (tasks.length === 0) return 'confirmed'
  if (tasks.some(task => task === 'implementing')) return 'developing'
  if (tasks.some(task => task === 'verifying')) return 'testing'
  if (tasks.every(task => task === 'closed')) return 'ready-release'
  return 'split'
}
