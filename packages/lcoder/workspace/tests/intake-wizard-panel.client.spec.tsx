// @vitest-environment jsdom
/**
 * 需求分析师向导的渲染：首页三节默认折叠、模型空态与选择、提问层复用提问卡、
 * 思考中可展开过程、结果卡的两个动作与就地错误。阶段本身由纯模块算，这里只钉渲染事实。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh } from '../src/client/locales.ts'
import type { ProposalRow } from '../src/client/projection.ts'
import type { ShellTask } from '../src/client/shell/shell-data.ts'
import type { ShellQuestionPending } from '../src/client/shell/pending.ts'
import { IntakeWizard } from '../src/client/shell/IntakeWizard.tsx'
import type { IntakeWizardProps } from '../src/client/shell/IntakeWizard.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

const MODEL_A = {
  provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-chat', modelName: 'DeepSeek Chat', isDefault: true,
}
const MODEL_B = {
  provider: 'minimax-cn', providerName: 'MiniMax', model: 'abab', modelName: 'ABAB', isDefault: false,
}

/** 一份结果卡用的方案。 */
function proposalOf(): ProposalRow {
  return {
    id: 'P-01',
    title: '图书借阅系统 V0.1',
    problem: '借还书靠手工登记',
    options: [
      { name: '复用现成后台', summary: '一周能上线', cost: '零成本' },
      { name: '从零开发', summary: '更贴业务', cost: '三周' },
    ],
    recommendation: '先做借还书闭环',
    decision: 'draft',
    decidedAt: null,
  }
}

/** 一条草案任务；`proposal` 缺省表示不挂任何方案。 */
function taskOf(id: string, title: string, proposal?: string): ShellTask {
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
    ...(proposal === undefined ? {} : { proposal }),
  }
}

/** 一条待答问题。 */
function questionOf(): ShellQuestionPending {
  return {
    key: 'question:1',
    kind: 'question',
    sessionId: SessionId('s-1'),
    questions: [{
      id: 'q1',
      question: '主要给谁使用？',
      options: [{ label: '学生' }, { label: '管理员' }],
    }],
    answer: vi.fn(async () => {}),
  }
}

/** 向导 props；各用例只覆盖自己关心的字段。 */
function propsOf(overrides: Partial<IntakeWizardProps> = {}): IntakeWizardProps {
  return {
    t,
    phase: 'home',
    error: null,
    question: null,
    processItems: [],
    modelState: 'idle',
    models: [],
    selectedModel: null,
    modelBlocked: false,
    sending: false,
    proposal: null,
    tasks: [],
    running: true,
    approving: false,
    approveResult: null,
    canApprove: true,
    restartBusy: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onSelectModel: vi.fn(),
    onLoadModels: vi.fn(),
    onOpenSettings: vi.fn(),
    onApprove: vi.fn(),
    onRestart: vi.fn(),
    ...overrides,
  }
}

