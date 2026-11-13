// @vitest-environment jsdom
/**
 * 需求详情抽屉：四块内容（正文、立项问答、关联任务、讨论历史）与按状态给的动作。
 *
 * 组件只排版与派发回调；命令在途、失败原文与 Esc 关闭都在这里钉住。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import type { RequirementDocRow } from '../src/client/projection.ts'
import type { ShellTask } from '../src/client/shell/shell-data.ts'
import { RequirementDetail } from '../src/client/shell/RequirementDetail.tsx'
import type { RequirementDetailProps } from '../src/client/shell/RequirementDetail.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

function requirementOf(overrides: Partial<RequirementDocRow> = {}): RequirementDocRow {
  return {
    id: 'REQ-01',
    title: '随手记账',
    text: '# 项目需求概要 V1\n\n第一版只做记一笔与翻记录。',
    options: [{ name: '复用现成表单', summary: '一周能上线', cost: '零成本' }],
    recommendation: '先做借还闭环',
    state: 'confirmed',
    openedAt: '2026-11-10T09:00:00.000Z',
    confirmedAt: '2026-11-11T09:00:00.000Z',
    ...overrides,
  }
}

function taskOf(
  id: string,
  title: string,
  state: ShellTask['state'] = 'drafting',
  overrides: Partial<ShellTask> = {},
): ShellTask {
  return {
    id,
    title,
    description: '',
    attachments: [],
    state,
    grade: 'B',
    rules: [],
    evidence: [],
    surface: '',
    paths: [],
    irreversible: [],
    requirement: 'REQ-01',
    track: 'h5',
    ...overrides,
  }
}

function propsOf(overrides: Partial<RequirementDetailProps> = {}): RequirementDetailProps {
  return {
    t,
    row: requirementOf(),
    progress: 'confirmed',
    tasks: [taskOf('T-01', '记一笔'), taskOf('T-02', '翻记录', 'implementing')],
    answers: [],
    splitting: false,
    splitFlow: null,
    error: null,
    actionBusy: null,
    actionResult: null,
    taskStateLabel: task => task.state,
    trackLabel: track => track ?? '',
    onClose: vi.fn(),
    onApprove: vi.fn(),
    onSplit: vi.fn(),
    onRelease: vi.fn(),
    onCancel: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenDoc: vi.fn(),
    historyOpen: false,
    history: { status: 'idle', groups: [] },
    onOpenHistory: vi.fn(),
    onCloseHistory: vi.fn(),
    ...overrides,
  }
}

describe('抽屉四块内容', () => {
  it('画出正文、候选与推荐', () => {
    const { container } = render(<RequirementDetail {...propsOf()} />)

    expect(screen.getByText('REQ-01 · 随手记账')).toBeTruthy()
    expect(container.querySelector('[data-requirement-document-body]')?.textContent)
      .toContain('第一版只做记一笔与翻记录。')
    expect(screen.getByText('复用现成表单')).toBeTruthy()
    expect(screen.getByText('先做借还闭环')).toBeTruthy()
  })

  it('立项问答按题展示；没有记录时如实空态', () => {
    const answers = [{ id: 'q1', header: '用途', question: '主要给谁用？', answer: '个人记账小工具' }]
    render(<RequirementDetail {...propsOf({ answers })} />)

    expect(screen.getByText('主要给谁用？')).toBeTruthy()
    expect(screen.getByText('个人记账小工具')).toBeTruthy()

    cleanup()
    render(<RequirementDetail {...propsOf()} />)
    expect(screen.getByText(zh['shell.requirementAnswersEmpty'])).toBeTruthy()
  })

  it('关联任务列编号、标题、状态与轨；点一条交给外壳打开任务', () => {
    const onOpenTask = vi.fn()
    const { container } = render(<RequirementDetail {...propsOf({ onOpenTask })} />)

    expect(container.querySelector('[data-requirement-task="T-01"]')?.textContent).toContain('记一笔')
    expect(container.querySelector('[data-requirement-task="T-02"]')?.textContent).toContain('implementing')
    expect(container.querySelector('[data-requirement-task="T-01"]')?.textContent).toContain('h5')

    fireEvent.click(within(container.querySelector('[data-requirement-task="T-01"]') as HTMLElement).getByRole('button'))
    expect(onOpenTask).toHaveBeenCalledWith('T-01')
  })

  it('讨论历史入口在抽屉里，点开走回调', () => {
    const onOpenHistory = vi.fn()
    render(<RequirementDetail {...propsOf({ onOpenHistory })} />)

    fireEvent.click(screen.getByRole('button', { name: zh['shell.discussionHistory'] }))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('旧流程纯文档需求只能读，不给任何推进动作', () => {
    const { state: _state, ...legacy } = requirementOf({ id: 'P-01', title: '旧方案需求' })
    void _state
    render(<RequirementDetail {...propsOf({ row: legacy, progress: 'pending' })} />)

    expect(screen.getByText(zh['shell.requirementLegacyReadonly'])).toBeTruthy()
    for (const key of ['shell.confirmRequirement', 'shell.splitTasks', 'shell.requirementRelease',
      'shell.requirementClose'] as const) {
      expect(screen.queryByRole('button', { name: zh[key] })).toBeNull()
    }
  })
})

describe('按状态给动作', () => {
  it('待确认给确认与关闭；确认回调带状态', () => {
    const onApprove = vi.fn()
    render(<RequirementDetail {...propsOf({ row: requirementOf({ state: 'draft' }), progress: 'pending', onApprove })} />)

    fireEvent.click(screen.getByRole('button', { name: zh['shell.confirmRequirement'] }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: zh['shell.requirementClose'] })).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['shell.splitTasks'] })).toBeNull()
  })

  it('已确认给拆分、发布与关闭，三个回调各走各的', () => {
    const onSplit = vi.fn()
    const onRelease = vi.fn()
    const onCancel = vi.fn()
    render(<RequirementDetail {...propsOf({ onSplit, onRelease, onCancel })} />)

    fireEvent.click(screen.getByRole('button', { name: zh['shell.splitTasks'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.requirementRelease'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.requirementClose'] }))
    expect(onSplit).toHaveBeenCalledTimes(1)
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('已拆分与开发中不给拆分入口，但仍可发布与关闭', () => {
    for (const progress of ['split', 'developing', 'testing', 'ready-release'] as const) {
      render(<RequirementDetail {...propsOf({ progress })} />)
      expect(screen.queryByRole('button', { name: zh['shell.splitTasks'] })).toBeNull()
      expect(screen.getByRole('button', { name: zh['shell.requirementRelease'] })).toBeTruthy()
      cleanup()
    }
  })

  it('已上线与已取消不给动作', () => {
    for (const progress of ['released', 'cancelled'] as const) {
      render(<RequirementDetail {...propsOf({ progress })} />)
      for (const key of ['shell.confirmRequirement', 'shell.splitTasks', 'shell.requirementRelease',
        'shell.requirementClose'] as const) {
        expect(screen.queryByRole('button', { name: zh[key] })).toBeNull()
      }
      cleanup()
    }
  })

  it('拆分在途时按钮禁用并显示正在拆分', () => {
    render(<RequirementDetail {...propsOf({ splitting: true, splitFlow: { status: 'running', newTasks: [] } })} />)

    expect(screen.getByText(zh['shell.splitPmRunning'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['shell.splittingTasks'] })).toHaveProperty('disabled', true)
  })

  it('失败原文与命令回执都就地显示', () => {
    render(<RequirementDetail {...propsOf({
      error: '拆分指令发送失败（超时）',
      actionResult: { ok: false, text: 'REQ-01 已上线，是终态' },
    })} />)

    expect(screen.getByText('拆分指令发送失败（超时）')).toBeTruthy()
    expect(screen.getByText('REQ-01 已上线，是终态')).toBeTruthy()
  })
})

describe('Esc 关闭', () => {
  it('没有历史抽屉时关抽屉', () => {
    const onClose = vi.fn()
    render(<RequirementDetail {...propsOf({ onClose })} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('历史抽屉打开时先收历史，不关抽屉', () => {
    const onClose = vi.fn()
    const onCloseHistory = vi.fn()
    render(<RequirementDetail {...propsOf({ onClose, onCloseHistory, historyOpen: true })} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseHistory).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('需求详情的交付物汇总', () => {
  const deliverable = {
    summary: '交付基础框架说明',
    docs: ['README.md', 'docs/architecture.md'],
    commands: ['pnpm typecheck'],
    updatedAt: '2026-11-13T11:00:00.000Z',
  }

  it('按关联任务汇总摘要与文档，任务编号可跳转、文档可预览', () => {
    const onOpenTask = vi.fn()
    const onOpenDoc = vi.fn()
    const { container } = render(
      <RequirementDetail {...propsOf({
        tasks: [
          taskOf('T-01', '记一笔', 'implementing', { deliverable }),
          taskOf('T-02', '翻记录', 'implementing'),
        ],
        onOpenTask,
        onOpenDoc,
      })} />,
    )

    const section = container.querySelector('[data-requirement-deliverables]')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain('交付基础框架说明')
    expect(section?.textContent).toContain('README.md')
    expect(section?.textContent).toContain('pnpm typecheck')
    expect(section?.textContent).not.toContain('翻记录')

    fireEvent.click(container.querySelector('[data-deliverable-task-link="T-01"]') as HTMLElement)
    expect(onOpenTask).toHaveBeenCalledWith('T-01')

    fireEvent.click(container.querySelector('[data-deliverable-doc="docs/architecture.md"]') as HTMLElement)
    expect(onOpenDoc).toHaveBeenCalledWith('docs/architecture.md')
  })

  it('没有任务登记交付物时不画汇总区', () => {
    const { container } = render(<RequirementDetail {...propsOf()} />)
    expect(container.querySelector('[data-requirement-deliverables]')).toBeNull()
  })
})
