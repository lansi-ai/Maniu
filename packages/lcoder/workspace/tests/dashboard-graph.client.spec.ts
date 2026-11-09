/**
 * 关系图布局的纯函数测：同一输入（含顺序不同的同集合输入）得到同一布局；
 * 依赖、会话认领、联调组三类边按来源生成；孤立节点保留、悬空引用不连边；空输入给空态。
 */
import { describe, expect, it } from 'vitest'

import {
  edgePath, GRAPH_PADDING, GRAPH_SECTION_GAP, GRAPH_SESSION_HEIGHT, GRAPH_SESSION_WIDTH, GRAPH_TASK_HEIGHT,
  GRAPH_TASK_WIDTH, GRAPH_COLUMN_GAP, GRAPH_COLUMN_HEADER_HEIGHT, layoutDashboardGraph,
} from '../src/client/shell/dashboard-graph.ts'
import type { DashboardGraphInput, DashboardGraphSession } from '../src/client/shell/dashboard-graph.ts'

const SESSION_A: DashboardGraphSession = {
  id: 's-a',
  label: '会话 A',
  running: true,
  awaitingInteraction: false,
  pending: 2,
  claims: ['T-02'],
  groupTasks: ['T-03', 'T-02'],
}

const SESSION_B: DashboardGraphSession = {
  id: 's-b',
  label: '会话 B',
  running: false,
  awaitingInteraction: false,
  pending: 0,
}

const INPUT: DashboardGraphInput = {
  tasks: [
    { id: 'T-01', title: '登录接口', state: 'closed' },
    { id: 'T-02', title: '登录限流', state: 'implementing', dependsOn: ['T-01'], session: 's-a', role: 'api' },
    { id: 'T-03', title: '登录审计', state: 'drafting', dependsOn: ['T-02'] },
    { id: 'T-04', title: '登录文案', state: 'contracted', session: 's-a' },
    { id: 'T-05', title: '登录回放', state: 'verifying', dependsOn: ['T-99'] },
  ],
  sessions: [SESSION_A, SESSION_B],
}

describe('关系图布局', () => {
  it('同一输入得到同一布局，打乱顺序也不变', () => {
    const first = layoutDashboardGraph(INPUT)
    const second = layoutDashboardGraph(INPUT)
    const shuffled = layoutDashboardGraph({
      tasks: [...INPUT.tasks].reverse(),
      sessions: [...INPUT.sessions].reverse(),
    })

    expect(second).toEqual(first)
    expect(shuffled).toEqual(first)
  })

  it('依赖边从前置任务指向依赖它的任务，悬空前置不连边', () => {
    const layout = layoutDashboardGraph(INPUT)
    const edges = layout.edges.filter(edge => edge.kind === 'depends_on')

    expect(edges.map(edge => [edge.from, edge.to])).toEqual([
      ['task:T-01', 'task:T-02'],
      ['task:T-02', 'task:T-03'],
    ])
    expect(edges.every(edge => Number.isFinite(edge.x1) && Number.isFinite(edge.y2))).toBe(true)
  })

  it('会话认领取 claims 与任务 session 字段的并集', () => {
    const layout = layoutDashboardGraph(INPUT)
    const edges = layout.edges.filter(edge => edge.kind === 'claims')

    expect(edges.map(edge => [edge.from, edge.to])).toEqual([
      ['session:s-a', 'task:T-02'],
      ['session:s-a', 'task:T-04'],
    ])
  })

  it('组内边生成，且已认领的任务不再重复画组边', () => {
    const layout = layoutDashboardGraph(INPUT)
    const edges = layout.edges.filter(edge => edge.kind === 'group')

    expect(edges.map(edge => [edge.from, edge.to])).toEqual([['session:s-a', 'task:T-03']])
  })

  it('孤立任务与会话保留节点，没有边连到它们', () => {
    const layout = layoutDashboardGraph(INPUT)
    const isolated = layout.taskNodes.find(node => node.taskId === 'T-05')
    const idleSession = layout.sessionNodes.find(node => node.sessionId === 's-b')

    expect(isolated).toBeDefined()
    expect(idleSession).toBeDefined()
    expect(layout.edges.some(edge => edge.from === isolated?.id || edge.to === isolated?.id)).toBe(false)
    expect(layout.edges.some(edge => edge.from === idleSession?.id || edge.to === idleSession?.id)).toBe(false)
  })

  it('任务按五态分列，坐标只由列与行决定', () => {
    const layout = layoutDashboardGraph(INPUT)

    expect(layout.columns.map(column => column.state)).toEqual([
      'drafting', 'contracted', 'implementing', 'verifying', 'closed',
    ])
    const drafting = layout.taskNodes.find(node => node.taskId === 'T-03')
    const implementing = layout.taskNodes.find(node => node.taskId === 'T-02')
    expect(drafting).toMatchObject({ column: 0, row: 0, x: GRAPH_PADDING, y: GRAPH_PADDING + GRAPH_COLUMN_HEADER_HEIGHT })
    expect(implementing).toMatchObject({
      column: 2,
      x: GRAPH_PADDING + 2 * (GRAPH_TASK_WIDTH + GRAPH_COLUMN_GAP),
    })
    const session = layout.sessionNodes.find(node => node.sessionId === 's-a')
    expect(session?.y).toBe(GRAPH_PADDING + GRAPH_COLUMN_HEADER_HEIGHT + GRAPH_TASK_HEIGHT + GRAPH_SECTION_GAP)
  })

  it('未知状态落到兜底列，不抛错', () => {
    const layout = layoutDashboardGraph({
      tasks: [{ id: 'T-10', title: '外部阻塞', state: 'blocked' }],
      sessions: [],
    })

    expect(layout.columns.map(column => column.state)).toEqual([
      'drafting', 'contracted', 'implementing', 'verifying', 'closed', 'unknown',
    ])
    expect(layout.taskNodes[0]).toMatchObject({ taskId: 'T-10', state: 'unknown', column: 5 })
  })

  it('自依赖与悬空认领/组任务都不连边', () => {
    const layout = layoutDashboardGraph({
      tasks: [{ id: 'T-20', title: '自依赖', state: 'drafting', dependsOn: ['T-20'] }],
      sessions: [{
        id: 's-x', label: '会话 X', running: false, awaitingInteraction: false, pending: 0,
        claims: ['T-98'], groupTasks: ['T-97'],
      }],
    })

    expect(layout.edges).toEqual([])
  })

  it('边路径用两端锚点与纵向中线上的控制点', () => {
    expect(edgePath({ kind: 'depends_on', from: 'a', to: 'b', x1: 1, y1: 2, x2: 3, y2: 6 }))
      .toBe('M 1 2 C 1 4, 3 4, 3 6')
  })

  it('空输入返回空布局，只有会话时仍排一行', () => {
    const empty = layoutDashboardGraph({ tasks: [], sessions: [] })
    expect(empty).toMatchObject({
      empty: true,
      hasSessions: false,
      taskNodes: [],
      sessionNodes: [],
      edges: [],
      columns: [],
      width: GRAPH_PADDING * 2,
      height: GRAPH_PADDING * 2,
    })

    const sessionsOnly = layoutDashboardGraph({ tasks: [], sessions: [SESSION_A] })
    expect(sessionsOnly.empty).toBe(true)
    expect(sessionsOnly.sessionNodes[0]).toMatchObject({
      x: GRAPH_PADDING, y: GRAPH_PADDING, width: GRAPH_SESSION_WIDTH, height: GRAPH_SESSION_HEIGHT,
    })
    expect(sessionsOnly.columns).toEqual([])
  })
})
