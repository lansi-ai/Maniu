// @vitest-environment jsdom
/**
 * 需求卡片：标题格式、创建人与创建时间、需求文档与立项问答两个折叠区、拆分动作的渲染事实。
 * 纯判定（是否需求卡、时间格式化、拆分指令、立项问答解析）同文件覆盖。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import type { ProposalRow } from '../src/client/projection.ts'
import type { ShellMessage, ShellTask } from '../src/client/shell/shell-data.ts'
import { buildRequirementSplitPrompt, formatOpenedAt, intakeAnswersOf, intakeSummaryOf, isRequirementTask } from '../src/client/shell/requirement.ts'
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

/** 一份任务回指的需求方案。 */
const PROPOSAL: ProposalRow = {
  id: 'P-01',
  title: '个人本地记账小工具 · 需求基线',
  problem: '现状：仓库为空目录，项目尚未立项。\n\n要办成的事：记得进、算得对、不丢数据。',
  options: [
    { name: 'A. 只做三件事', summary: '记一笔、翻记录、看当月合计。', cost: '范围最小、最快能上手。' },
    { name: 'B. 三件事 + 分类统计', summary: '增加类别字典与按类别汇总。', cost: '工期长一档。' },
  ],
  recommendation: '推荐 A，与已确认的范围一致。',
  decision: 'draft',
  decidedAt: null,
}

/** 一条 ask_user_question 过程项；`result` 缺省表示结果还没出现在窗口里。 */
function askItem(args: string, result?: string): ShellMessage {
  return {
    role: 'process',
    items: [{ kind: 'tool', callId: 'call-1', name: 'ask_user_question', args, ok: true, ...(result === undefined ? {} : { result }) }],
  }
}

/** 题目参数 JSON。 */
function questionsJson(questions: readonly { id: string; header?: string; question: string }[]): string {
  return JSON.stringify({ questions })
}

/** 回答结果 JSON。 */
function answersJson(answers: readonly { id: string; selected?: readonly string[]; custom?: string }[]): string {
  return JSON.stringify({ answers })
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
    expect(prompt).toContain('每条任务对应一个可独立验收的业务结果')
  })

  it('带需求文档时以它为唯一依据，只拆第一版功能清单与验收标准', () => {
    const document = '# 项目需求概要\n\n## 第一版功能清单\n- 记一笔\n- 翻记录\n\n## 暂不开发\n- 云同步\n- 多人共享'
    const prompt = buildRequirementSplitPrompt(taskOf(), { document })
    expect(prompt).toContain('《项目需求概要》')
    expect(prompt).toContain('.spec/requirements/P-01.md')
    expect(prompt).toContain('只覆盖文档里的第一版功能清单与验收标准')
    expect(prompt).toContain('暂不开发的范围不要拆成任务')
    expect(prompt).toContain('- 记一笔\n- 翻记录')
    expect(prompt).toContain('drafting')
    expect(prompt).toContain('只引用需求里已确认的规则编号')
    expect(prompt).toContain('对应的需求条目与依赖关系')
    expect(prompt).not.toContain('没有读到这条需求对应的需求文档')
  })

  it('缺需求文档时退回任务描述与方案正文，并说明读不到文档', () => {
    const prompt = buildRequirementSplitPrompt(taskOf(), { proposal: '现状：仓库为空目录，项目尚未立项。' })
    expect(prompt).toContain('没有读到这条需求对应的需求文档')
    expect(prompt).toContain('.spec/requirements/P-01.md')
    expect(prompt).toContain('第一行需求内容')
    expect(prompt).toContain('现状：仓库为空目录，项目尚未立项。')
    expect(prompt).not.toContain('《项目需求概要》正文')
    expect(prompt).toContain('drafting')
  })

  it('方案正文也读不到时不编造，如实标出缺口', () => {
    const prompt = buildRequirementSplitPrompt(taskOf())
    expect(prompt).toContain('没有读到这条需求对应的需求文档')
    expect(prompt).toContain('（读不到方案正文）')
  })

  it('需求文档过长时按段落边界截断，不切半句', () => {
    const paragraph = `第一版功能清单第 ${'一'.repeat(40)} 条验收标准。`
    const document = Array.from({ length: 300 }, () => paragraph).join('\n\n')
    const prompt = buildRequirementSplitPrompt(taskOf(), { document })
    const start = prompt.indexOf('"""')
    const body = prompt.slice(start + 3, prompt.lastIndexOf('"""')).trim()
    expect(document.length).toBeGreaterThan(8000)
    expect(body.length).toBeLessThanOrEqual(8000)
    expect(body.endsWith('。')).toBe(true)
    expect(prompt).toContain('按段落截断')
  })
})

