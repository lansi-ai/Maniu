/** 审批与提问的回执编码：宿主只认这些原文。 */
import { describe, expect, it } from 'vitest'
import {
  answerBatch, approvalOutcome, approvalViewOf, emptyDrafts, groupPending, interactionOf, pendingForSession,
  questionCountForSession, questionOutcome, questionsOf, selectOption, sessionOfInteraction, summaryOfInteraction,
  unmappedPending, UNMAPPED_GROUP_KEY, type PendingInteraction,
} from '../src/chat/pending.ts'

describe('interactionOf', () => {
  it('只认两种 waterfall', () => {
    expect(interactionOf('approval/request', 'c1', 'e1', { toolName: 'x' })).toMatchObject({
      id: 'e1',
      kind: 'approval',
      clientId: 'c1',
    })
    expect(interactionOf('user-questions/request', 'c1', 'e2', { questions: [] })).toMatchObject({ kind: 'question' })
    expect(interactionOf('other/event', 'c1', 'e3', {})).toBeUndefined()
    expect(interactionOf('approval/request', 'c1', 'e1', 'nope')).toBeUndefined()
  })

  it('把 agentId 当作会话标识原样记下，不从 clientId 或内容推断', () => {
    const interaction = interactionOf('user-questions/request', 'client-gen', 'e1', {
      questions: [{ id: 'q1', question: '选一个', options: [{ label: 'A' }] }],
    }, 'session-42')
    expect(interaction).toMatchObject({ sessionId: 'session-42', clientId: 'client-gen' })
  })

  it('agentId 缺失或为空串时不归属，也不编造会话', () => {
    expect(interactionOf('user-questions/request', 'c', 'e', {}, undefined)?.sessionId).toBeUndefined()
    expect(interactionOf('user-questions/request', 'c', 'e', {}, '')?.sessionId).toBeUndefined()
  })
})

describe('审批回执', () => {
  it('原样发回 allowed-once 与 rejected', () => {
    expect(approvalOutcome(true)).toEqual({ kind: 'result', value: 'allowed-once' })
    expect(approvalOutcome(false)).toEqual({ kind: 'result', value: 'rejected' })
  })

  it('优先显示本地化理由，缺省回落到原文', () => {
    expect(approvalViewOf({ toolName: 'cmd_run', displayReason: { en: 'run?', zh: '要跑命令' } }))
      .toEqual({ toolName: 'cmd_run', reason: '要跑命令' })
    expect(approvalViewOf({ toolName: 'cmd_run', reason: 'needs sandbox' }))
      .toEqual({ toolName: 'cmd_run', reason: 'needs sandbox' })
    expect(approvalViewOf({})).toEqual({ toolName: 'tool' })
  })
})

describe('提问回执', () => {
  const request = {
    questions: [
      { id: 'q1', question: '选一个', options: [{ label: 'A' }, { label: 'B', description: '第二个' }] },
      { id: 'q2', question: '补充', multiSelect: true, options: [{ label: 'X' }, { label: 'Y' }] },
    ],
  }
  const questions = questionsOf(request)

  it('读问题与选项', () => {
    expect(questions).toEqual([
      { id: 'q1', question: '选一个', options: [{ label: 'A' }, { label: 'B', description: '第二个' }], multiSelect: false },
      { id: 'q2', question: '补充', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true },
    ])
  })

  it('单选替换、多选累积', () => {
    const first = { ...emptyDrafts(questions) }
    const single = selectOption(questions[0]!, first.q1!, 'A')
    expect(selectOption(questions[0]!, single, 'B').selected).toEqual(['B'])
    expect(selectOption(questions[0]!, single, 'A').selected).toEqual([])
    const multi = selectOption(questions[1]!, first.q2!, 'X')
    expect(selectOption(questions[1]!, multi, 'Y').selected).toEqual(['X', 'Y'])
  })

  it('没答全时不能提交', () => {
    const drafts = { ...emptyDrafts(questions), q1: { selected: ['A'], custom: '' } }
    expect(answerBatch(questions, drafts)).toBeNull()
    expect(questionOutcome(questions, drafts)).toBeNull()
  })

  it('提交时带自定义回答', () => {
    const drafts = {
      q1: { selected: ['A'], custom: '' },
      q2: { selected: ['X'], custom: ' 还有别的 ' },
    }
    expect(questionOutcome(questions, drafts)).toEqual({
      kind: 'result',
      value: {
        answers: [
          { id: 'q1', selected: ['A'] },
          { id: 'q2', selected: ['X'], custom: '还有别的' },
        ],
      },
    })
  })

  it('空问题列表不产生回执', () => {
    expect(questionOutcome([], {})).toBeNull()
  })
})

