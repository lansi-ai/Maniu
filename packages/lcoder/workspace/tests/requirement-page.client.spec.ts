/**
 * 需求页派生数据：九态、关联任务、更新时间、筛选与分组。
 *
 * 进度一律来自 kernel 的派生函数；这里钉住外壳如何把需求行与任务对起来。
 */
import { describe, expect, it } from 'vitest'
import type { RequirementDocRow } from '../src/client/projection.ts'
import type { ShellTask } from '../src/client/shell/shell-data.ts'
import {
  EMPTY_REQUIREMENT_FILTER, REQUIREMENT_BOARD_COLUMNS, filterRequirementViews, groupRequirements,
  isRequirementFilterActive, isRequirementId, requirementTasksOf, requirementViewRows,
} from '../src/client/shell/requirement-page.ts'

/** 一条需求投影行；正文默认非空。 */
function rowOf(id: string, overrides: Partial<RequirementDocRow> = {}): RequirementDocRow {
  return {
    id,
    title: `${id} 的标题`,
    text: `# ${id}\n\n正文`,
    options: [],
    state: 'draft',
    openedAt: '2026-11-10T09:00:00.000Z',
    ...overrides,
  }
}

/** 一条任务；默认起草态、回指 REQ-01、标 h5 轨。 */
function taskOf(id: string, overrides: Partial<ShellTask> = {}): ShellTask {
  return {
    id,
    title: `${id} 的任务`,
    description: '',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: [],
    evidence: [],
    surface: '读 / 契约',
    paths: [],
    irreversible: [],
    requirement: 'REQ-01',
    track: 'h5',
    ...overrides,
  }
}

describe('需求编号', () => {
  it('只认 REQ- 加两位以上数字；旧方案编号不认', () => {
    expect(isRequirementId('REQ-01')).toBe(true)
    expect(isRequirementId('REQ-100')).toBe(true)
    expect(isRequirementId('P-01')).toBe(false)
    expect(isRequirementId('REQ-1')).toBe(false)
  })
})

describe('九态派生', () => {
  it('终态先于一切：已取消与已上线不受正文和任务影响', () => {
    const views = requirementViewRows([
      rowOf('REQ-01', { state: 'closed' }),
      rowOf('REQ-02', { state: 'released' }),
    ], [])
    expect(views.map(view => view.progress)).toEqual(['cancelled', 'released'])
  })

  it('没有正文时是待补全，哪怕状态已确认', () => {
    const views = requirementViewRows([
      rowOf('REQ-01', { state: 'confirmed', text: '' }),
    ], [taskOf('T-01', { state: 'implementing' })])
    expect(views[0]?.progress).toBe('incomplete')
  })

  it('起草态有正文是待确认，确认后没有任务是已确认', () => {
    const views = requirementViewRows([
      rowOf('REQ-01', { state: 'draft' }),
      rowOf('REQ-02', { state: 'confirmed' }),
    ], [])
    expect(views.map(view => view.progress)).toEqual(['pending', 'confirmed'])
  })

  it('有任务时按任务状态推出已拆分、开发中、测试中、待上线', () => {
    const views = requirementViewRows([
      rowOf('REQ-01', { state: 'confirmed' }), rowOf('REQ-02', { state: 'confirmed' }),
      rowOf('REQ-03', { state: 'confirmed' }), rowOf('REQ-04', { state: 'confirmed' }),
    ], [
      taskOf('T-01', { requirement: 'REQ-02', state: 'drafting' }),
      taskOf('T-02', { requirement: 'REQ-03', state: 'implementing' }),
      taskOf('T-03', { requirement: 'REQ-04', state: 'verifying' }),
    ])
    expect(views.map(view => view.progress)).toEqual(['confirmed', 'split', 'developing', 'testing'])
  })

  it('全部任务收口时是待上线', () => {
    const views = requirementViewRows([rowOf('REQ-01', { state: 'confirmed' })], [
      taskOf('T-01', { state: 'closed' }),
      taskOf('T-02', { state: 'closed' }),
    ])
    expect(views[0]?.progress).toBe('ready-release')
  })

  it('旧数据没有状态时按起草处理；读不懂的状态也给待确认', () => {
    const legacy: RequirementDocRow = { id: 'P-01', text: '# 旧方案需求\n\n正文', options: [] }
    const views = requirementViewRows([
      legacy,
      rowOf('REQ-02', { state: 'unknown' }),
    ], [])
    expect(views.map(view => view.progress)).toEqual(['pending', 'pending'])
  })
})