describe('立项问答解析', () => {
  it('选择项与自定义回答拼成一句，题头保留', () => {
    const messages = [askItem(
      questionsJson([{ id: 'q1', header: '用途', question: '主要给谁用？' }]),
      answersJson([{ id: 'q1', selected: ['个人记账小工具'], custom: '再加导出' }]),
    )]

    expect(intakeAnswersOf(messages)).toEqual([
      { id: 'q1', header: '用途', question: '主要给谁用？', answer: '个人记账小工具、再加导出' },
    ])
  })

  it('只有自定义回答时也照样输出', () => {
    const messages = [askItem(
      questionsJson([{ id: 'q1', question: '第一版做什么？' }]),
      answersJson([{ id: 'q1', selected: [], custom: '先只做记一笔' }]),
    )]

    expect(intakeAnswersOf(messages)[0]).toEqual({
      id: 'q1', question: '第一版做什么？', answer: '先只做记一笔',
    })
  })

  it('同一题号只留首次出现，顺序按第一次提问', () => {
    const messages = [
      askItem(
        questionsJson([{ id: 'q1', question: '第一问' }, { id: 'q2', question: '第二问' }]),
        answersJson([{ id: 'q1', selected: ['早期回答'] }, { id: 'q2', selected: ['第二答'] }]),
      ),
      askItem(
        questionsJson([{ id: 'q2', question: '第二问（重问）' }, { id: 'q1', question: '第一问（重问）' }]),
        answersJson([{ id: 'q1', selected: ['后来的回答'] }, { id: 'q2', selected: ['后来第二答'] }]),
      ),
    ]

    expect(intakeAnswersOf(messages).map(item => [item.id, item.answer])).toEqual([
      ['q1', '早期回答'],
      ['q2', '第二答'],
    ])
  })

  it('没有结果、结果读不懂或答案为空的那一题跳过，不编造', () => {
    expect(intakeAnswersOf([
      askItem(questionsJson([{ id: 'q1', question: '没有结果的题' }])),
      askItem(questionsJson([{ id: 'q2', question: '坏结果的题' }]), 'not json'),
      askItem(questionsJson([{ id: 'q3', question: '被跳过的题' }]), answersJson([{ id: 'q3', selected: [] }])),
      askItem(questionsJson([{ id: 'q4', question: '正常回答' }]), answersJson([{ id: 'q4', selected: ['答案'] }])),
      askItem('not json', answersJson([{ id: 'q5', selected: ['答'] }])),
    ])).toEqual([{ id: 'q4', question: '正常回答', answer: '答案' }])
  })

  it('参数或结果不成形时跳过：坏条目、待定结果、纯空白自定义回答', () => {
    const messages = [
      askItem(JSON.stringify({ questions: [{ id: 'q1' }, 'bad'] }), answersJson([{ id: 'q1', selected: ['答'] }])),
      askItem(JSON.stringify({ questions: [{ id: 'q2', question: '  ' }] }), answersJson([{ id: 'q2', selected: ['答'] }])),
      askItem(JSON.stringify({ questions: [] }), answersJson([{ id: 'q3', selected: ['答'] }])),
      askItem(JSON.stringify({ questions: [{ id: 'q4', question: '待定' }] }), JSON.stringify({ pending: true, answers: [] })),
      askItem(JSON.stringify({ questions: [{ id: 'q5', question: '坏回答' }] }), JSON.stringify({ answers: [{ id: 'q5', selected: 'not-array' }] })),
      askItem(JSON.stringify({ questions: [{ id: 'q6', question: '数组不是对象' }] }), '[1]'),
      askItem(
        JSON.stringify({ questions: [{ id: 'q7', question: '纯空白自定义' }] }),
        answersJson([{ id: 'q7', selected: ['保留'], custom: '   ' }]),
      ),
    ]

    expect(intakeAnswersOf(messages)).toEqual([{ id: 'q7', question: '纯空白自定义', answer: '保留' }])
  })

  it('别的工具调用不参与立项问答', () => {
    const messages: ShellMessage[] = [{
      role: 'process',
      items: [{ kind: 'tool', callId: 'c1', name: 'file_read', args: questionsJson([{ id: 'q1', question: '文件' }]), ok: true, result: answersJson([{ id: 'q1', selected: ['x'] }]) }],
    }]

    expect(intakeAnswersOf(messages)).toEqual([])
  })
})