describe('通知归组与摘要', () => {
  const interaction = (id: string, extra: Partial<PendingInteraction> = {}): PendingInteraction => ({
    id,
    kind: 'question',
    clientId: 'client-1',
    eventId: id,
    request: { questions: [{ id: 'q1', question: '选一个', options: [{ label: 'A' }] }] },
    ...extra,
  })

  it('按确定关联的会话分组，无关联的进 unknown 组', () => {
    const groups = groupPending([
      interaction('a', { sessionId: 's1' }),
      interaction('b', { sessionId: 's2' }),
      interaction('c', { sessionId: 's1' }),
      interaction('d'),
    ])
    expect(groups.map(group => group.key)).toEqual(['s1', 's2', 'unknown'])
    expect(groups[0]?.sessionId).toBe('s1')
    expect(groups[0]?.items.map(item => item.id)).toEqual(['a', 'c'])
    expect(groups[2]?.sessionId).toBeNull()
    expect(groups[2]?.key).toBe(UNMAPPED_GROUP_KEY)
  })

  it('摘要只读题目数与工具名，不读问题正文', () => {
    expect(summaryOfInteraction(interaction('a'))).toEqual({ kind: 'question', count: 1 })
    expect(summaryOfInteraction({
      ...interaction('b'),
      kind: 'approval',
      request: { toolName: 'cmd_run' },
    })).toEqual({ kind: 'approval', count: 0, toolName: 'cmd_run' })
  })
})

describe('会话归属纯函数', () => {
  const twoQuestions = {
    questions: [
      { id: 'q1', question: '甲', options: [{ label: 'A' }] },
      { id: 'q2', question: '乙', options: [{ label: 'B' }] },
    ],
  }
  const items: readonly PendingInteraction[] = [
    { id: 'a', kind: 'question', clientId: 'c', eventId: 'a', request: twoQuestions, sessionId: 's1' },
    { id: 'b', kind: 'question', clientId: 'c', eventId: 'b', request: { questions: [{ id: 'q', question: '丙' }] }, sessionId: 's2' },
    { id: 'c', kind: 'approval', clientId: 'c', eventId: 'c', request: { toolName: 'cmd_run' }, sessionId: 's1' },
    { id: 'd', kind: 'question', clientId: 'c', eventId: 'd', request: twoQuestions },
  ]

  it('sessionOfInteraction 只返回字符串会话标识，缺关联返回 null', () => {
    expect(items.map(sessionOfInteraction)).toEqual(['s1', 's2', 's1', null])
    expect(sessionOfInteraction({ ...items[0]!, sessionId: '' })).toBeNull()
  })

  it('多任务并行提问按 sessionId 字符串相等归到正确会话', () => {
    expect(pendingForSession(items, 's1').map(item => item.id)).toEqual(['a', 'c'])
    expect(pendingForSession(items, 's2').map(item => item.id)).toEqual(['b'])
    expect(pendingForSession(items, 's3')).toEqual([])
  })

  it('题目数只数对应会话的提问，审批不计入', () => {
    expect(questionCountForSession(items, 's1')).toBe(2)
    expect(questionCountForSession(items, 's2')).toBe(1)
    expect(questionCountForSession(items, 's3')).toBe(0)
  })

  it('没有可归属会话或会话没有任务卡的交互进入中性兜底', () => {
    expect(unmappedPending(items, ['s1', 's2']).map(item => item.id)).toEqual(['d'])
    expect(unmappedPending(items, ['s1']).map(item => item.id)).toEqual(['b', 'd'])
    expect(unmappedPending(items, ['s1', 's2', 's3']).map(item => item.id)).toEqual(['d'])
  })
})
