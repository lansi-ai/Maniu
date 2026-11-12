// @vitest-environment jsdom
/**
 * 需求卡片：标题格式、创建人与创建时间、内容默认折叠，以及拆分动作的渲染事实。
 * 纯判定（是否需求卡、时间格式化、拆分指令）同文件覆盖。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import type { ShellTask } from '../src/client/shell/shell-data.ts'
import { buildRequirementSplitPrompt, formatOpenedAt, isRequirementTask } from '../src/client/shell/requirement.ts'
import { RequirementCard } from '../src/client/shell/RequirementCard.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

/** 一条需求任务；可覆盖状态与回指。 */
function taskOf(overrides: Partial<ShellTask> = {}): ShellTask {
  return {
    id: 'T-01',
    title: '随手记账',
    description: '第一行需求内容\n\n第二段',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: ['R-01'],
    evidence: [],
    surface: '读 / 契约',
    paths: [],
    irreversible: [],
    proposal: 'P-01',
    openedAt: '2026-11-12T09:00:02.084Z',
    ...overrides,
  }
}

describe('需求卡片判定', () => {
  it('只有 drafting 且带方案回指的任务才是需求卡', () => {
    expect(isRequirementTask(taskOf())).toBe(true)
    expect(isRequirementTask(taskOf({ state: 'contracted' }))).toBe(false)
    const { proposal: withoutProposal, ...rest } = taskOf()
    void withoutProposal
    expect(isRequirementTask(rest)).toBe(false)
  })

  it('创建时间只读 opened_at；缺失或非法给空串', () => {
    expect(formatOpenedAt('2026-11-12T09:00:02.084Z')).not.toBe('')
    expect(formatOpenedAt(undefined)).toBe('')
    expect(formatOpenedAt('not-a-date')).toBe('')
  })

  it('拆分指令包含编号、标题与关键约束', () => {
    const prompt = buildRequirementSplitPrompt(taskOf())
    expect(prompt).toContain('T-01')
    expect(prompt).toContain('随手记账')
    expect(prompt).toContain('drafting')
    expect(prompt).toContain('不要修改需求本身')
  })
})

describe('需求卡片渲染', () => {
  it('标题显示需求编号与标题，创建人与创建时间都在', () => {
    const { container } = render(
      <RequirementCard t={t} task={taskOf()} splitting={false} error={null} onClose={vi.fn()} onSplit={vi.fn()} />,
    )
    expect(container.querySelector('[data-requirement-title]')?.textContent).toBe('需求编号（T-01）：随手记账')
    expect(screen.getByText(zh['shell.requirementCreator'])).toBeTruthy()
    expect(screen.getByText(formatOpenedAt('2026-11-12T09:00:02.084Z'))).toBeTruthy()
  })

  it('内容默认折叠，只露一行摘要；点查看更多展开，再点收起', () => {
    const { container } = render(
      <RequirementCard t={t} task={taskOf()} splitting={false} error={null} onClose={vi.fn()} onSplit={vi.fn()} />,
    )
    expect(container.querySelector('[data-requirement-preview]')?.textContent).toBe('第一行需求内容')
    expect(container.querySelector('[data-requirement-body]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.requirementShowMore'] }))
    expect(container.querySelector('[data-requirement-body]')).not.toBeNull()
    expect(screen.getByText('第二段')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.requirementShowLess'] }))
    expect(container.querySelector('[data-requirement-body]')).toBeNull()
  })

  it('拆分任务走回调；在途时按钮禁用并显示正在拆分', () => {
    const onSplit = vi.fn()
    const { container, rerender } = render(
      <RequirementCard t={t} task={taskOf()} splitting={false} error={null} onClose={vi.fn()} onSplit={onSplit} />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['shell.splitTasks'] }))
    expect(onSplit).toHaveBeenCalledTimes(1)

    rerender(
      <RequirementCard t={t} task={taskOf()} splitting error={null} onClose={vi.fn()} onSplit={onSplit} />,
    )
    const button = container.querySelector<HTMLButtonElement>('[data-requirement-split]')
    expect(button?.disabled).toBe(true)
    expect(button?.textContent).toBe(zh['shell.splittingTasks'])
  })

  it('拆分失败原文就地显示，卡片不关', () => {
    render(
      <RequirementCard t={t} task={taskOf()} splitting={false} error="session not found" onClose={vi.fn()} onSplit={vi.fn()} />,
    )
    expect(screen.getByText('session not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['shell.splitTasks'] })).toBeTruthy()
  })
})