describe('向导首页', () => {
  it('标题里品牌与需求分析师各自一段，其余是正文', () => {
    const { container } = render(<IntakeWizard {...propsOf()} />)

    expect(container.querySelector('[data-wizard-title-brand]')?.textContent).toBe(zh['shell.wizardTitleBrand'])
    expect(container.querySelector('[data-wizard-title-highlight]')?.textContent).toBe(zh['shell.wizardTitleHighlight'])
    const title = container.querySelector('[data-wizard-title]')
    expect(title?.textContent).toBe('现在由LCoder团队需求分析师与您对接需求')
  })

  it('三节默认折叠，只露出标题与一行摘要；底部只有取消与确认', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const { container } = render(<IntakeWizard {...propsOf({ onCancel, onConfirm })} />)

    const sections = [...container.querySelectorAll<HTMLDetailsElement>('details[data-wizard-section]')]
    expect(sections.map(section => section.dataset.wizardSection)).toEqual(['profile', 'flow', 'advanced'])
    expect(sections.every(section => !section.open)).toBe(true)
    for (const key of [
      'shell.wizardProfileTitle', 'shell.wizardProfileSummary',
      'shell.wizardFlowTitle', 'shell.wizardFlowSummary', 'shell.wizardAdvancedTitle',
    ] as const) {
      expect(container.textContent).toContain(zh[key])
    }

    const buttons = [...container.querySelectorAll('button')].map(button => button.textContent)
    expect(buttons).toEqual([zh['shell.cancel'], zh['shell.wizardConfirm']])
    fireEvent.click(screen.getByRole('button', { name: zh['shell.cancel'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.wizardConfirm'] }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('展开高级配置才读模型目录，空态给去设置入口', () => {
    const onLoadModels = vi.fn()
    const onOpenSettings = vi.fn()
    const { container, rerender } = render(<IntakeWizard {...propsOf({ onLoadModels, onOpenSettings })} />)

    const advanced = container.querySelector<HTMLDetailsElement>('details[data-wizard-section="advanced"]')
    expect(advanced).not.toBeNull()
    advanced!.open = true
    fireEvent(advanced!, new Event('toggle'))
    expect(onLoadModels).toHaveBeenCalledTimes(1)

    rerender(<IntakeWizard {...propsOf({ modelState: 'ready', models: [], onLoadModels, onOpenSettings })} />)
    expect(screen.getByText(zh['shell.wizardNoModels'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.wizardGoSettings'] }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('有模型时逐枚列出，选中的一枚标记按下', () => {
    const onSelectModel = vi.fn()
    const { container } = render(<IntakeWizard {...propsOf({
      modelState: 'ready', models: [MODEL_A, MODEL_B], selectedModel: MODEL_A, onSelectModel,
    })} />)

    const active = container.querySelector('[aria-pressed="true"]')
    expect(active?.textContent).toContain('DeepSeek Chat')
    fireEvent.click(screen.getByRole('button', { name: /ABAB/ }))
    expect(onSelectModel).toHaveBeenCalledWith(MODEL_B)
  })

  it('没有可用模型时确认按钮禁用，并在首页直接给去设置入口', () => {
    const onOpenSettings = vi.fn()
    const { container } = render(<IntakeWizard {...propsOf({ modelBlocked: true, onOpenSettings })} />)

    const confirm = container.querySelector<HTMLButtonElement>('[data-wizard-confirm]')
    expect(confirm?.disabled).toBe(true)
    expect(confirm?.title).toBe(zh['shell.noModels'])
    expect(screen.getByText(zh['shell.noModels'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.wizardGoSettings'] }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('就地错误显示在首页按钮上方', () => {
    render(<IntakeWizard {...propsOf({ error: '云端不可用' })} />)
    expect(screen.getByText('云端不可用')).toBeTruthy()
  })
})

describe('提问层', () => {
  it('直接画既有提问卡，提交仍走 pending.answer()', async () => {
    const answer = vi.fn(async () => {})
    const pending = { ...questionOf(), answer }
    render(<IntakeWizard {...propsOf({ phase: 'questions', question: pending, modelState: 'ready' })} />)

    expect(screen.getByText('主要给谁使用？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '管理员' }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.submitAnswer'] }))

    await waitFor(() => {
      expect(answer).toHaveBeenCalledWith({ answers: [{ id: 'q1', selected: ['管理员'] }] })
    })
  })
})

describe('思考中', () => {
  it('只显示一行思考与行内 loading；点击展开思考与工具过程，再点收起', () => {
    const { container } = render(<IntakeWizard {...propsOf({
      phase: 'thinking',
      processItems: [
        { kind: 'reasoning', text: '先确认使用场景' },
        { kind: 'tool', callId: 'c1', name: 'file_read', args: '{}', ok: true },
      ],
    })} />)

    expect(container.querySelector('[data-wizard-spinner]')?.getAttribute('data-spinning')).toBe('true')
    const toggle = screen.getByRole('button', { name: new RegExp(zh['shell.wizardThinking']) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('先确认使用场景')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('先确认使用场景')).toBeTruthy()
    expect(screen.getByText(zh['shell.processToolRead'])).toBeTruthy()

    fireEvent.click(toggle)
    expect(screen.queryByText('先确认使用场景')).toBeNull()
  })

  it('本轮结束但还没读到方案时 loading 停转，改为结束说明并直接给重新开始', () => {
    const onRestart = vi.fn()
    const { container } = render(<IntakeWizard {...propsOf({
      phase: 'thinking',
      running: false,
      onRestart,
    })} />)

    const spinner = container.querySelector('[data-wizard-spinner]')
    expect(spinner?.getAttribute('data-spinning')).toBe('false')
    expect(container.querySelector('[data-wizard-thinking]')?.getAttribute('data-running')).toBe('false')
    expect(screen.getByText(zh['shell.wizardThinkingEnded'])).toBeTruthy()
    expect(screen.queryByText(zh['shell.wizardThinking'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.restartIntake'] }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('思考与结果阶段不再压暗底层，首页与提问层才是模态', () => {
    const { container, rerender } = render(<IntakeWizard {...propsOf()} />)
    expect(container.querySelector('[data-lcoder-intake-wizard]')?.getAttribute('data-quiet')).toBeNull()

    rerender(<IntakeWizard {...propsOf({ phase: 'thinking' })} />)
    expect(container.querySelector('[data-lcoder-intake-wizard]')?.getAttribute('data-quiet')).toBe('true')

    rerender(<IntakeWizard {...propsOf({ phase: 'result', proposal: proposalOf() })} />)
    expect(container.querySelector('[data-lcoder-intake-wizard]')?.getAttribute('data-quiet')).toBe('true')
  })
})

describe('结果卡', () => {
  it('显示方案、问题、候选、推荐、决定态与本轮草案任务', () => {
    const onApprove = vi.fn()
    const { container } = render(<IntakeWizard {...propsOf({
      phase: 'result',
      proposal: proposalOf(),
      tasks: [
        taskOf('T-01', '借书流程', 'P-01'),
        taskOf('T-02', '还书流程', 'P-01'),
        taskOf('T-03', '别的方案的任务', 'P-02'),
        taskOf('T-04', '没有回指的任务'),
      ],
      onApprove,
    })} />)

    expect(screen.getByText(zh['shell.wizardResultTitle'])).toBeTruthy()
    expect(screen.getByText('图书借阅系统 V0.1')).toBeTruthy()
    expect(screen.getByText('借还书靠手工登记')).toBeTruthy()
    expect(screen.getByText('复用现成后台')).toBeTruthy()
    expect(screen.getByText('一周能上线')).toBeTruthy()
    expect(screen.getByText('先做借还书闭环')).toBeTruthy()
    expect(screen.getByText(zh['shell.proposalDraft'])).toBeTruthy()
    expect(screen.getByText(zh['shell.wizardResultTasks'].replace('{count}', '2'))).toBeTruthy()
    expect(container.querySelectorAll('[data-wizard-task]')).toHaveLength(2)
    expect(container.querySelector('[data-wizard-task="T-01"]')).not.toBeNull()
    expect(container.querySelector('[data-wizard-task="T-02"]')).not.toBeNull()
    expect(container.querySelector('[data-wizard-task="T-03"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.confirmRequirement'] }))
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('没有回指本方案的任务时计数写 0，且不画编号列表', () => {
    const { container } = render(<IntakeWizard {...propsOf({
      phase: 'result',
      proposal: proposalOf(),
      tasks: [taskOf('T-04', '没有回指的任务')],
    })} />)

    expect(screen.getByText(zh['shell.wizardResultTasks'].replace('{count}', '0'))).toBeTruthy()
    expect(container.querySelectorAll('[data-wizard-task]')).toHaveLength(0)
  })

  it('候选为空时不画候选小节', () => {
    const proposal = { ...proposalOf(), options: [] }
    render(<IntakeWizard {...propsOf({ phase: 'result', proposal })} />)

    expect(screen.queryByText(zh['shell.proposalOptions'])).toBeNull()
    expect(screen.getByText(zh['shell.proposalProblem'])).toBeTruthy()
  })

  it('更多轮次展开后是重新开始，确认框与重开逻辑仍由外壳负责', () => {
    const onRestart = vi.fn()
    render(<IntakeWizard {...propsOf({ phase: 'result', proposal: proposalOf(), onRestart })} />)

    const more = screen.getByRole('button', { name: zh['shell.wizardMoreRounds'] })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(zh['shell.wizardRestartHint'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.restartIntake'] }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('采纳失败原文就地显示，卡片不关；在途时确认按钮禁用', () => {
    const { rerender } = render(<IntakeWizard {...propsOf({
      phase: 'result', proposal: proposalOf(), approving: true,
    })} />)
    expect(screen.getByRole('button', { name: zh['shell.approving'] }).hasAttribute('disabled')).toBe(true)

    rerender(<IntakeWizard {...propsOf({
      phase: 'result',
      proposal: proposalOf(),
      approveResult: { ok: false, text: 'proposal/not-found: P-01' },
    })} />)
    expect(screen.getByText('proposal/not-found: P-01')).toBeTruthy()
    expect(screen.getByText(zh['shell.wizardResultTitle'])).toBeTruthy()
  })

  it('方案还没读出来时给说明，确认按钮禁用', () => {
    const { container } = render(<IntakeWizard {...propsOf({ phase: 'result' })} />)

    expect(screen.getByText(zh['shell.wizardResultMissing'])).toBeTruthy()
    expect(container.querySelector<HTMLButtonElement>('[data-wizard-approve]')?.disabled).toBe(true)
  })
})

describe('关闭态', () => {
  it('closed 阶段不渲染任何东西', () => {
    const { container } = render(<IntakeWizard {...propsOf({ phase: 'closed' })} />)
    expect(container.firstChild).toBeNull()
  })
})
