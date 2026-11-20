// @vitest-environment jsdom
/** T-291：右下待回答通知与带会话上下文的回答弹窗。 */
import { act, useState } from 'react'
import type { JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventOutcome } from '@maniu/desktop/contract'
import type { AnswerResult } from '../src/shell/pending-cards.tsx'
import { PendingLayer } from '../src/shell/pending-notification.tsx'
import { playPendingTone } from '../src/shell/pending-sound.ts'
import type { PendingInteraction } from '../src/chat/pending.ts'
import { translate, type Translate } from '../src/locale.ts'
import type { SessionSummary } from '../src/store.ts'

vi.mock('../src/shell/pending-sound.ts', () => ({ playPendingTone: vi.fn() }))

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
  source: { title: '评审需求 REQ-01', roleLabel: '项目经理', sourceLabel: '需求分析师' },
}
const APPROVAL: PendingInteraction = {
  id: 'e2',
  kind: 'approval',
  clientId: 'c1',
  eventId: 'e2',
  request: { toolName: 'cmd_run' },
  sessionId: 's2',
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

function renderLayer(
  items: readonly PendingInteraction[],
  onAnswer: (interaction: PendingInteraction, outcome: EventOutcome) => Promise<AnswerResult> =
    async () => ({ ok: true }),
): void {
  function Harness(): JSX.Element {
    const [current, setCurrent] = useState<readonly PendingInteraction[]>(items)
    updateItems = setCurrent
    const answer = async (interaction: PendingInteraction, outcome: EventOutcome): Promise<AnswerResult> => {
      const result = await onAnswer(interaction, outcome)
      if (result.ok) setCurrent(list => list.filter(item => item.id !== interaction.id))
      return result
    }
    return (
      <PendingLayer visible t={t} items={current} sessions={SESSIONS} titles={TITLES} onAnswer={answer} />
    )
  }
  act(() => { root.render(<Harness />) })
}

function query(testId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}
function element(testId: string): HTMLElement {
  const node = query(testId)
  expect(node).not.toBeNull()
  return node as HTMLElement
}
function all(testId: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)]
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

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  historyResult = { ok: true, value: { records: RECORDS } }
  call = vi.fn(async (namespace: string, method: string) => {
    if (namespace === 'session' && method === 'events') return historyResult
    return { ok: true, value: {} }
  })
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call } })
  localStorage.clear()
  vi.mocked(playPendingTone).mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
})

describe('右下非阻塞通知', () => {
  it('显示会话标题、操作来源与摘要，不抢焦点也不自动开弹窗', () => {
    renderLayer([QUESTION])
    expect(query('pending-review')).not.toBeNull()
    expect(query('pending-dialog')).toBeNull()
    expect(query('question-card')).toBeNull()
    expect(element('pending-notice-source').textContent).toBe('评审会话')
    expect(element('pending-notice-operation').textContent).toContain('评审需求 REQ-01')
    expect(element('pending-notice-count').textContent).toBe('1 项待处理')
    expect(element('pending-notice-item').textContent).toContain('待回答 1 题')
    expect(document.activeElement?.getAttribute('data-testid')).not.toBe('pending-review')
  })

  it('并行两个会话按确定 sessionId 分成两条通知', () => {
    renderLayer([QUESTION, APPROVAL])
    expect(all('pending-notice')).toHaveLength(2)
    expect(all('pending-notice').map(node => node.getAttribute('data-session-id'))).toEqual(['s1', 's2'])
    expect(all('pending-notice-source').map(node => node.textContent)).toEqual(['评审会话', '立项会话'])
    expect(element('pending-notice-source').textContent).toBe('评审会话')
  })

  it('缺确定关联时显示来源会话不可用，不查历史', async () => {
    renderLayer([{ ...QUESTION, sessionId: undefined, source: undefined }])
    expect(element('pending-notice-source').textContent).toBe('来源会话不可用')
    await press('pending-review')
    expect(call).not.toHaveBeenCalled()
    expect(element('pending-dialog-history').textContent).toContain('无法确定来源会话')
    expect(query('question-card')).not.toBeNull()
  })
})

