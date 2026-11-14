/** store 的折叠：三帧、补洞、过程组、结果摘要与标题。 */
import { describe, expect, it } from 'vitest'
import { actionOfFrame, chatReducer, emptyChat, type HistoryRecord } from '../src/store.ts'

function record(type: string, seq: number, data: unknown): HistoryRecord {
  return { type: 'event', event: { type, seq, time: seq, data } }
}

function snapshot(records: readonly HistoryRecord[], cursor: number, extra: {
  readonly projections?: unknown
  readonly assistantStream?: unknown
} = {}): ReturnType<typeof chatReducer> {
  return chatReducer(emptyChat, {
    type: 'snapshot',
    records,
    cursor,
    baseline: extra.assistantStream,
    projections: extra.projections,
  })
}

const user = record('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] })
const toolCall = record('assistant/message', 2, {
  turn: 1,
  step: 1,
  message: {
    content: [
      { type: 'reasoning', text: '先读文件' },
      { type: 'tool-call', id: 'c1', name: 'file_read', arguments: '{"path":"a.ts"}' },
    ],
  },
})
const toolResult = record('tool/result', 3, {
  turn: 1,
  step: 1,
  message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'export const a = 1' }] },
})
const finalText = record('assistant/message', 4, {
  turn: 1,
  step: 2,
  message: { content: [{ type: 'text', text: '读完了' }] },
})

describe('chatReducer snapshot', () => {
  it('把用户发言、过程组与正文按回合分开', () => {
    const state = snapshot([user, toolCall, toolResult, finalText], 4)
    expect(state.rows.map(row => row.kind)).toEqual(['user', 'process', 'assistant'])
    const process = state.rows[1]
    expect(process?.kind === 'process' ? process.items.map(item => item.kind) : []).toEqual(['reasoning', 'tool'])
    expect(state.toolResults.c1).toEqual({ ok: true, summary: 'export const a = 1' })
    expect(state.cursor).toBe(4)
    expect(state.nextSeq).toBe(5)
  })

  it('读标题与投影水位', () => {
    const state = snapshot(
      [record('session/title', 5, { title: '仓库结构', source: { kind: 'user' }, messageSeqs: [] })],
      5,
      { projections: { asOfSeq: 5, values: { contextPressure: { projectedTokens: 12 } } } },
    )
    expect(state.title).toBe('仓库结构')
    expect(state.projectionSeq).toBe(5)
    expect(state.projections.contextPressure).toEqual({ projectedTokens: 12 })
  })

  it('展开重连基线里的流式正文与下一个块序号', () => {
    const state = snapshot([], 9, {
      assistantStream: {
        revision: 3,
        activeAttempt: { attemptId: 'a1', revision: 3, nextIndex: 2, stream: [{ type: 'text-chunks', texts: ['你', '好'] }] },
      },
    })
    expect(state.liveText).toBe('你好')
    expect(state.attempt?.nextIndex).toBe(2)
  })
})

describe('chatReducer event', () => {
  it('seq 出现缺口时要求重开快照，而不是把缺口画成完整历史', () => {
    const state = snapshot([], 4)
    const next = chatReducer(state, { type: 'event', record: record('user/message', 6, { source: { kind: 'user' }, content: [] }) })
    expect(next.rebaseline).toBe(1)
    expect(next.rows).toEqual([])
  })

  it('重复送达的事件被忽略', () => {
    const state = snapshot([user], 4)
    const next = chatReducer(state, { type: 'event', record: user })
    expect(next).toBe(state)
  })

  it('表面替换要求重开快照', () => {
    const state = snapshot([], 0)
    const replacement = record('assistant/message', 1, { turn: 1, step: 1, message: { content: [] } })
    const withOp: HistoryRecord = {
      ...replacement,
      event: { ...replacement.event, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } },
    }
    expect(chatReducer(state, { type: 'event', record: withOp }).rebaseline).toBe(1)
  })
})

describe('chatReducer assistant-stream', () => {
  it('start/chunk/end 落定后清掉流式草稿并留下正文', () => {
    let state = snapshot([], 0)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'text-delta', text: '你' } })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 1, chunk: { type: 'text-delta', text: '好' } })
    expect(state.liveText).toBe('你好')
    state = chatReducer(state, { type: 'assistant-end', attemptId: 'a1', revision: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 1 } })
    state = chatReducer(state, { type: 'event', record: record('assistant/message', 1, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '你好' }] } }) })
    expect(state.liveText).toBe('')
    expect(state.attempt).toBeNull()
    expect(state.rows).toEqual([{ kind: 'assistant', id: 'a-1', text: '你好' }])
  })

  it('块序号不对时要求重开快照', () => {
    let state = snapshot([], 0)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    const next = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 3, chunk: { type: 'text-delta', text: 'x' } })
    expect(next.rebaseline).toBe(1)
  })

  it('传输错误保留已提交正文与流式草稿', () => {
    let state = snapshot([user], 1)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'text-delta', text: '半句' } })
    const errored = chatReducer(state, { type: 'stream-error', message: 'transport-closed' })
    expect(errored.rows).toEqual(state.rows)
    expect(errored.liveText).toBe('半句')
    expect(errored.streamError).toBe('transport-closed')
    expect(errored.attempt).toBeNull()
  })
})

describe('actionOfFrame', () => {
  it('把三帧转成折叠动作', () => {
    expect(actionOfFrame({ type: 'snapshot', records: [], cursor: 2, projections: { asOfSeq: 2, values: {} } }))
      .toMatchObject({ type: 'snapshot', cursor: 2 })
    expect(actionOfFrame({ type: 'event', event: { type: 'turn/end', seq: 3, time: 0, data: {} } }))
      .toMatchObject({ type: 'event' })
    expect(actionOfFrame({
      type: 'assistant-stream',
      frame: { type: 'start', attemptId: 'a', revision: 1, startedAfterSeq: 2, turn: 1, step: 1 },
    })).toEqual({ type: 'assistant-start', attemptId: 'a', revision: 1 })
  })

  it('无法识别的帧不产生动作', () => {
    expect(actionOfFrame({ type: 'unknown' })).toBeUndefined()
    expect(actionOfFrame('nope')).toBeUndefined()
  })
})
