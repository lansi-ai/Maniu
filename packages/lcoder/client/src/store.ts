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

/** 聊天里一条图片附件：只保留预览与尺寸需要的字段。 */
export interface ChatImageAttachment {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** 聊天里一条文件附件。 */
export interface ChatFileAttachment {
  readonly name: string
  readonly bytes: number
}

/** 用户消息里的一条附件。 */
export type ChatAttachment =
  | { readonly kind: 'image'; readonly image: ChatImageAttachment }
  | { readonly kind: 'file'; readonly file: ChatFileAttachment }

/** 一段过程里的一个条目：思考，或一次工具调用。 */
export type ProcessItem =
  | { readonly kind: 'reasoning'; readonly text: string }
  | {
    readonly kind: 'tool'
    readonly callId: string
    readonly name: string
    /** 调用参数原文；渲染时截断，不在状态里丢信息。 */
    readonly args: string
  }

/** 画在聊天区里的一行。过程组按回合收敛，正文与用户发言照日志顺序排列。 */
export type ChatRow =
  | {
    readonly kind: 'user'
    readonly id: string
    readonly text: string
    readonly attachments: readonly ChatAttachment[]
  }
  | { readonly kind: 'process'; readonly id: string; readonly items: readonly ProcessItem[] }
  | { readonly kind: 'assistant'; readonly id: string; readonly text: string }

/** 一次工具调用的结果；`summary` 只留一行并截断。 */
export interface ToolOutcome {
  readonly ok: boolean
  readonly summary: string
}

/** 一条 durable 会话记录。 */
export interface HistoryRecord {
  readonly type: 'event'
  readonly event: {
    readonly type: string
    readonly seq: number
    readonly time: number
    readonly data: unknown
    readonly surfaceOp?: unknown
  }
}

interface ActiveAttempt {
  readonly attemptId: string
  readonly revision: number
  nextIndex: number
  readonly settleSeq?: number
}

/** 一个回合里还没落成行的过程条目与正文。 */
interface TurnBuffer {
  readonly id: string
  readonly number: number
  readonly items: readonly ProcessItem[]
  readonly texts: readonly string[]
}

/** 一个会话的主链状态。 */
export interface ChatState {
  readonly rows: readonly ChatRow[]
  readonly liveText: string
  readonly attempt: ActiveAttempt | null
  readonly turn: TurnBuffer | null
  /** 已折叠到的日志位置；下一条 live 事件必须是 cursor + 1，否则补洞。 */
  readonly cursor: number
  readonly nextSeq: number
  readonly rebaseline: number
  readonly streamError: string | null
  readonly title: string | null
  readonly projections: Readonly<Record<string, unknown>>
  /** 开场帧投影的水位；控制流的同键更新只有更新时才覆盖。 */
  readonly projectionSeq: number
  readonly toolResults: Readonly<Record<string, ToolOutcome>>
}

/** 初始状态。 */
export const emptyChat: ChatState = {
  rows: [],
  liveText: '',
  attempt: null,
  turn: null,
  cursor: 0,
  nextSeq: 1,
  rebaseline: 0,
  streamError: null,
  title: null,
  projections: {},
  projectionSeq: 0,
  toolResults: {},
}

/** 折叠动作。 */
export type ChatAction =
  | { readonly type: 'reset' }
  | {
    readonly type: 'snapshot'
    readonly records: readonly HistoryRecord[]
    readonly baseline: unknown
    readonly cursor: number
    readonly projections: unknown
  }
  | { readonly type: 'event'; readonly record: HistoryRecord }
  | { readonly type: 'assistant-start'; readonly attemptId: string; readonly revision: number }
  | {
    readonly type: 'assistant-chunk'
    readonly attemptId: string
    readonly revision: number
    readonly index: number
    readonly chunk: unknown
  }
  | {
    readonly type: 'assistant-end'
    readonly attemptId: string
    readonly revision: number
    readonly outcome: unknown
  }
  | { readonly type: 'stream-error'; readonly message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

/**
 * 结果摘要：只留一行并截断，避免把整段工具输出塞进消息列表。
 * @param content - 工具结果的内容块。
 * @returns 可显示的一行摘要。
 */
export function resultSummary(content: unknown): string {
  const text = textOfContent(content).replace(/\s+/gu, ' ').trim()
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

function imageOf(value: unknown): ChatImageAttachment | undefined {
  if (!isRecord(value) || typeof value.attachmentId !== 'string' || typeof value.mediaType !== 'string') return undefined
  const bytes = finiteNumber(value.bytes)
  const width = finiteNumber(value.width)
  const height = finiteNumber(value.height)
  if (bytes === undefined || width === undefined || height === undefined) return undefined
  return {
    attachmentId: value.attachmentId,
    mediaType: value.mediaType,
    bytes,
    width,
    height,
    ...(typeof value.name === 'string' && value.name !== '' ? { name: value.name } : {}),
  }
}

function attachmentsOf(content: unknown): ChatAttachment[] {
  if (!Array.isArray(content)) return []
  const attachments: ChatAttachment[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'image') {
      const image = imageOf(block.attachment)
      if (image !== undefined) attachments.push({ kind: 'image', image })
      continue
    }
    if (block.type === 'file' && isRecord(block.attachment)
      && typeof block.attachment.name === 'string' && typeof block.attachment.bytes === 'number') {
      attachments.push({ kind: 'file', file: { name: block.attachment.name, bytes: block.attachment.bytes } })
    }
  }
  return attachments
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

function attemptOf(baseline: unknown): ActiveAttempt | null {
  if (!isRecord(baseline) || !isRecord(baseline.activeAttempt)) return null
  const attempt = baseline.activeAttempt
  if (typeof attempt.attemptId !== 'string' || typeof attempt.revision !== 'number') return null
  return {
    attemptId: attempt.attemptId,
    revision: attempt.revision,
    nextIndex: typeof attempt.nextIndex === 'number' ? attempt.nextIndex : 0,
  }
}

/** follow 开场帧里的投影值；结构不完整时为空对象，不把「读不到」当成空投影。 */
export function projectionsOf(source: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(source) || !isRecord(source.values)) return {}
  return source.values
}

/** 开场帧投影的水位；缺省为 0，控制流更新随之生效。 */
export function projectionSeqOf(source: unknown): number {
  return isRecord(source) && typeof source.asOfSeq === 'number' ? source.asOfSeq : 0
}

function turnNumberOf(data: unknown): number {
  return isRecord(data) && typeof data.turn === 'number' ? data.turn : 0
}

function flushTurn(state: ChatState): ChatState {
  const turn = state.turn
  if (turn === null) return state
  const rows: ChatRow[] = [...state.rows]
  if (turn.items.length > 0) rows.push({ kind: 'process', id: `p-${turn.id}`, items: turn.items })
  const text = turn.texts.join('\n\n').trim()
  if (text !== '') rows.push({ kind: 'assistant', id: `a-${turn.id}`, text })
  return { ...state, rows, turn: null }
}

function pushUser(state: ChatState, content: unknown, seq: number): ChatState {
  const text = textOfContent(content)
  const attachments = attachmentsOf(content)
  if (text.trim() === '' && attachments.length === 0) return state
  const flushed = flushTurn(state)
  return {
    ...flushed,
    rows: [...flushed.rows, { kind: 'user', id: `u-${String(seq)}`, text, attachments }],
  }
}

function collectAssistant(state: ChatState, data: unknown, seq: number): ChatState {
  if (!isRecord(data) || !isRecord(data.message) || !Array.isArray(data.message.content)) return state
  const number = turnNumberOf(data)
  const base = state.turn !== null && state.turn.number !== number ? flushTurn(state) : state
  const started: TurnBuffer = base.turn ?? { id: String(seq), number, items: [], texts: [] }
  const items: ProcessItem[] = [...started.items]
  const texts: string[] = [...started.texts]
  for (const block of data.message.content) {
    if (!isRecord(block)) continue
    if (block.type === 'reasoning' && typeof block.text === 'string' && block.text.trim() !== '') {
      items.push({ kind: 'reasoning', text: block.text })
      continue
    }
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      texts.push(block.text)
      continue
    }
    if (block.type === 'tool-call' && typeof block.id === 'string' && typeof block.name === 'string') {
      items.push({
        kind: 'tool',
        callId: block.id,
        name: block.name,
        args: typeof block.arguments === 'string' ? block.arguments : '',
      })
    }
  }
  return { ...base, turn: { ...started, items, texts } }
}

function collectToolResult(state: ChatState, data: unknown): ChatState {
  if (!isRecord(data) || !isRecord(data.message) || typeof data.message.toolCallId !== 'string') return state
  const outcome: ToolOutcome = {
    ok: data.message.isError !== true,
    summary: resultSummary(data.message.content),
  }
  return {
    ...state,
    toolResults: { ...state.toolResults, [data.message.toolCallId]: outcome },
  }
}

/** 表面替换意味着旧行已被遮蔽；增量折叠无法自证一致，交给重开快照。 */
function replacesSurface(record: HistoryRecord): boolean {
  return isRecord(record.event.surfaceOp) && record.event.surfaceOp.op === 'replace'
}

function applyEvent(state: ChatState, record: HistoryRecord): ChatState {
  const event = record.event
  switch (event.type) {
    case 'user/message': {
      if (!isRecord(event.data) || !isRecord(event.data.source) || event.data.source.kind !== 'user') return state
      return pushUser(state, event.data.content, event.seq)
    }
    case 'assistant/message':
      return collectAssistant(state, event.data, event.seq)
    case 'tool/result':
      return collectToolResult(state, event.data)
    case 'turn/end':
      return flushTurn(state)
    case 'session/title': {
      if (!isRecord(event.data) || typeof event.data.title !== 'string' || event.data.title.trim() === '') return state
      return { ...state, title: event.data.title }
    }
    default:
      return state
  }
}

/** 折叠一个 durable 事件；seq 不连续时标记重开，不把缺口画成完整历史。 */
function appendEvent(state: ChatState, record: HistoryRecord): ChatState {
  const seq = record.event.seq
  if (seq < state.nextSeq) return state
  if (seq > state.nextSeq) return { ...state, rebaseline: state.rebaseline + 1 }
  if (replacesSurface(record)) return { ...state, rebaseline: state.rebaseline + 1 }
  const applied = applyEvent(state, record)
  const settled = applied.attempt !== null && applied.attempt.settleSeq === seq
  // 提交即落行：先画已提交正文，再清掉流式草稿，避免中间闪一帧空白。
  const next = settled ? flushTurn(applied) : applied
  return {
    ...next,
    nextSeq: seq + 1,
    ...(settled ? { attempt: null, liveText: '' } : {}),
  }
}

function foldRecords(state: ChatState, records: readonly HistoryRecord[]): ChatState {
  let folded = state
  for (const record of records) folded = applyEvent(folded, record)
  return flushTurn(folded)
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
      const folded = foldRecords({ ...emptyChat, rebaseline: state.rebaseline }, action.records)
      return {
        ...folded,
        liveText: baselineText(action.baseline),
        attempt: attemptOf(action.baseline),
        cursor: action.cursor,
        nextSeq: action.cursor + 1,
        projections: projectionsOf(action.projections),
        projectionSeq: projectionSeqOf(action.projections),
        streamError: null,
      }
    }
    case 'event':
      return appendEvent(state, action.record)
    case 'assistant-start':
      if (state.attempt !== null) return { ...state, rebaseline: state.rebaseline + 1 }
      return {
        ...state,
        attempt: { attemptId: action.attemptId, revision: action.revision, nextIndex: 0 },
        liveText: '',
        streamError: null,
      }
    case 'assistant-chunk': {
      const attempt = state.attempt
      if (attempt === null || attempt.attemptId !== action.attemptId
        || attempt.revision !== action.revision || attempt.nextIndex !== action.index) {
        return { ...state, rebaseline: state.rebaseline + 1 }
      }
      const text = isRecord(action.chunk) && action.chunk.type === 'text-delta'
        && typeof action.chunk.text === 'string' ? action.chunk.text : ''
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
      if (seq === undefined || seq < state.nextSeq) return { ...state, attempt: null, liveText: '' }
      return { ...state, attempt: { ...attempt, settleSeq: seq } }
    }
    case 'stream-error':
      // 正文已提交的行不受影响；流式草稿也先留着，重开后的快照才能给出权威版本。
      return { ...state, streamError: action.message, attempt: null }
    default:
      return state
  }
}

