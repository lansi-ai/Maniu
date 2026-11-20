/** 审批与提问的回执编码：宿主只认这些原文。 */
import { describe, expect, it } from 'vitest'
import {
  answerBatch, approvalOutcome, approvalViewOf, emptyDrafts, groupPending, interactionOf, questionOutcome,
  questionsOf, selectOption, summaryOfInteraction, type PendingInteraction,
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
