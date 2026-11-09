// @vitest-environment jsdom
/**
 * 关系图组件的渲染事实：空态、无会话提示、图例、未知状态，以及任务节点的点击回调。
 * 布局坐标由纯函数测钉死，这里只核「画出来的是什么」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { DashboardGraph } from '../src/client/shell/DashboardGraph.tsx'
import type { DashboardGraphInput } from '../src/client/shell/dashboard-graph.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

const DATA: DashboardGraphInput = {
  tasks: [
    { id: 'T-01', title: '登录接口', state: 'closed' },
    { id: 'T-02', title: '登录限流', state: 'implementing', dependsOn: ['T-01'], session: 's-a' },
  ],
  sessions: [{
    id: 's-a',
    label: '会话 A',
    running: true,
    awaitingInteraction: false,
    pending: 0,
    claims: ['T-02'],
  }],
}

describe('关系图组件', () => {
  it('没有任务时画空态，不画图例', () => {
    render(<DashboardGraph data={{ tasks: [], sessions: DATA.sessions }} t={t} />)

    expect(screen.getByText('暂无可画的任务')).toBeDefined()
    expect(screen.queryByText('依赖')).toBeNull()
  })

  it('任务节点可点，回调收到任务号', () => {
    const onOpenTask = vi.fn()
    render(<DashboardGraph data={DATA} t={t} onOpenTask={onOpenTask} />)

    fireEvent.click(screen.getByRole('button', { name: /T-02/ }))

    expect(onOpenTask).toHaveBeenCalledWith('T-02')
  })

  it('不给回调时任务节点不是按钮', () => {
    render(<DashboardGraph data={DATA} t={t} />)

    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('三类边都有图例；没有会话时提示只显示依赖', () => {
    render(<DashboardGraph data={{ tasks: DATA.tasks, sessions: [] }} t={t} />)

    expect(screen.getByText('依赖')).toBeDefined()
    expect(screen.getByText('会话认领')).toBeDefined()
    expect(screen.getByText('联调组')).toBeDefined()
    expect(screen.getByText('还没有会话，只显示任务依赖')).toBeDefined()
  })

  it('未知状态落到兜底列并显示列名，不抛错', () => {
    render(<DashboardGraph data={{
      tasks: [{ id: 'T-10', title: '外部阻塞', state: 'blocked' }],
      sessions: DATA.sessions,
    }} t={t} />)

    expect(screen.getByText('未知状态')).toBeDefined()
    expect(screen.getByText('外部阻塞')).toBeDefined()
  })
})