function recordOf(value: unknown): HistoryRecord | undefined {
  if (!isRecord(value) || value.type !== 'event' || !isRecord(value.event)) return undefined
  const event = value.event
  if (typeof event.type !== 'string' || typeof event.seq !== 'number') return undefined
  return {
    type: 'event',
    event: {
      type: event.type,
      seq: event.seq,
      time: typeof event.time === 'number' ? event.time : 0,
      data: event.data,
      ...(event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp }),
    },
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
      cursor: typeof value.cursor === 'number' ? value.cursor : 0,
      projections: value.projections,
    }
  }
  if (value.type === 'event') {
    const record = recordOf(value)
    return record === undefined ? undefined : { type: 'event', record }
  }
  if (value.type === 'assistant-stream' && isRecord(value.frame)) {
    const frame = value.frame
    if (typeof frame.attemptId !== 'string' || typeof frame.revision !== 'number') return undefined
    if (frame.type === 'start') return { type: 'assistant-start', attemptId: frame.attemptId, revision: frame.revision }
    if (frame.type === 'chunk' && typeof frame.index === 'number') {
      return {
        type: 'assistant-chunk',
        attemptId: frame.attemptId,
        revision: frame.revision,
        index: frame.index,
        chunk: frame.chunk,
      }
    }
    if (frame.type === 'end') {
      return {
        type: 'assistant-end',
        attemptId: frame.attemptId,
        revision: frame.revision,
        outcome: frame.outcome,
      }
    }
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