describe('关联任务与更新时间', () => {
  it('新流程按 requirement 匹配；旧任务只有 proposal 时也挂回同一需求', () => {
    const requirement = rowOf('REQ-01')
    const { requirement: _requirement, ...legacy } = taskOf('T-02')
    void _requirement
    const tasks = [
      taskOf('T-01'),
      { ...legacy, proposal: 'REQ-01' } as ShellTask,
      taskOf('T-03', { requirement: 'REQ-02' }),
    ]
    expect(requirementTasksOf(requirement, tasks).map(task => task.id)).toEqual(['T-01', 'T-02'])
  })

  it('更新时间取四个时刻里最近的一个；都没写时不给值', () => {
    const [view] = requirementViewRows([rowOf('REQ-01', {
      confirmedAt: '2026-11-11T09:00:00.000Z',
      releasedAt: '2026-11-13T09:00:00.000Z',
    })], [])
    expect(view?.updatedAt).toBe('2026-11-13T09:00:00.000Z')

    const bare: RequirementDocRow = { id: 'REQ-02', title: '没有时刻', text: '# x', options: [], state: 'draft' }
    const [empty] = requirementViewRows([bare], [])
    expect(empty?.updatedAt).toBeUndefined()
  })
})

describe('筛选与分组', () => {
  const views = requirementViewRows([
    rowOf('REQ-01', { title: '记账' }),
    rowOf('REQ-02', { title: '积分', state: 'confirmed' }),
    rowOf('REQ-03', { title: '已取消', state: 'closed' }),
    rowOf('REQ-04', { title: '开发中的', text: '# 需求\n\n搜索命中词', state: 'confirmed' }),
  ], [taskOf('T-01', { requirement: 'REQ-04', state: 'implementing' })])

  it('已取消默认隐藏；开关打开后才出现', () => {
    expect(filterRequirementViews(views, EMPTY_REQUIREMENT_FILTER, false).map(view => view.row.id))
      .toEqual(['REQ-01', 'REQ-02', 'REQ-04'])
    expect(filterRequirementViews(views, EMPTY_REQUIREMENT_FILTER, true).map(view => view.row.id))
      .toEqual(['REQ-01', 'REQ-02', 'REQ-03', 'REQ-04'])
  })

  it('关键字匹配编号、标题与正文，状态可多选', () => {
    expect(filterRequirementViews(views, { text: 'REQ-02', states: [] }, false).map(view => view.row.id))
      .toEqual(['REQ-02'])
    expect(filterRequirementViews(views, { text: '搜索命中词', states: [] }, false).map(view => view.row.id))
      .toEqual(['REQ-04'])
    expect(filterRequirementViews(views, { text: '', states: ['confirmed', 'developing'] }, false).map(view => view.row.id))
      .toEqual(['REQ-02', 'REQ-04'])
  })

  it('筛选是否生效只看关键字与状态，不含已取消开关', () => {
    expect(isRequirementFilterActive(EMPTY_REQUIREMENT_FILTER)).toBe(false)
    expect(isRequirementFilterActive({ text: ' ', states: [] })).toBe(false)
    expect(isRequirementFilterActive({ text: '记账', states: [] })).toBe(true)
    expect(isRequirementFilterActive({ text: '', states: ['pending'] })).toBe(true)
  })

  it('看板按固定列序分组，只给非空列', () => {
    const groups = groupRequirements(filterRequirementViews(views, EMPTY_REQUIREMENT_FILTER, false), REQUIREMENT_BOARD_COLUMNS)
    expect(groups.map(group => group.id)).toEqual(['pending', 'confirmed', 'developing'])
    expect(groups[0]?.rows[0]?.row.id).toBe('REQ-01')
    expect(groups[1]?.rows[0]?.row.id).toBe('REQ-02')
    expect(groups[2]?.rows[0]?.row.id).toBe('REQ-04')
  })
})
