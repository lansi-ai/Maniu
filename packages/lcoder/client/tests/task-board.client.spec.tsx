// @vitest-environment jsdom
/** 任务看板：五栏人话映射、模块端名、可执行/阻塞提示与自然数字排序。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TasksPage } from '../src/pages/tasks.tsx'
import {
  BOARD_COLUMNS,
  STATE_LABELS,
  blockingDependenciesOf,
  sortTasks,
  trackLabel,
} from '../src/spec/board.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { TaskRow } from '../src/spec/rows.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'ws-1',
  scopeSessionId: 'session-1',
  title: 'seed-sandbox',
  path: 'E:/Projects/LCoder/lcoder/seed-sandbox',
}

function makeTask(overrides: Partial<TaskRow> & Pick<TaskRow, 'id' | 'title'>): TaskRow {
  return {
    state: 'drafting',
    grade: 'B',
    description: '',
    paths: [],
    irreversible: [],
    evidence: [],
    rules: [],
    dependsOn: [],
    attachments: [],
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

describe('board helpers', () => {
  it('只保留五栏人话阶段，不再展示需求确认或起草/已签约等行话', () => {
    expect(BOARD_COLUMNS.map(col => col.label)).toEqual([
      '待确认',
      '待开发',
      '开发中',
      '待验收',
      '已完成',
    ])
    expect(STATE_LABELS.drafting).toBe('待确认')
    expect(STATE_LABELS.contracted).toBe('待开发')
  })

  it('将内部轨标识映射为人类可读模块名', () => {
    expect(trackLabel('api')).toBe('后端接口')
    expect(trackLabel('h5')).toBe('前端页面')
    expect(trackLabel('general')).toBe('通用基础')
    expect(trackLabel('custom-track')).toBe('custom-track')
    expect(trackLabel(undefined)).toBeUndefined()
  })

  it('按可执行优先、自然数字编号顺序排列任务（T-02 在 T-10 前）', () => {
    const t01 = makeTask({ id: 'T-01', title: '已完成前置', state: 'closed' })
    const t02 = makeTask({ id: 'T-02', title: '可立即开始', state: 'drafting', dependsOn: ['T-01'] })
    const t03 = makeTask({ id: 'T-03', title: '被阻塞任务', state: 'drafting', dependsOn: ['T-02'] })
    const t10 = makeTask({ id: 'T-10', title: '十号可开始', state: 'drafting', dependsOn: [] })

    expect(blockingDependenciesOf(t02, [t01, t02, t03, t10])).toEqual([])
    expect(blockingDependenciesOf(t03, [t01, t02, t03, t10])).toEqual(['T-02'])

    const sorted = sortTasks([t10, t03, t02], [t01, t02, t03, t10])
    expect(sorted.map(t => t.id)).toEqual(['T-02', 'T-10', 'T-03'])
  })
})

describe('TasksPage board cards', () => {
  it('卡片不展示冗余状态与「轨」字，清晰标出可开始与需先完成前置', async () => {
    const t01 = makeTask({ id: 'T-01', title: '基础骨架', state: 'drafting', track: 'general', role: 'api-dev' })
    const t02 = makeTask({
      id: 'T-02',
      title: '报销列表页',
      state: 'drafting',
      track: 'h5',
      dependsOn: ['T-01'],
      role: 'fe-dev',
    })
    const projection: SpecProjection = {
      root: `${PROJECT.path}/.spec`,
      project: { name: 'seed-sandbox', description: '', tracks: [] },
      requirements: [],
      proposals: [],
      tasks: [t01, t02],
      contracts: [],
      deliverables: [],
      roles: [],
      rules: [],
      flow: null,
      automation: null,
      env: null,
      issues: [],
    }

    await act(async () => {
      root.render(
        <TasksPage
          project={PROJECT}
          projection={projection}
          sessions={[]}
          onOpenDoc={vi.fn()}
          onReload={vi.fn()}
        />,
      )
    })

    const text = container.textContent ?? ''
    expect(text).toContain('待确认')
    expect(text).toContain('可开始')
    expect(text).toContain('需先完成 T-01')
    expect(text).toContain('通用基础')
    expect(text).toContain('前端页面')
    expect(text).not.toContain('起草')
    expect(text).not.toContain('轨 ')
  })
})
