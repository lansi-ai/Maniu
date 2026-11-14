/** 会话主链的纯折叠：follow 的 snapshot / event / assistant-stream 三帧。 */

/** 会话列表项。 */
export interface SessionSummary {
  readonly sessionId: string
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly cwd?: string
  readonly parentSessionId?: string
  readonly origin?: string
  readonly agentPreset?: string
}

/** 一条画在聊天区里的消息。 */
export interface ChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly seq?: number
  /** 这条答复里调用过的工具名；按出现顺序去重。 */
  readonly tools?: readonly string[]
}

/** 一条 durable 会话记录。 */
export interface HistoryRecord {
  readonly type: 'event'
  readonly event: { readonly type: string; readonly seq: number; readonly time: number; readonly data: unknown }
}

interface ActiveAttempt {
  readonly attemptId: string
  readonly revision: number
  nextIndex: number
  readonly settleSeq?: number
}

/** 一个会话的主链状态。 */
export interface ChatState {
  readonly messages: readonly ChatMessage[]
  readonly liveText: string
  readonly attempt: ActiveAttempt | null
  readonly seen: readonly number[]
  readonly rebaseline: number
  readonly streamError: string | null
}

/** 初始状态。 */
export const emptyChat: ChatState = {
  messages: [],
  liveText: '',
  attempt: null,
  seen: [],
  rebaseline: 0,
  streamError: null,
}

/** 折叠动作。 */
export type ChatAction =
  | { readonly type: 'reset' }
  | { readonly type: 'snapshot'; readonly records: readonly HistoryRecord[]; readonly baseline: unknown }
  | { readonly type: 'event'; readonly record: HistoryRecord }
  | { readonly type: 'assistant-start'; readonly attemptId: string; readonly revision: number }
  | { readonly type: 'assistant-chunk'; readonly attemptId: string; readonly revision: number; readonly index: number; readonly chunk: unknown }
  | { readonly type: 'assistant-end'; readonly attemptId: string; readonly revision: number; readonly outcome: unknown }
  | { readonly type: 'stream-error'; readonly message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

/** 从一条 durable 记录得到可显示消息；不显示注入上下文与工具结果。 */
export function messageOfRecord(record: HistoryRecord): ChatMessage | undefined {
  const event = record.event
  if (event.type === 'user/message') {
    if (!isRecord(event.data) || !isRecord(event.data.source) || event.data.source.kind !== 'user') return undefined
    const text = textOfContent(event.data.content)
    return text === '' ? undefined : { id: `u-${String(event.seq)}`, role: 'user', text, seq: event.seq }
  }
  if (event.type === 'assistant/message') {
    if (!isRecord(event.data) || !isRecord(event.data.message)) return undefined
    const content = event.data.message.content
    const text = textOfContent(content)
    const tools = toolNamesOf(content)
    if (text === '') return undefined
    return {
      id: `a-${String(event.seq)}`,
      role: 'assistant',
      text,
      seq: event.seq,
      ...(tools.length === 0 ? {} : { tools }),
    }
  }
  return undefined
}

/** 把重连基线里的紧凑流展开成文本。 */
export function baselineText(baseline: unknown): string {
  if (!isRecord(baseline) || !isRecord(baseline.activeAttempt)) return ''
  const stream = baseline.activeAttempt.stream
  if (!Array.isArray(stream)) return ''
  const parts: string[] = []
  for (const record of stream) {
    if (!isRecord(record)) continue
    if (record.type === 'text-chunks' && Array.isArray(record.texts)) {
      for (const text of record.texts) if (typeof text === 'string') parts.push(text)
    } else if (record.type === 'chunk' && isRecord(record.chunk)
      && record.chunk.type === 'text-delta' && typeof record.chunk.text === 'string') {
      parts.push(record.chunk.text)
    }
  }
  return parts.join('')
}

/** 内容块里的工具名；按首次出现去重。 */
function toolNamesOf(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const names: string[] = []
  for (const block of content) {
    if (isRecord(block) && block.type === 'tool-call' && typeof block.name === 'string'
      && !names.includes(block.name)) names.push(block.name)
  }
  return names
}

function messagesOf(records: readonly HistoryRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const record of records) {
    const message = messageOfRecord(record)
    if (message !== undefined) messages.push(message)
  }
  return messages
}

function recordOf(value: unknown): HistoryRecord | undefined {
  if (!isRecord(value) || value.type !== 'event' || !isRecord(value.event)) return undefined
  const event = value.event
  if (typeof event.type !== 'string' || typeof event.seq !== 'number') return undefined
  return { type: 'event', event: { type: event.type, seq: event.seq, time: typeof event.time === 'number' ? event.time : 0, data: event.data } }
}

function appendMessage(state: ChatState, record: HistoryRecord): ChatState {
  if (state.seen.includes(record.event.seq)) return state
  const message = messageOfRecord(record)
  const seen = [...state.seen, record.event.seq]
  const settles = state.attempt !== null && state.attempt.settleSeq === record.event.seq
  return {
    ...state,
    messages: message === undefined ? state.messages : [...state.messages, message],
    seen,
    ...(settles ? { attempt: null, liveText: '' } : {}),
  }
}

