// @vitest-environment jsdom
/**
 * 立项结果页与重开确认框的渲染。
 *
 * 结果页三态各画一次：有需求画需求、任务与项目信息；没有需求给立项入口；
 * 投影读不到时显示 problems 原话。确认框的计数一律来自 props，零也要看得见。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import type { RequirementDocRow } from '../src/client/projection.ts'
import type { ShellProjectInfo, ShellTask } from '../src/client/shell/shell-data.ts'
import {
  IntakeRestartDialog, IntakeResultPage, type IntakeResultPageProps,
} from '../src/client/shell/IntakeResultPage.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

/** 一份结果页用的需求。 */
function requirementOf(
  id: string,
  title: string,
  state: RequirementDocRow['state'] = 'draft',
): RequirementDocRow {
  return {
    id,
    title,
    text: `# ${title}

${title}要解决的问题。`,
    options: [{ name: 'A 方案', summary: '快', cost: '零成本' }],
    recommendation: `推荐 ${id}`,
    state,
  }
}

/** 一条任务；`requirement` 缺省时与靶仓 T-01 一样没有回指。 */
function taskOf(id: string, title: string, requirement?: string): ShellTask {
  return {
    id,
    title,
    description: '',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: [],
    evidence: [],
    surface: '读 / 契约',
    paths: [],
    irreversible: [],
    ...(requirement === undefined ? {} : { requirement }),
  }
}

const INFO: ShellProjectInfo = {
  kind: 'web',
  repoUrl: 'E:/demo',
  branch: 'main',
  docs: { product: '', architecture: '', tests: '' },
  environments: [],
  tracks: [],
}

/** 结果页 props；各用例只覆盖自己关心的字段。 */
function propsOf(overrides: Partial<IntakeResultPageProps> = {}): IntakeResultPageProps {
  return {
    t,
    requirements: [],
    tasks: [],
    info: null,
    problems: [],
    modelBlocked: false,
    canRestart: true,
    onBack: vi.fn(),
    onRestart: vi.fn(),
    onStartOnboarding: vi.fn(),
    ...overrides,
  }
}

