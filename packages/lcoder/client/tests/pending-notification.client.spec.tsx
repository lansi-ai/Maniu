// @vitest-environment jsdom
/** T-298：作答弹窗由任务卡入口受控打开；通知浮层删除，草稿跨重开保留，遮罩/Esc/关闭统一回 App。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, useState } from 'react'
import type { JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventOutcome } from '@maniu/desktop/contract'
import type { AnswerResult } from '../src/shell/pending-cards.tsx'
import { PendingLayer } from '../src/shell/pending-notification.tsx'
import type { PendingInteraction } from '../src/chat/pending.ts'
import { translate, type Translate } from '../src/locale.ts'
import type { SessionSummary } from '../src/store.ts'

const t: Translate = (key, params) => translate('zh', key, params)
const SESSIONS: readonly SessionSummary[] = [
  { sessionId: 's1', updatedAt: 1, running: false, blank: false },
  { sessionId: 's2', updatedAt: 2, running: false, blank: false },
]
const TITLES = { s1: '评审会话', s2: '立项会话' }

const QUESTION: PendingInteraction = {
  id: 'e1',
  kind: 'question',
  clientId: 'c1',
  eventId: 'e1',
  request: { questions: [{ id: 'q1', question: '选一个', options: [{ label: 'A' }, { label: 'B' }] }] },
  sessionId: 's1',
}
const SECOND: PendingInteraction = {
  ...QUESTION,
  id: 'e2',
  eventId: 'e2',
  sessionId: 's2',
  request: { questions: [{ id: 'q2', question: '再选一个', options: [{ label: 'X' }] }] },
}

const RECORDS = [
  { type: 'event', event: { type: 'user/message', data: { content: [{ type: 'text', text: '请评审 REQ-01' }], source: { kind: 'user' } } } },
  { type: 'event', event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已开始评审' }] } } } },
]

let container: HTMLDivElement
let root: Root
let historyResult: unknown
let call: ReturnType<typeof vi.fn>
let updateItems: (items: readonly PendingInteraction[]) => void
let openIds: (ids: readonly string[] | null) => void

function renderLayer(
  items: readonly PendingInteraction[],
  onAnswer: (interaction: PendingInteraction, outcome: EventOutcome) => Promise<AnswerResult> =
    async () => ({ ok: true }),
): void {
  function Harness(): JSX.Element {
    const [current, setCurrent] = useState<readonly PendingInteraction[]>(items)
    const [ids, setIds] = useState<readonly string[] | null>(null)
    updateItems = setCurrent
    openIds = setIds
    const answer = async (interaction: PendingInteraction, outcome: EventOutcome): Promise<AnswerResult> => {
      const result = await onAnswer(interaction, outcome)
      if (result.ok) setCurrent(list => list.filter(item => item.id !== interaction.id))
      return result
    }
    return (
      <PendingLayer
        visible
        t={t}
        items={current}
        answerIds={ids}
        sessions={SESSIONS}
        titles={TITLES}
        onAnswer={answer}
        onClose={() => { setIds(null) }}
      />
    )
  }
  act(() => { root.render(<Harness />) })
}

function query(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}
function element(testId: string): HTMLElement {
  const node = query(testId)
  expect(node).not.toBeNull()
  return node as HTMLElement
}
function all(testId: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)]
}
async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}
async function press(testId: string): Promise<HTMLElement> {
  const node = element(testId)
  await act(async () => {
    node.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await flush()
  return node
}
async function typeInto(node: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function open(ids: readonly string[]): Promise<void> {
  await act(async () => { openIds(ids) })
  await flush()
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  historyResult = { ok: true, value: { records: RECORDS } }
  call = vi.fn(async (namespace: string, method: string) => {
    if (namespace === 'session' && method === 'events') return historyResult
    return { ok: true, value: {} }
  })
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  document.querySelectorAll('.pending-dialog-backdrop').forEach((node) => { node.remove() })
  Reflect.deleteProperty(window, 'lcoder')
})

describe('通知浮层已删除', () => {
  it('未打开时不画弹窗，也不画任何右下通知卡', () => {
    renderLayer([QUESTION])
    expect(query('pending-dialog')).toBeNull()
    expect(query('pending-notifications')).toBeNull()
    expect(query('pending-notice')).toBeNull()
    expect(query('question-card')).toBeNull()
  })

  it('并行两个会话不会各自冒出通知，只有受控打开才出现弹窗', async () => {
    renderLayer([QUESTION, SECOND])
    expect(all('pending-notice')).toHaveLength(0)
    expect(query('pending-dialog')).toBeNull()
    await open(['e1', 'e2'])
    expect(query('pending-dialog')).not.toBeNull()
    expect(all('question-card')).toHaveLength(2)
  })
})

describe('带会话上下文弹窗', () => {
  it('受控打开后读 session/events 并标出用户与助手发言', async () => {
    renderLayer([QUESTION])
    await open(['e1'])
    expect(query('pending-dialog')).not.toBeNull()
    expect(call).toHaveBeenCalledWith('session', 'events', {
      request: { address: { kind: 'session', sessionId: 's1' }, maxMessages: 200 },
    })
    expect(element('pending-dialog-history').textContent).toContain('请评审 REQ-01')
    expect(element('pending-dialog-history').textContent).toContain('已开始评审')
    expect(all('history-row').map(node => node.getAttribute('data-role'))).toEqual(['user', 'assistant'])
    expect(query('question-card')).not.toBeNull()
    expect(element('pending-dialog').getAttribute('aria-label')).toContain('评审会话')
  })

  it('关闭重开保留草稿；关闭、Escape 与遮罩点击都回 App 关闭', async () => {
    renderLayer([QUESTION])
    await open(['e1'])
    expect(document.activeElement).toBe(element('pending-dialog'))
    await typeInto(element('question-custom') as HTMLInputElement, '我的补充')
    await press('pending-dialog-close')
    expect(query('pending-dialog')).toBeNull()
    await open(['e1'])
    expect((element('question-custom') as HTMLInputElement).value).toBe('我的补充')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(query('pending-dialog')).toBeNull()

    await open(['e1'])
    await press('pending-dialog-backdrop')
    expect(query('pending-dialog')).toBeNull()
  })

  it('回答成功后交互被移除，弹窗自动关闭', async () => {
    const onAnswer = vi.fn(async () => ({ ok: true as const }))
    renderLayer([QUESTION], onAnswer)
    await open(['e1'])
    await press('question-option')
    await press('question-submit')
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(query('pending-dialog')).toBeNull()
    expect(query('question-card')).toBeNull()
  })

  it('回答失败保留弹窗、草稿与可读错误，可重试', async () => {
    const onAnswer = vi.fn(async () => ({ ok: false as const, message: '回执失败' }))
    renderLayer([QUESTION], onAnswer)
    await open(['e1'])
    await press('question-option')
    await typeInto(element('question-custom') as HTMLInputElement, '补充内容')
    await press('question-submit')
    expect(element('question-error').textContent).toContain('回执失败')
    expect(query('pending-dialog')).not.toBeNull()
    expect((element('question-custom') as HTMLInputElement).value).toBe('补充内容')
    await press('question-submit')
    expect(onAnswer).toHaveBeenCalledTimes(2)
  })

  it('历史加载失败时保留回答控件', async () => {
    historyResult = { ok: false, error: { code: 'oops', message: 'oops' } }
    renderLayer([QUESTION])
    await open(['e1'])
    expect(element('pending-history-error')).not.toBeNull()
    expect(query('question-card')).not.toBeNull()
  })

  it('交互被取消（撤回）时移除并关闭弹窗', async () => {
    renderLayer([QUESTION])
    await open(['e1'])
    expect(query('pending-dialog')).not.toBeNull()
    act(() => { updateItems([]) })
    await flush()
    expect(query('pending-dialog')).toBeNull()
  })

  it('中性兜底可把没有可归属会话的提问放进来，标题与历史走中性文案', async () => {
    const { sessionId: _sessionId, ...noSource } = QUESTION
    renderLayer([noSource])
    await open(['e1'])
    expect(query('pending-dialog')).not.toBeNull()
    expect(element('pending-dialog').getAttribute('aria-label')).toBe('待处理提问')
    expect(element('pending-dialog-history').textContent).not.toContain('来源会话不可用')
    expect(query('question-card')).not.toBeNull()
    expect(call).not.toHaveBeenCalled()
  })

  it('混着多个会话的中性兜底不读任一会话历史，答题卡仍可用', async () => {
    renderLayer([QUESTION, SECOND])
    await open(['e1', 'e2'])
    expect(element('pending-dialog').getAttribute('aria-label')).toBe('待处理提问')
    expect(all('question-card')).toHaveLength(2)
    expect(call).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('来源会话不可用')
  })

  it('助手消息带 reasoning 时默认折叠渲染 history-thinking', async () => {
    historyResult = {
      ok: true,
      value: {
        records: [
          {
            type: 'event',
            event: {
              type: 'assistant/message',
              data: {
                message: {
                  content: [
                    { type: 'reasoning', text: '先分析需求再作答' },
                    { type: 'text', text: '正式回复内容' },
                  ],
                },
              },
            },
          },
        ],
      },
    }
    renderLayer([QUESTION])
    await open(['e1'])
    const details = element('history-thinking') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe(t('chat.processThought'))
    expect(details.querySelector('.history-thinking-body')?.textContent).toBe('先分析需求再作答')
    expect(element('pending-dialog-history').textContent).toContain('正式回复内容')
  })

  it('超过 260 字符的用户消息默认折叠进 history-prompt-fold', async () => {
    const firstLine = `第一行需求描述：${'甲'.repeat(120)}`
    const longPrompt = `\n\n${firstLine}\n${'乙'.repeat(200)}`
    historyResult = {
      ok: true,
      value: {
        records: [
          {
            type: 'event',
            event: {
              type: 'user/message',
              data: {
                source: { kind: 'user' },
                content: [{ type: 'text', text: longPrompt }],
              },
            },
          },
        ],
      },
    }
    renderLayer([QUESTION])
    await open(['e1'])
    const details = element('history-prompt-fold') as HTMLDetailsElement
    expect(details.open).toBe(false)
    const summary = details.querySelector('summary')?.textContent ?? ''
    expect(summary).toBe(`${firstLine.slice(0, 100)}...`)
    expect(details.querySelector('.history-text.markdown-body')?.textContent).toContain('乙'.repeat(20))
  })
})

describe('样式红线', () => {
  it('弹窗用 Glass 表面并盖过标题栏，拖拽区无滤镜，通知浮层样式已删', () => {
    const styles = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8')
    const index = readFileSync(resolve(import.meta.dirname, '../src/index.css'), 'utf8')
    expect(styles).not.toContain('.pending-layer')
    expect(styles).not.toContain('.shell:has(.pending-layer) .op-layer')
    expect(styles).toContain('position: fixed;\n  inset: 0;\n  z-index: 60;')
    expect(styles).toContain('background: var(--glass-surface-elevated);')
    expect(styles).toContain('backdrop-filter: blur(20px) saturate(140%);')
    expect(index).toContain('.window-gutter,\n  .titlebar-pad,\n  .gate-drag {')
    expect(index).toContain('backdrop-filter: none;')
  })
})
