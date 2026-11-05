/**
 * 看板筛选判据的纯函数测：三条判据各自独立生效，组合时取交集。
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_TASK_FILTER,
  filterTasks,
  isFilterActive,
  matchesTask,
  type TaskFilter,
} from '../src/client/task-filter.ts'
import type { TaskCardStatus } from '../src/client/task-session.ts'

const TASKS = [
  { id: 'T-01', title: '订单导出', grade: 'A', rules: ['R-01', 'R-02'] },
  { id: 'T-02', title: '工资口径', grade: 'B', rules: ['SAL-01'] },
  { id: 'T-10', title: '退款回滚', grade: 'C', rules: [] },
]

const STATUS: Record<string, TaskCardStatus> = {
  'T-01': 'running',
  'T-02': 'idle',
  'T-10': 'unstarted',
}

const statusOf = (task: { id: string }): TaskCardStatus => STATUS[task.id] ?? 'idle'

describe('看板筛选判据', () => {
  it('判据不生效时原样返回同一数组，不复制', () => {
    expect(filterTasks(TASKS, EMPTY_TASK_FILTER, statusOf)).toBe(TASKS)
    expect(isFilterActive({ grades: [], session: 'any', text: '   ' })).toBe(false)
  })

  it('分级多选取并集，会话档与关键字再取交集', () => {
    const filter: TaskFilter = { grades: ['A', 'C'], session: 'any', text: '' }
    expect(filterTasks(TASKS, filter, statusOf).map(task => task.id)).toEqual(['T-01', 'T-10'])
    const withText: TaskFilter = { ...filter, text: 'r-0' }
    expect(filterTasks(TASKS, withText, statusOf).map(task => task.id)).toEqual(['T-01'])
  })

  it('已认领排除未开始，正在动只留在跑、等人与等首个回合', () => {
    expect(matchesTask(TASKS[2]!, 'unstarted', { ...EMPTY_TASK_FILTER, session: 'claimed' })).toBe(false)
    expect(matchesTask(TASKS[1]!, 'idle', { ...EMPTY_TASK_FILTER, session: 'claimed' })).toBe(true)
    for (const status of ['running', 'awaitingInteraction', 'awaitingFirstTurn'] as const) {
      expect(matchesTask(TASKS[0]!, status, { ...EMPTY_TASK_FILTER, session: 'active' })).toBe(true)
    }
    for (const status of ['idle', 'failed', 'unstarted'] as const) {
      expect(matchesTask(TASKS[0]!, status, { ...EMPTY_TASK_FILTER, session: 'active' })).toBe(false)
    }
  })

  it('关键字大小写不敏感，命中任务号、标题、分级与规则号', () => {
    for (const text of ['sal', '退款', 'b', 'T-1']) {
      const hit = filterTasks(TASKS, { ...EMPTY_TASK_FILTER, text }, statusOf).map(task => task.id)
      expect(hit.length).toBeGreaterThan(0)
    }
    expect(filterTasks(TASKS, { ...EMPTY_TASK_FILTER, text: 'T-1' }, statusOf).map(task => task.id))
      .toEqual(['T-10'])
    expect(filterTasks(TASKS, { ...EMPTY_TASK_FILTER, text: '不存在' }, statusOf)).toEqual([])
  })
})