describe('立项结果页', () => {
  it('默认展示编号最大的需求，可切到其它需求并显示总数', () => {
    const { container } = render(<IntakeResultPage {...propsOf({
      requirements: [requirementOf('REQ-01', '旧需求'), requirementOf('REQ-02', '新需求')],
    })} />)

    expect(screen.getByText(/新需求/, { selector: '[data-intake-requirement-title]' })).toBeTruthy()
    expect(screen.queryByText(/^旧需求$/)).toBeNull()
    expect(container.textContent).toContain(zh['shell.resultRequirementCount'].replace('{count}', '2'))

    fireEvent.click(screen.getByRole('button', { name: 'REQ-01' }))
    expect(screen.getByText(/旧需求/, { selector: '[data-intake-requirement-title]' })).toBeTruthy()
  })

  it('画出正文、候选、推荐与状态', () => {
    render(<IntakeResultPage {...propsOf({
      requirements: [requirementOf('REQ-01', '新需求', 'confirmed')],
    })} />)

    expect(screen.getByText(/新需求要解决的问题/)).toBeTruthy()
    expect(screen.getByText('A 方案')).toBeTruthy()
    expect(screen.getByText('推荐 REQ-01')).toBeTruthy()
    expect(screen.getByText(new RegExp(zh['shell.requirementStateConfirmed']))).toBeTruthy()
  })

  it('靶仓 T-01 没有 requirement 字段也照样列出，只有回指当前需求的才标注', () => {
    const { container } = render(<IntakeResultPage {...propsOf({
      requirements: [requirementOf('REQ-01', '新需求')],
      tasks: [taskOf('T-01', '记一条待办'), taskOf('T-02', '拆出来的任务', 'REQ-01')],
    })} />)

    expect(container.querySelector('[data-intake-task="T-01"]')).not.toBeNull()
    expect(container.querySelector('[data-intake-task="T-01"]')?.textContent).toContain('记一条待办')
    expect(container.querySelector('[data-intake-task="T-02"]')?.textContent).toContain(zh['shell.resultTaskOfRequirement'])
    expect(container.querySelector('[data-intake-task="T-01"]')?.textContent)
      .not.toContain(zh['shell.resultTaskOfRequirement'])
  })

  it('项目信息摘要画类型、地址、分支与三份文档路径', () => {
    const { container } = render(<IntakeResultPage {...propsOf({
      requirements: [requirementOf('REQ-01', '新需求')],
      info: INFO,
    })} />)

    expect(container.textContent).toContain('web')
    expect(container.textContent).toContain('E:/demo')
    expect(container.textContent).toContain('main')
    for (const key of ['shell.productDoc', 'shell.architectureDoc', 'shell.tests'] as const) {
      expect(container.textContent).toContain(zh[key])
    }
  })

  it('项目信息为 null 时写未登记或读不到', () => {
    const { container } = render(<IntakeResultPage {...propsOf({
      requirements: [requirementOf('REQ-01', '新需求')],
    })} />)
    expect(container.textContent).toContain(zh['shell.resultProjectMissing'])
  })

  it('还没有需求时给出两档立项入口', () => {
    const onStartOnboarding = vi.fn()
    render(<IntakeResultPage {...propsOf({ onStartOnboarding })} />)

    expect(screen.getByText(zh['shell.resultNoRequirement'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.onboardingExistingDocs'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.onboardingNewProject'] }))
    expect(onStartOnboarding.mock.calls).toEqual([['docs'], ['new']])
  })

  it('需求投影读不到时显示 problems 原话，不再给立项入口', () => {
    render(<IntakeResultPage {...propsOf({ problems: ['.spec/requirements/REQ-01.yaml: 不是能读的需求文件'] })} />)

    expect(screen.getByText('.spec/requirements/REQ-01.yaml: 不是能读的需求文件')).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['shell.onboardingNewProject'] })).toBeNull()
  })

  it('页头返回与重新开始各走各的回调', () => {
    const onBack = vi.fn()
    const onRestart = vi.fn()
    render(<IntakeResultPage {...propsOf({
      requirements: [requirementOf('REQ-01', '新需求')],
      onBack,
      onRestart,
    })} />)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['shell.backToBoard']) }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.restartIntake'] }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onRestart).toHaveBeenCalledTimes(1)
  })
})

describe('重开确认框', () => {
  it('零任务、零方案、项目未登记都如实列出，并说明不清空落盘内容', () => {
    const { container } = render(<IntakeRestartDialog
      t={t}
      artifacts={{ projectRegistered: false, rules: 0, tasks: 0, drafting: 0, proposals: 0 }}
      busy={false}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />)

    expect(container.querySelector('[data-restart-project]')?.textContent).toBe(zh['shell.restartUnregistered'])
    expect(container.querySelector('[data-restart-rules]')?.textContent).toBe('0')
    expect(container.querySelector('[data-restart-tasks]')?.textContent).toBe('0')
    expect(container.querySelector('[data-restart-drafting]')?.textContent).toBe('0')
    expect(container.querySelector('[data-restart-proposals]')?.textContent).toBe('0')
    expect(container.textContent).toContain(zh['shell.restartKeep'])
  })

  it('有产物时列出真实数量，主按钮触发确认、次按钮取消', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const { container } = render(<IntakeRestartDialog
      t={t}
      artifacts={{ projectRegistered: true, rules: 2, tasks: 3, drafting: 1, proposals: 1 }}
      busy={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />)

    expect(container.querySelector('[data-restart-rules]')?.textContent).toBe('2')
    expect(container.querySelector('[data-restart-tasks]')?.textContent).toBe('3')
    expect(container.querySelector('[data-restart-drafting]')?.textContent).toBe('1')
    expect(container.querySelector('[data-restart-proposals]')?.textContent).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: zh['shell.cancel'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.restartConfirm'] }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('在途时两个动作都禁用', () => {
    render(<IntakeRestartDialog
      t={t}
      artifacts={{ projectRegistered: true, rules: 0, tasks: 0, drafting: 0, proposals: 0 }}
      busy
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />)

    const confirm = screen.getByRole('button', { name: zh['shell.restarting'] }) as HTMLButtonElement
    const cancel = screen.getByRole('button', { name: zh['shell.cancel'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(cancel.disabled).toBe(true)
  })
})
