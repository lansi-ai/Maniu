// @vitest-environment jsdom
/** T-242 浮卡：标题/岗位子标题/来源标注、步骤与状态色、最小化与展开、自愿跳转、堆叠与关闭。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationCards, type OperationCardView } from '../src/shell/operation-cards.tsx'
import { translate, type Translate } from '../src/locale.ts'

const t: Translate = (key, params) => translate('zh', key, params)

function cardOf(overrides: Partial<OperationCardView> = {}): OperationCardView {
  return {
    key: 'review-REQ-01-1',
    title: '需求评审',
    roleLabel: '项目经理',
    sourceLabel: '内置岗位',
    status: 'running',
    statusText: '评审进行中：REQ-01，完成后自动刷新。',
    steps: [
      { label: '会话已发起', state: 'done' },
      { label: '岗位工作中', state: 'active' },
      { label: '产物落盘', state: 'pending' },
      { label: '完成', state: 'pending' },
    ],
    sessionId: 'session-1',
    minimized: false,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
let onToggleMinimize: (key: string) => void
let onOpenSession: (sessionId: string) => void
let onClose: (key: string) => void

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onToggleMinimize = vi.fn()
  onOpenSession = vi.fn()
  onClose = vi.fn()
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

function render(cards: readonly OperationCardView[]): void {
  act(() => {
    root.render(
      <OperationCards cards={cards} onToggleMinimize={onToggleMinimize} onOpenSession={onOpenSession} onClose={onClose} t={t} />,
    )
  })
}

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

function press(testId: string): void {
  const node = element(testId)
  if (node === null) throw new Error(`missing ${testId}`)
  act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('操作进度浮卡', () => {
  it('没有操作时不渲染浮层', () => {
    render([])
    expect(element('operation-cards')).toBeNull()
  })

  it('进行中卡去掉标题下岗位副标题，改为横向进度条首节点展示岗位并保留状态色指示', () => {
    render([cardOf()])
    const card = element('requirement-op-running')
    expect(card?.className).toContain('op-running')
    expect(card?.querySelector('h3')?.textContent).toBe('需求评审')
    expect(card?.querySelector('.op-sub')).toBeNull()
    expect(element('op-step-role')?.textContent).toBe('项目经理')
    expect(element('op-step-role')?.getAttribute('title')).toBe('项目经理 · 内置岗位')
    expect(card?.querySelectorAll('.op-step-done')).toHaveLength(1)
    expect(card?.querySelectorAll('.op-step-active')).toHaveLength(1)
    expect(card?.querySelectorAll('.op-step-pending')).toHaveLength(2)
    expect(card?.querySelector('.op-steps.op-steps-horizontal')?.getAttribute('title')).toContain('评审进行中')
  })

  it('进行中卡只能最小化与查看对话，不能关闭', () => {
    render([cardOf()])
    expect(element('op-minimize')).not.toBeNull()
    expect(element('op-view-session')).not.toBeNull()
    expect(element('op-close')).toBeNull()
    press('op-view-session')
    expect(onOpenSession).toHaveBeenCalledWith('session-1')
    press('op-minimize')
    expect(onToggleMinimize).toHaveBeenCalledWith('review-REQ-01-1')
  })

  it('完成卡状态色指示、四步全完成、可关闭', () => {
    render([cardOf({
      status: 'done',
      statusText: '评审完成：REQ-01 的最新报告已在详情中展示。',
      steps: [
        { label: '会话已发起', state: 'done' },
        { label: '岗位工作中', state: 'done' },
        { label: '产物落盘', state: 'done' },
        { label: '完成', state: 'done' },
      ],
    })])
    const card = element('requirement-op-success')
    expect(card?.className).toContain('op-done')
    expect(card?.querySelectorAll('.op-step-done')).toHaveLength(4)
    press('op-close')
    expect(onClose).toHaveBeenCalledWith('review-REQ-01-1')
  })

  it('失败卡警示色指示，保留打开会话与手动刷新入口', () => {
    render([cardOf({
      status: 'failed',
      statusText: '等待超时：REQ-01 的操作仍未见结果，可打开会话查看进度或手动刷新。',
      steps: [
        { label: '会话已发起', state: 'done' },
        { label: '岗位工作中', state: 'failed' },
        { label: '产物落盘', state: 'pending' },
        { label: '完成', state: 'pending' },
      ],
    })])
    const card = element('requirement-op-timeout')
    expect(card?.className).toContain('op-failed')
    expect(card?.textContent).toContain('等待超时')
    expect(card?.querySelectorAll('.op-step-failed')).toHaveLength(1)
    press('requirement-op-timeout-session')
    expect(onOpenSession).toHaveBeenCalledWith('session-1')
    press('requirement-op-timeout-reload')
    expect(onClose).toHaveBeenCalledWith('review-REQ-01-1')
  })

  it('最小化态只留标题与状态色胶囊，点击展开', () => {
    render([cardOf({ minimized: true })])
    const capsule = element('op-capsule')
    expect(capsule?.className).toContain('op-running')
    expect(capsule?.textContent).toBe('需求评审')
    expect(element('requirement-op-running')).toBeNull()
    press('op-capsule')
    expect(onToggleMinimize).toHaveBeenCalledWith('review-REQ-01-1')
  })

  it('多操作堆叠，各卡独立回调', () => {
    render([cardOf(), cardOf({ key: 'intake-2', title: '需求调研', status: 'done', sessionId: 'session-2' })])
    expect(container.querySelectorAll('.op-card')).toHaveLength(2)
    const sessions = [...container.querySelectorAll('[data-testid="op-view-session"]')]
    expect(sessions).toHaveLength(2)
    const second = sessions[1]
    if (second === undefined) throw new Error('missing second card session button')
    act(() => { second.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onOpenSession).toHaveBeenCalledWith('session-2')
  })

  it('无会话号时不画查看对话入口', () => {
    render([cardOf({ sessionId: null })])
    expect(element('op-view-session')).toBeNull()
  })

  it('人工衔接卡给下一岗位按钮，点击回调带卡键；无下一岗时不画', () => {
    const onNextRole = vi.fn()
    act(() => {
      root.render(
        <OperationCards
          cards={[cardOf({ nextRoleLabel: '评审', statusText: '「项目经理」已完成，点「下一岗位」发起「评审」。' })]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          onNextRole={onNextRole}
          t={t}
        />,
      )
    })
    const button = element('op-next-role')
    expect(button?.textContent).toBe('下一岗位')
    press('op-next-role')
    expect(onNextRole).toHaveBeenCalledWith('review-REQ-01-1')

    render([cardOf()])
    expect(element('op-next-role')).toBeNull()
  })

  it('等待确认卡给确认需求按钮与查看概要入口，状态色沿用进行中', () => {
    const onConfirmIntake = vi.fn()
    act(() => {
      root.render(
        <OperationCards
          cards={[cardOf({ awaitingConfirm: true, statusText: '概要已出，等待你确认；点「确认需求」后才会落盘。' })]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          onConfirmIntake={onConfirmIntake}
          t={t}
        />,
      )
    })
    const card = element('requirement-op-running')
    expect(card?.className).toContain('op-running')
    expect(card?.textContent).toContain('等待你确认')
    expect(element('op-confirm-intake')?.textContent).toBe('确认需求')
    expect(element('op-view-session')?.textContent).toBe('查看概要')
    press('op-confirm-intake')
    expect(onConfirmIntake).toHaveBeenCalledWith('review-REQ-01-1')
    press('op-view-session')
    expect(onOpenSession).toHaveBeenCalledWith('session-1')
  })

  it('未提供确认回调时不画确认按钮；非等待确认卡把查看对话放到右上角图标按钮', () => {
    render([cardOf({ awaitingConfirm: true })])
    expect(element('op-confirm-intake')).toBeNull()
    expect(element('op-view-session')?.textContent).toBe('查看概要')

    render([cardOf()])
    expect(element('op-confirm-intake')).toBeNull()
    expect(container.querySelector('.op-actions')).toBeNull()
    const headView = container.querySelector('.op-head-actions [data-testid="op-view-session"]')
    expect(headView).not.toBeNull()
    expect(headView?.getAttribute('aria-label')).toBe('查看对话')
  })

  it('提供就地概要回调时，「查看概要」走回调而非跳转对话', () => {
    const onViewSummary = vi.fn()
    act(() => {
      root.render(
        <OperationCards
          cards={[cardOf({ awaitingConfirm: true })]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          onConfirmIntake={vi.fn()}
          onViewSummary={onViewSummary}
          t={t}
        />,
      )
    })
    expect(element('op-view-session')?.textContent).toBe('查看概要')
    press('op-view-session')
    expect(onViewSummary).toHaveBeenCalledWith('review-REQ-01-1')
    expect(onOpenSession).not.toHaveBeenCalled()
  })
})

describe('提案等待对比浮卡', () => {
  it('等待态画「去对比」按钮，点击带提案编号回调；查看对话仍自愿', () => {
    const onCompare = vi.fn((_proposalId: string) => {})
    act(() => {
      root.render(
        <OperationCards
          cards={[cardOf({ statusText: '提案待你对比确认', compareProposalId: 'P-01' })]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          onCompare={onCompare}
          t={t}
        />,
      )
    })
    expect(element('requirement-op-running')?.textContent).toContain('提案待你对比确认')
    expect(element('op-go-compare')?.textContent).toBe('去对比')
    press('op-go-compare')
    expect(onCompare).toHaveBeenCalledWith('P-01')
    expect(element('op-view-session')?.getAttribute('aria-label')).toBe('查看对话')
    press('op-view-session')
    expect(onOpenSession).toHaveBeenCalledWith('session-1')
  })

  it('没有提案或没有回调时不画去对比按钮', () => {
    render([cardOf()])
    expect(element('op-go-compare')).toBeNull()
    act(() => {
      root.render(
        <OperationCards
          cards={[cardOf({ compareProposalId: 'P-01' })]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          t={t}
        />,
      )
    })
    expect(element('op-go-compare')).toBeNull()
  })
})

describe('任务卡内的待回答入口', () => {
  it('有待回答题目时高亮一项并画回答按钮，回调带 pendingKey', () => {
    const onAnswerRequest = vi.fn()
    act(() => {
      root.render(
        <OperationCards
          cards={[cardOf({ pendingCount: 2, pendingKey: 'session-1' })]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          onAnswerRequest={onAnswerRequest}
          t={t}
        />,
      )
    })
    expect(element('op-pending-count')?.textContent).toBe('待你回答 2 题')
    expect(element('op-pending-count')?.className).toContain('op-step-answer')
    expect(element('op-answer-pending')?.textContent).toBe('回答')
    press('op-answer-pending')
    expect(onAnswerRequest).toHaveBeenCalledWith('session-1')
  })

  it('没有待回答题目或没有回调时不画回答入口', () => {
    const onAnswerRequest = vi.fn()
    act(() => {
      root.render(
        <OperationCards
          cards={[cardOf({ pendingCount: 0, pendingKey: 'session-1' })]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          onAnswerRequest={onAnswerRequest}
          t={t}
        />,
      )
    })
    expect(element('op-pending-count')).toBeNull()
    expect(element('op-answer-pending')).toBeNull()
    act(() => {
      root.render(
        <OperationCards
          cards={[cardOf({ pendingCount: 1, pendingKey: 'session-1' })]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          t={t}
        />,
      )
    })
    expect(element('op-pending-count')?.textContent).toBe('待你回答 1 题')
    expect(element('op-answer-pending')).toBeNull()
  })

  it('多任务并行时回答按钮各带各的会话标识', () => {
    const onAnswerRequest = vi.fn()
    act(() => {
      root.render(
        <OperationCards
          cards={[
            cardOf({ pendingCount: 1, pendingKey: 'session-1' }),
            cardOf({ key: 'intake-2', pendingCount: 3, pendingKey: 'session-2' }),
          ]}
          onToggleMinimize={onToggleMinimize}
          onOpenSession={onOpenSession}
          onClose={onClose}
          onAnswerRequest={onAnswerRequest}
          t={t}
        />,
      )
    })
    const buttons = [...container.querySelectorAll('[data-testid="op-answer-pending"]')]
    expect(buttons).toHaveLength(2)
    act(() => { (buttons[1] as HTMLElement).click() })
    expect(onAnswerRequest).toHaveBeenCalledWith('session-2')
  })
})

describe('浮卡实时工作过程面板', () => {
  it('进行中卡展示实时阶段、工具写入大小与最新输出片段', () => {
    render([cardOf({
      liveFeed: {
        phase: 'tool-streaming',
        step: 2,
        toolName: 'prototype_draft',
        toolChars: 2048,
        snippet: '正在生成多页 SPA 原型，包含概览、报销列表与新建弹窗。',
        lastToolNote: '已读取 REQ-01.md',
        lastActivityAt: 1000,
      },
    })])
    expect(element('op-live-panel')).not.toBeNull()
    expect(element('op-live-phase')?.textContent).toContain('第 2 步')
    expect(element('op-live-phase')?.textContent).toContain('prototype_draft')
    expect(element('op-live-phase')?.textContent).toContain('2.0 KB')
    expect(element('op-live-output')?.textContent).toContain('多页 SPA 原型')
    expect(element('op-live-tool-note')?.textContent).toContain('REQ-01.md')
  })

  it('完成卡不显示实时面板；失败卡保留最后输出以便排查', () => {
    render([cardOf({
      status: 'done',
      liveFeed: {
        phase: 'idle',
        step: 2,
        snippet: '已完成。',
        lastActivityAt: 1000,
      },
    })])
    expect(element('op-live-panel')).toBeNull()

    render([cardOf({
      status: 'failed',
      statusText: '输出超限',
      liveFeed: {
        phase: 'idle',
        step: 6,
        snippet: '正在写入最终原型内容…',
        lastActivityAt: 1000,
        turnEnd: { kind: 'max-tokens' },
      },
    })])
    expect(element('op-live-panel')).not.toBeNull()
    expect(element('op-live-output')?.textContent).toContain('正在写入最终原型内容')
  })

  it('实时面板支持折叠思考过程与 Markdown 渲染正文', () => {
    render([cardOf({
      liveFeed: {
        phase: 'streaming',
        step: 3,
        reasoning: '先梳理模块依赖，再输出最终说明。',
        snippet: '**已完成** `REQ-01` 评审',
        lastActivityAt: 1000,
      },
    })])
    const thinking = element('op-live-thinking') as HTMLDetailsElement | null
    expect(thinking).not.toBeNull()
    expect(thinking?.open).toBe(false)
    expect(thinking?.querySelector('summary')?.textContent).toBe(t('chat.processThought'))
    expect(thinking?.querySelector('.op-live-thinking-body')?.textContent).toContain('先梳理模块依赖')

    const output = element('op-live-output')
    expect(output?.className).toContain('markdown-body')
    expect(output?.querySelector('strong')?.textContent).toBe('已完成')
    expect(output?.querySelector('code')?.textContent).toBe('REQ-01')

    expect(container.querySelector('.op-steps.op-steps-horizontal')).not.toBeNull()
    expect(container.querySelector('.op-steps-popover')).toBeNull()
  })

  it('拖拽标题栏可移动浮卡并限制在视口内，点击右上角按钮不触发拖拽', () => {
    render([cardOf()])
    const card = element('requirement-op-running') as HTMLElement | null
    const head = card?.querySelector('.op-head') as HTMLElement | null
    const minBtn = element('op-minimize') as HTMLElement | null
    if (card === null || head === null || minBtn === null) throw new Error('missing card elements')

    expect(card.dataset.dragging).toBe('false')
    act(() => {
      minBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
    })
    expect(card.dataset.dragging).toBe('false')

    act(() => {
      head.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 300 }))
    })
    expect(card.dataset.dragging).toBe('true')

    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 250, clientY: 260 }))
    })
    expect(card.style.transform).toBe('translate(-50px, -40px)')

    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 250, clientY: 260 }))
    })
    expect(card.dataset.dragging).toBe('false')
  })
})