/**
 * 折叠一帧或一个事件。
 * @param state - 当前主链状态。
 * @param action - 折叠动作。
 * @returns 新状态。
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'reset':
      return emptyChat
    case 'snapshot': {
      const attempt = isRecord(action.baseline) && isRecord(action.baseline.activeAttempt)
        && typeof action.baseline.activeAttempt.attemptId === 'string'
        && typeof action.baseline.activeAttempt.revision === 'number'
        ? {
          attemptId: action.baseline.activeAttempt.attemptId,
          revision: action.baseline.activeAttempt.revision,
          nextIndex: typeof action.baseline.activeAttempt.nextIndex === 'number' ? action.baseline.activeAttempt.nextIndex : 0,
        }
        : null
      return {
        messages: messagesOf(action.records),
        liveText: baselineText(action.baseline),
        attempt,
        seen: action.records.map(record => record.event.seq),
        rebaseline: state.rebaseline,
        streamError: null,
      }
    }
    case 'event':
      return appendMessage(state, action.record)
    case 'assistant-start':
      if (state.attempt !== null) return { ...state, rebaseline: state.rebaseline + 1 }
      return { ...state, attempt: { attemptId: action.attemptId, revision: action.revision, nextIndex: 0 }, liveText: '', streamError: null }
    case 'assistant-chunk': {
      const attempt = state.attempt
      if (attempt === null || attempt.attemptId !== action.attemptId
        || attempt.revision !== action.revision || attempt.nextIndex !== action.index) {
        return { ...state, rebaseline: state.rebaseline + 1 }
      }
      const text = isRecord(action.chunk) && action.chunk.type === 'text-delta' && typeof action.chunk.text === 'string'
        ? action.chunk.text
        : ''
      return {
        ...state,
        attempt: { ...attempt, nextIndex: attempt.nextIndex + 1 },
        liveText: state.liveText + text,
      }
    }
    case 'assistant-end': {
      const attempt = state.attempt
      if (attempt === null || attempt.attemptId !== action.attemptId || attempt.revision !== action.revision) return state
      const outcome = action.outcome
      if (!isRecord(outcome) || outcome.kind !== 'committed') {
        return { ...state, attempt: null, liveText: '' }
      }
      const seq = typeof outcome.seq === 'number' ? outcome.seq : undefined
      if (seq !== undefined && state.messages.some(message => message.seq === seq)) {
        return { ...state, attempt: null, liveText: '' }
      }
      return { ...state, attempt: { ...attempt, ...(seq === undefined ? {} : { settleSeq: seq }) } }
    }
    case 'stream-error':
      return { ...state, streamError: action.message, attempt: null, liveText: '' }
    default:
      return state
  }
}

/** 一条 follow 帧转成折叠动作。 */
export function actionOfFrame(value: unknown): ChatAction | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'snapshot') {
    return {
      type: 'snapshot',
      records: Array.isArray(value.records) ? value.records.flatMap(record => recordOf(record) ?? []) : [],
      baseline: value.assistantStream,
    }
  }
  if (value.type === 'event' && isRecord(value.event) && typeof value.event.type === 'string'
    && typeof value.event.seq === 'number') {
    return { type: 'event', record: { type: 'event', event: { type: value.event.type, seq: value.event.seq, time: typeof value.event.time === 'number' ? value.event.time : 0, data: value.event.data } } }
  }
  if (value.type === 'assistant-stream' && isRecord(value.frame)) {
    const frame = value.frame
    if (typeof frame.attemptId !== 'string' || typeof frame.revision !== 'number') return undefined
    if (frame.type === 'start') return { type: 'assistant-start', attemptId: frame.attemptId, revision: frame.revision }
    if (frame.type === 'chunk' && typeof frame.index === 'number') {
      return { type: 'assistant-chunk', attemptId: frame.attemptId, revision: frame.revision, index: frame.index, chunk: frame.chunk }
    }
    if (frame.type === 'end') return { type: 'assistant-end', attemptId: frame.attemptId, revision: frame.revision, outcome: frame.outcome }
  }
  return undefined
}

/** 把 `session/list` 与事件载荷裁成列表项。 */
export function summaryOf(value: unknown): SessionSummary | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.updatedAt !== 'number') return undefined
  return {
    sessionId: value.sessionId,
    updatedAt: value.updatedAt,
    running: value.running === true,
    blank: value.blank === true,
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
    ...(typeof value.parentSessionId === 'string' ? { parentSessionId: value.parentSessionId } : {}),
    ...(typeof value.origin === 'string' ? { origin: value.origin } : {}),
    ...(typeof value.projections === 'object' && value.projections !== null && 'agentPreset' in value.projections
      && typeof value.projections.agentPreset === 'string' ? { agentPreset: value.projections.agentPreset } : {}),
  }
}