describe('需求文档来源', () => {
  it('会话里有多条含「项目需求概要」的答复时取最长的一条，不取回执', () => {
    const document = `七个问题都问完了，下面是《项目需求概要 V0.1》。\n\n# 项目需求概要\n\n${'需求正文。'.repeat(20)}`
    const messages = [
      { role: 'assistant', text: document },
      { role: 'user', text: '确认需求' },
      { role: 'assistant', text: '已按《项目需求概要》落盘完成。' },
    ] as const

    expect(intakeSummaryOf(messages)).toBe(document)
    expect(intakeSummaryOf([{ role: 'user', text: '项目需求概要' }] as const)).toBeNull()
    expect(intakeSummaryOf([{ role: 'assistant', text: '  ' }] as const)).toBeNull()
  })

  it('卡片优先渲染落盘的需求文档，不展示会话旧稿与方案候选', () => {
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        requirementDocument={{ id: 'P-01', text: '项目需求概要 V1\n\n来自 .spec/requirements/P-01.md' }}
        document="会话里的旧草案"
        proposal={PROPOSAL}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-requirement-preview]')?.textContent).toBe('项目需求概要 V1')
    fireEvent.click(container.querySelector('[data-section-toggle="content"]') as HTMLElement)
    expect(screen.getByText('来自 .spec/requirements/P-01.md')).toBeTruthy()
    expect(screen.queryByText('会话里的旧草案')).toBeNull()
    expect(container.querySelector('[data-requirement-options]')).toBeNull()
    expect(container.querySelector('[data-requirement-recommendation]')).toBeNull()
  })

  it('没有落盘文件时退回会话概要，方案候选仍不展示', () => {
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        document="《项目需求概要 V0.1》正文"
        proposal={PROPOSAL}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    const toggle = container.querySelector<HTMLButtonElement>('[data-section-toggle="content"]')
    if (toggle !== null) fireEvent.click(toggle)
    expect(screen.getByText(/项目需求概要 V0.1/)).toBeTruthy()
    expect(container.querySelector('[data-requirement-options]')).toBeNull()
    expect(container.querySelector('[data-requirement-recommendation]')).toBeNull()
  })
})