describe('带会话上下文弹窗', () => {
  it('点通知打开弹窗，读 session/events 并标出用户与助手发言', async () => {
    renderLayer([QUESTION])
    await press('pending-review')
    await flush()
    expect(element('pending-dialog')).not.toBeNull()
    expect(call).toHaveBeenCalledWith('session', 'events', {
      request: { address: { kind: 'session', sessionId: 's1' }, maxMessages: 200 },
    })
    expect(element('pending-dialog-history').textContent).toContain('请评审 REQ-01')
    expect(element('pending-dialog-history').textContent).toContain('已开始评审')
    expect(all('history-row').map(node => node.getAttribute('data-role'))).toEqual(['user', 'assistant'])
    expect(query('question-card')).not.toBeNull()
  })

  it('关闭重开保留草稿，Escape 关闭后焦点回到通知控件', async () => {
    renderLayer([QUESTION])
    const trigger = await press('pending-review')
    expect(document.activeElement).toBe(element('pending-dialog'))
    await typeInto(element('question-custom') as HTMLInputElement, '我的补充')
    await press('pending-dialog-close')
    expect(query('pending-dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await press('pending-review')
    expect((element('question-custom') as HTMLInputElement).value).toBe('我的补充')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(query('pending-dialog')).toBeNull()
  })

  it('回答成功后移除交互并关闭弹窗', async () => {
    const onAnswer = vi.fn(async () => ({ ok: true as const }))
    renderLayer([QUESTION], onAnswer)
    await press('pending-review')
    await press('question-option')
    await press('question-submit')
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(query('pending-notifications')).toBeNull()
    expect(query('pending-dialog')).toBeNull()
  })

  it('回答失败保留弹窗、草稿与可读错误，可重试', async () => {
    const onAnswer = vi.fn(async () => ({ ok: false as const, message: '回执失败' }))
    renderLayer([QUESTION], onAnswer)
    await press('pending-review')
    await press('question-option')
    await typeInto(element('question-custom') as HTMLInputElement, '补充内容')
    await press('question-submit')
    expect(element('question-error').textContent).toContain('回执失败')
    expect(element('pending-dialog')).not.toBeNull()
    expect((element('question-custom') as HTMLInputElement).value).toBe('补充内容')
    await press('question-submit')
    expect(onAnswer).toHaveBeenCalledTimes(2)
  })

  it('历史加载失败时保留回答控件', async () => {
    historyResult = { ok: false, error: { code: 'oops', message: 'oops' } }
    renderLayer([QUESTION])
    await press('pending-review')
    expect(element('pending-history-error')).not.toBeNull()
    expect(query('question-card')).not.toBeNull()
  })

  it('交互被取消时关闭弹窗与通知', async () => {
    renderLayer([QUESTION])
    await press('pending-review')
    expect(query('pending-dialog')).not.toBeNull()
    act(() => { updateItems([]) })
    expect(query('pending-dialog')).toBeNull()
    expect(query('pending-notifications')).toBeNull()
  })
})

describe('音效开关', () => {
  it('默认静音；开启后新交互只响一次，更新与关开弹窗不重播', async () => {
    renderLayer([QUESTION])
    expect(playPendingTone).not.toHaveBeenCalled()
    expect(element('pending-sound-toggle').getAttribute('aria-pressed')).toBe('false')

    await press('pending-sound-toggle')
    expect(element('pending-sound-toggle').getAttribute('aria-pressed')).toBe('true')
    expect(playPendingTone).not.toHaveBeenCalled()

    const fresh: PendingInteraction = { ...QUESTION, id: 'e3', eventId: 'e3' }
    act(() => { updateItems([QUESTION, fresh]) })
    await flush()
    expect(playPendingTone).toHaveBeenCalledTimes(1)

    act(() => { updateItems([QUESTION, { ...fresh, request: { questions: [] } }]) })
    await flush()
    expect(playPendingTone).toHaveBeenCalledTimes(1)

    await press('pending-review')
    await press('pending-dialog-close')
    expect(playPendingTone).toHaveBeenCalledTimes(1)
  })
})
