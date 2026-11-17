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

  it('进行中卡给标题、岗位子标题、来源标注与蓝色边框', () => {
    render([cardOf()])
    const card = element('requirement-op-running')
    expect(card?.className).toContain('op-running')
    expect(card?.querySelector('h3')?.textContent).toBe('需求评审')
    expect(card?.querySelector('.op-sub')?.textContent).toBe('项目经理 · 内置岗位')
    expect(card?.querySelectorAll('.op-step-done')).toHaveLength(1)
    expect(card?.querySelectorAll('.op-step-active')).toHaveLength(1)
    expect(card?.querySelectorAll('.op-step-pending')).toHaveLength(2)
    expect(card?.textContent).toContain('评审进行中')
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

  it('完成卡绿色边框、四步全完成、可关闭', () => {
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

  it('失败卡警示色边框，保留打开会话与手动刷新入口', () => {
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

  it('等待确认卡给确认需求按钮与查看概要入口，边框沿用进行中蓝', () => {
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

  it('未提供确认回调时不画确认按钮；非等待确认卡沿用查看对话文案', () => {
    render([cardOf({ awaitingConfirm: true })])
    expect(element('op-confirm-intake')).toBeNull()
    expect(element('op-view-session')?.textContent).toBe('查看概要')

    render([cardOf()])
    expect(element('op-confirm-intake')).toBeNull()
    expect(element('op-view-session')?.textContent).toBe('查看对话')
  })
})