describe('需求卡片渲染', () => {
  it('标题显示需求编号与标题，创建人与创建时间都在', () => {
    const { container } = render(
      <RequirementCard t={t} task={taskOf()} answers={[]} splitting={false} error={null} onClose={vi.fn()} onSplit={vi.fn()} />,
    )
    expect(container.querySelector('[data-requirement-title]')?.textContent).toBe('需求编号（T-01）：随手记账')
    expect(screen.getByText(zh['shell.requirementCreator'])).toBeTruthy()
    expect(screen.getByText(formatOpenedAt('2026-11-12T09:00:02.084Z'))).toBeTruthy()
  })

  it('内容默认折叠，只露一行摘要；点查看更多展开，再点收起', () => {
    const { container } = render(
      <RequirementCard t={t} task={taskOf()} answers={[]} splitting={false} error={null} onClose={vi.fn()} onSplit={vi.fn()} />,
    )
    expect(container.querySelector('[data-requirement-preview]')?.textContent).toBe('第一行需求内容')
    expect(container.querySelector('[data-requirement-body]')).toBeNull()
    fireEvent.click(container.querySelector('[data-section-toggle="content"]') as HTMLElement)
    expect(container.querySelector('[data-requirement-body]')).not.toBeNull()
    expect(screen.getByText('第二段')).toBeTruthy()
    fireEvent.click(container.querySelector('[data-section-toggle="content"]') as HTMLElement)
    expect(container.querySelector('[data-requirement-body]')).toBeNull()
  })

  it('有方案时正文取方案 problem、选项与推荐，展开后都看得到', () => {
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        proposal={PROPOSAL}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-requirement-preview]')?.textContent)
      .toBe('现状：仓库为空目录，项目尚未立项。')
    fireEvent.click(container.querySelector('[data-section-toggle="content"]') as HTMLElement)
    expect(screen.getByText('要办成的事：记得进、算得对、不丢数据。')).toBeTruthy()
    expect(screen.getByText('A. 只做三件事')).toBeTruthy()
    expect(screen.getByText('记一笔、翻记录、看当月合计。')).toBeTruthy()
    expect(screen.getByText(`${zh['shell.requirementOptionCost']}范围最小、最快能上手。`)).toBeTruthy()
    expect(screen.getByText('推荐 A，与已确认的范围一致。')).toBeTruthy()
  })

  it('方案缺选项、缺推荐或选项字段为空时不画空块', () => {
    const bare: ProposalRow = {
      ...PROPOSAL,
      options: [{ name: 'C. 只删减', summary: '', cost: '' }],
      recommendation: '',
    }
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        proposal={bare}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    fireEvent.click(container.querySelector('[data-section-toggle="content"]') as HTMLElement)
    expect(screen.getByText('C. 只删减')).toBeTruthy()
    expect(container.querySelector('[data-requirement-option] p')).toBeNull()
    expect(container.querySelector('[data-requirement-recommendation]')).toBeNull()

    cleanup()
    const noOptions = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        proposal={{ ...PROPOSAL, options: [], recommendation: '' }}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    fireEvent.click(noOptions.container.querySelector('[data-section-toggle="content"]') as HTMLElement)
    expect(noOptions.container.querySelector('[data-requirement-options]')).toBeNull()
  })

  it('摘要过长截断，空正文给占位', () => {
    const long = '一'.repeat(120)
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf({ description: long })}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-requirement-preview]')?.textContent).toBe(`${'一'.repeat(90)}…`)

    cleanup()
    const blank = render(
      <RequirementCard
        t={t}
        task={taskOf({ description: '  ' })}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(blank.container.querySelector('[data-requirement-preview]')?.textContent).toBe(zh['shell.noDescription'])
  })

  it('没有方案文件时正文退回任务 description', () => {
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    fireEvent.click(container.querySelector('[data-section-toggle="content"]') as HTMLElement)
    expect(screen.getByText('第二段')).toBeTruthy()
    expect(container.querySelector('[data-requirement-options]')).toBeNull()
    expect(container.querySelector('[data-requirement-recommendation]')).toBeNull()
  })

  it('立项问答独立默认折叠：收起给问数，展开逐题显示问题与回答', () => {
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        proposal={PROPOSAL}
        answers={[
          { id: 'q1', header: '用途', question: '主要给谁用？', answer: '个人记账小工具' },
          { id: 'q2', question: '第一版做什么？', answer: '记一笔、翻记录、看合计' },
        ]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-requirement-answer]')).toBeNull()
    expect(container.querySelector('[data-requirement-answers-preview]')?.textContent).toBe('共 2 问')
    fireEvent.click(container.querySelector('[data-section-toggle="answers"]') as HTMLElement)
    expect(screen.getByText('用途')).toBeTruthy()
    expect(screen.getByText('主要给谁用？')).toBeTruthy()
    expect(screen.getByText('个人记账小工具')).toBeTruthy()
    expect(screen.getByText('第一版做什么？')).toBeTruthy()
    expect(screen.getByText('记一笔、翻记录、看合计')).toBeTruthy()
  })

  it('没有问答记录时如实说没读到', () => {
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        proposal={PROPOSAL}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-requirement-answers-preview]')?.textContent)
      .toBe(zh['shell.requirementAnswersEmpty'])
    fireEvent.click(container.querySelector('[data-section-toggle="answers"]') as HTMLElement)
    expect(container.querySelector('[data-requirement-answers-empty]')?.textContent)
      .toBe(zh['shell.requirementAnswersEmpty'])
  })

  it('拆分任务走回调；在途时按钮禁用并显示正在拆分', () => {
    const onSplit = vi.fn()
    const { container, rerender } = render(
      <RequirementCard t={t} task={taskOf()} answers={[]} splitting={false} error={null} onClose={vi.fn()} onSplit={onSplit} />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['shell.splitTasks'] }))
    expect(onSplit).toHaveBeenCalledTimes(1)

    rerender(
      <RequirementCard t={t} task={taskOf()} answers={[]} splitting error={null} onClose={vi.fn()} onSplit={onSplit} />,
    )
    const button = container.querySelector<HTMLButtonElement>('[data-requirement-split]')
    expect(button?.disabled).toBe(true)
    expect(button?.textContent).toBe(zh['shell.splittingTasks'])
  })

  it('拆分动作收到卡片读到的完整需求文档；没有文档时收到 undefined', () => {
    const onSplit = vi.fn()
    const requirementDocument = { id: 'P-01', text: '项目需求概要 V1\n\n第一版功能清单' }
    render(
      <RequirementCard
        t={t}
        task={taskOf()}
        requirementDocument={requirementDocument}
        answers={[]}
        splitting={false}
        error={null}
        onClose={vi.fn()}
        onSplit={onSplit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['shell.splitTasks'] }))
    expect(onSplit).toHaveBeenLastCalledWith(requirementDocument)

    cleanup()
    const withoutDoc = render(
      <RequirementCard t={t} task={taskOf()} answers={[]} splitting={false} error={null} onClose={vi.fn()} onSplit={onSplit} />,
    )
    fireEvent.click(within(withoutDoc.container).getByRole('button', { name: zh['shell.splitTasks'] }))
    expect(onSplit).toHaveBeenLastCalledWith(undefined)
  })

  it('拆分失败原文就地显示，卡片不关', () => {
    render(
      <RequirementCard t={t} task={taskOf()} answers={[]} splitting={false} error="session not found" onClose={vi.fn()} onSplit={vi.fn()} />,
    )
    expect(screen.getByText('session not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['shell.splitTasks'] })).toBeTruthy()
  })

  it('拆分流程运行中显示阶段，按钮保持禁用', () => {
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        answers={[]}
        splitting
        error={null}
        flow={{ status: 'running', stage: 'pm', newTasks: [] }}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-requirement-split-phase]')?.textContent).toBe(zh['shell.splitPmRunning'])
    expect(container.querySelector<HTMLButtonElement>('[data-requirement-split]')?.disabled).toBe(true)
    cleanup()

    const manager = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        answers={[]}
        splitting
        error={null}
        flow={{ status: 'running', stage: 'manager', newTasks: [{ id: 'T-02', title: '记一笔' }] }}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(manager.container.querySelector('[data-requirement-split-phase]')?.textContent)
      .toBe(zh['shell.splitManagerRunning'])
    expect(manager.container.querySelector('[data-requirement-split-tasks]')?.textContent)
      .toBe(t('shell.splitNewTasks', { count: '1', tasks: 'T-02' }))
  })

  it('完成后显示拆分、分配与进入待开发的计数、失败明细，并给去看板', () => {
    const onViewBoard = vi.fn()
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        answers={[]}
        splitting={false}
        error={null}
        flow={{
          status: 'done',
          newTasks: [{ id: 'T-02', title: '记一笔' }, { id: 'T-03', title: '翻记录' }],
          summary: {
            taskCount: 2, assignedCount: 2, readyCount: 1,
            lines: ['T-03 没有进入待开发：还没分配岗位'],
          },
        }}
        onClose={vi.fn()}
        onSplit={vi.fn()}
        onViewBoard={onViewBoard}
      />,
    )
    expect(container.querySelector('[data-requirement-split-summary]')?.textContent)
      .toBe(t('shell.splitResult', { tasks: '2', assigned: '2', ready: '1' }))
    expect(screen.getByText('T-03 没有进入待开发：还没分配岗位')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.splitViewBoard'] }))
    expect(onViewBoard).toHaveBeenCalledTimes(1)
  })

  it('流程失败时照实显示错误，不画完成计数', () => {
    const { container } = render(
      <RequirementCard
        t={t}
        task={taskOf()}
        answers={[]}
        splitting={false}
        error="项目经理超过三分钟仍未结束"
        flow={{ status: 'failed', newTasks: [], errorText: '项目经理超过三分钟仍未结束' }}
        onClose={vi.fn()}
        onSplit={vi.fn()}
      />,
    )
    expect(screen.getByText('项目经理超过三分钟仍未结束')).toBeTruthy()
    expect(container.querySelector('[data-requirement-split-summary]')).toBeNull()
    expect(container.querySelector('[data-requirement-split]')).toBeTruthy()
  })
})
