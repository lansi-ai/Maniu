// @vitest-environment jsdom
/**
 * 需求页的表格与看板：列头、行点击、视图切换、筛选面板与空态。
 *
 * 页面只画传入的展示行；这里不启动外壳，也不读投影。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import type { RequirementDocRow } from '../src/client/projection.ts'
import type { ShellTask } from '../src/client/shell/shell-data.ts'
import { EMPTY_REQUIREMENT_FILTER, requirementViewRows } from '../src/client/shell/requirement-page.ts'
import { RequirementsPage } from '../src/client/shell/RequirementsPage.tsx'
import type { RequirementsPageProps } from '../src/client/shell/RequirementsPage.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

function rowOf(id: string, title: string, state: RequirementDocRow['state'] = 'draft'): RequirementDocRow {
  return {
    id,
    title,
    text: `# ${title}\n\n正文`,
    options: [],
    state,
    openedAt: '2026-11-10T09:00:00.000Z',
  }
}

function taskOf(id: string, requirement: string): ShellTask {
  return {
    id,
    title: `${id} 的任务`,
    description: '',
    attachments: [],
    state: 'implementing',
    grade: 'B',
    rules: [],
    evidence: [],
    surface: '',
    paths: [],
    irreversible: [],
    requirement,
  }
}

const VIEWS = requirementViewRows([rowOf('REQ-01', '记账'), rowOf('REQ-02', '积分', 'confirmed')], [taskOf('T-01', 'REQ-02')])

function propsOf(overrides: Partial<RequirementsPageProps> = {}): RequirementsPageProps {
  return {
    t,
    views: VIEWS,
    view: 'table',
    filter: EMPTY_REQUIREMENT_FILTER,
    showCancelled: false,
    workspaceReady: true,
    loading: false,
    onViewChange: vi.fn(),
    onFilterChange: vi.fn(),
    onToggleCancelled: vi.fn(),
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  }
}

describe('需求表格', () => {
  it('列出编号、标题、状态、任务数与更新时间；点一行打开详情', () => {
    const onOpen = vi.fn()
    render(<RequirementsPage {...propsOf({ onOpen })} />)

    for (const key of ['shell.requirementNo', 'shell.requirementTitle', 'shell.requirementState',
      'shell.requirementTaskCountHeader', 'shell.requirementUpdatedAt'] as const) {
      expect(screen.getByRole('columnheader', { name: zh[key] })).toBeTruthy()
    }
    expect(screen.getByText('REQ-01')).toBeTruthy()
    expect(screen.getByText('记账')).toBeTruthy()
    expect(screen.getByText(zh['shell.requirementStatePending'], { selector: '[data-requirement-state]' })).toBeTruthy()
    expect(screen.getByText(zh['shell.requirementTaskCount'].replace('{count}', '1'))).toBeTruthy()

    fireEvent.click(screen.getByText('REQ-01'))
    expect(onOpen).toHaveBeenCalledWith('REQ-01')
  })

  it('切换视图与新建需求各走各的回调', () => {
    const onViewChange = vi.fn()
    const onCreate = vi.fn()
    render(<RequirementsPage {...propsOf({ onViewChange, onCreate })} />)

    fireEvent.click(screen.getByRole('button', { name: zh['shell.requirementViewBoard'] }))
    expect(onViewChange).toHaveBeenCalledWith('board')
    fireEvent.click(screen.getAllByRole('button', { name: zh['shell.newRequirement'] })[0]!)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('状态筛选、已取消开关与关键字都交给外壳记录', () => {
    const onFilterChange = vi.fn()
    const onToggleCancelled = vi.fn()
    render(<RequirementsPage {...propsOf({ onFilterChange, onToggleCancelled })} />)

    fireEvent.click(screen.getByRole('button', { name: zh['shell.requirementStateConfirmed'] }))
    expect(onFilterChange).toHaveBeenCalledWith({ text: '', states: ['confirmed'] })
    fireEvent.click(screen.getByRole('button', { name: zh['shell.requirementShowCancelled'] }))
    expect(onToggleCancelled).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '积分' } })
    expect(onFilterChange).toHaveBeenCalledWith({ text: '积分', states: [] })
  })
})

describe('需求看板', () => {
  it('按九态分列，已取消默认不出现', () => {
    const { container } = render(<RequirementsPage {...propsOf({ view: 'board' })} />)

    const pending = container.querySelector('[data-requirement-column="pending"]') as HTMLElement
    const developing = container.querySelector('[data-requirement-column="developing"]') as HTMLElement
    expect(pending).not.toBeNull()
    expect(container.querySelector('[data-requirement-column="cancelled"]')).toBeNull()
    expect(pending.textContent).toContain(zh['shell.requirementStatePending'])
    expect(developing.textContent).toContain(zh['shell.requirementStateDeveloping'])
    expect(developing.textContent).toContain(zh['shell.requirementTaskCount'].replace('{count}', '1'))
  })

  it('打开「显示已取消」后单独成列', () => {
    const views = requirementViewRows([rowOf('REQ-01', '记账'), rowOf('REQ-02', '不要了', 'closed')], [])
    const { container } = render(<RequirementsPage {...propsOf({
      view: 'board',
      views,
      showCancelled: true,
    })} />)

    const cancelled = container.querySelector('[data-requirement-column="cancelled"]') as HTMLElement
    expect(cancelled).not.toBeNull()
    expect(cancelled.textContent).toContain(zh['shell.requirementStateCancelled'])
  })

  it('点卡片打开详情', () => {
    const onOpen = vi.fn()
    const { container } = render(<RequirementsPage {...propsOf({ view: 'board', onOpen })} />)

    fireEvent.click(container.querySelector('[data-requirement-card="REQ-01"]') as HTMLElement)
    expect(onOpen).toHaveBeenCalledWith('REQ-01')
  })
})

describe('空态与未就绪', () => {
  it('没有需求时给新建入口', () => {
    const onCreate = vi.fn()
    render(<RequirementsPage {...propsOf({ views: [], onCreate })} />)

    expect(screen.getByText(zh['shell.requirementEmpty'])).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: zh['shell.newRequirement'] })[0]!)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('没有工作区时不变崩，照实说明', () => {
    render(<RequirementsPage {...propsOf({ workspaceReady: false })} />)
    expect(screen.getByText(zh['shell.noWorkspace'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['shell.newRequirement'] })).toHaveProperty('disabled', true)
  })
})
