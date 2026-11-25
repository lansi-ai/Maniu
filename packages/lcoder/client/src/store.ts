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
  readonly title?: string
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
  /** 最近接受的帧序号（宿主每帧 +1）；不是 attempt 代号。 */
  revision: number
  nextIndex: number
  readonly settleSeq?: number
}

/** 一次模型重试提示；`attempt` 是第几次重试，从 1 开始。 */
export interface ChatRetryNotice {
  readonly attempt: number
  /** 重试上限；策略为无限重试时为空。 */
  readonly max: number | null
}

/** 回合最终失败；`requestId` 由云端错误体或响应头给出。 */
export interface ChatFailure {
  readonly message: string
  readonly code: string | null
  readonly requestId: string | null
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
  /** 本轮已到达的思考增量；只用于判断思考态，不渲染完整思维链。 */
  readonly liveReasoning: string
  readonly attempt: ActiveAttempt | null
  readonly turn: TurnBuffer | null
  /** 已折叠到的日志位置；下一条 live 事件必须是 cursor + 1，否则补洞。 */
  readonly cursor: number
  readonly nextSeq: number
  readonly rebaseline: number
  readonly streamError: string | null
  /** 模型暂时不可用时的重试提示；恢复或回合结束时清除。 */
  readonly retry: ChatRetryNotice | null
  /** 回合最终失败；新的回合开始时清除。 */
  readonly failure: ChatFailure | null
  /**
   * 已提交、但对应 assistant/message 还没折进来的序号。
   * 中途换 attempt 时把它带过这一跳，事件到达仍即时落行。
   */
  readonly settledSeqs: readonly number[]
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
  liveReasoning: '',
  attempt: null,
  turn: null,
  cursor: 0,
  nextSeq: 1,
  rebaseline: 0,
  streamError: null,
  retry: null,
  failure: null,
  settledSeqs: [],
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

/** 把重连基线里的思考增量展开；正文开始后重连不该再显示思考态。 */
function baselineReasoning(baseline: unknown): string {
  if (baselineText(baseline) !== '') return ''
  if (!isRecord(baseline) || !isRecord(baseline.activeAttempt)) return ''
  const stream = baseline.activeAttempt.stream
  if (!Array.isArray(stream)) return ''
  const parts: string[] = []
  for (const record of stream) {
    if (!isRecord(record)) continue
    if (record.type === 'reasoning-chunks' && Array.isArray(record.texts)) {
      for (const text of record.texts) if (typeof text === 'string') parts.push(text)
    } else if (record.type === 'chunk' && isRecord(record.chunk)
      && record.chunk.type === 'reasoning-delta' && typeof record.chunk.text === 'string') {
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

/** 云端错误体里的请求号；适配器通常已把它放进 `requestId`，文本兜底只认同名键。 */
function requestIdInText(text: string): string | null {
  const match = /"request_?id"\s*:\s*"([^"]+)"/iu.exec(text)
  return match?.[1] ?? null
}

/** 适配器会把云端错误体拼进文案；能解析时用里面的 message，界面上不摊原始 JSON。 */
function embeddedError(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  try {
    const parsed: unknown = JSON.parse(text.slice(start))
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function failureOf(error: unknown): ChatFailure {
  if (!isRecord(error)) return { message: '', code: null, requestId: null }
  const raw = typeof error.message === 'string' ? error.message : ''
  const embedded = embeddedError(raw)
  const message = embedded !== undefined && typeof embedded.message === 'string' ? embedded.message : raw
  const requestId = typeof error.requestId === 'string' && error.requestId !== ''
    ? error.requestId
    : embedded !== undefined && typeof embedded.requestId === 'string'
      ? embedded.requestId
      : requestIdInText(raw)
  const code = embedded !== undefined && typeof embedded.code === 'string'
    ? embedded.code
    : typeof error.code === 'string' ? error.code : null
  return { message, code, requestId }
}

function retryOf(data: unknown): ChatRetryNotice | null {
  if (!isRecord(data) || typeof data.retry !== 'number') return null
  return {
    attempt: data.retry,
    max: typeof data.maxRetries === 'number' ? data.maxRetries : null,
  }
}

/** 一个回合仍只有一枚过程组；过程条目一提交就落行，让工具卡在回合结束前可见。 */
function materializeProcess(
  rows: readonly ChatRow[],
  turn: TurnBuffer,
  items: readonly ProcessItem[],
): readonly ChatRow[] {
  if (items.length === 0) return rows
  const id = `p-${turn.id}`
  const index = rows.findIndex(row => row.kind === 'process' && row.id === id)
  if (index === -1) return [...rows, { kind: 'process', id, items }]
  const next = [...rows]
  next[index] = { kind: 'process', id, items }
  return next
}

function flushTurn(state: ChatState): ChatState {
  const turn = state.turn
  if (turn === null) return state
  const rows: ChatRow[] = [...state.rows]
  const materialized = rows.some(row => row.kind === 'process' && row.id === `p-${turn.id}`)
  if (turn.items.length > 0 && !materialized) rows.push({ kind: 'process', id: `p-${turn.id}`, items: turn.items })
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
  const nextTurn: TurnBuffer = { ...started, items, texts }
  return { ...base, rows: materializeProcess(base.rows, started, items), turn: nextTurn }
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
      return { ...pushUser(state, event.data.content, event.seq), retry: null }
    }
    case 'assistant/message':
      return { ...collectAssistant(state, event.data, event.seq), retry: null }
    case 'tool/result':
      return collectToolResult(state, event.data)
    case 'llm/retry': {
      const retry = retryOf(event.data)
      // 重试只说明这次调用已失败、下一轮还没开始；最终失败等 turn/end 报。
      return retry === null ? state : { ...state, retry, failure: null }
    }
    case 'llm/retry-started':
      return state
    case 'turn/start':
      return { ...state, retry: null, failure: null }
    case 'turn/end': {
      const flushed = flushTurn(state)
      const reason = isRecord(event.data) ? event.data.reason : undefined
      if (isRecord(reason) && reason.kind === 'error') {
        return { ...flushed, retry: null, failure: failureOf(reason.error) }
      }
      return { ...flushed, retry: null, failure: null }
    }
    case 'session/title': {
      if (!isRecord(event.data) || typeof event.data.title !== 'string' || event.data.title.trim() === '') return state
      return { ...state, title: event.data.title }
    }
    default:
      return state
  }
}

/** 已提交 attempt 的序号交接给下一段尝试：对应事件到达时仍按「提交即落行」处理。 */
function holdSettle(state: ChatState, attempt: ActiveAttempt): readonly number[] {
  return attempt.settleSeq === undefined ? state.settledSeqs : [...state.settledSeqs, attempt.settleSeq]
}

/** 折叠一个 durable 事件；seq 不连续时标记重开，不把缺口画成完整历史。 */
function appendEvent(state: ChatState, record: HistoryRecord): ChatState {
  const seq = record.event.seq
  if (seq < state.nextSeq) return state
  if (seq > state.nextSeq) return { ...state, rebaseline: state.rebaseline + 1 }
  if (replacesSurface(record)) return { ...state, rebaseline: state.rebaseline + 1 }
  const applied = applyEvent(state, record)
  const settledByAttempt = applied.attempt !== null && applied.attempt.settleSeq === seq
  const settledByHistory = applied.settledSeqs.includes(seq)
  // 提交即落行：先画已提交正文，再清掉流式草稿，避免中间闪一帧空白。
  const next = settledByAttempt || settledByHistory ? flushTurn(applied) : applied
  return {
    ...next,
    nextSeq: seq + 1,
    ...(settledByAttempt ? { attempt: null, liveText: '', liveReasoning: '' } : {}),
    ...(settledByHistory
      ? { settledSeqs: applied.settledSeqs.filter(value => value !== seq) }
      : {}),
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
        liveReasoning: baselineReasoning(action.baseline),
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
    case 'assistant-start': {
      const current = state.attempt
      // 帧序号只增不减：迟到的旧 start 不能把已经走到后面的一段顶回去。
      if (current !== null && action.revision < current.revision) return state
      // 同一 attempt 的重播（重连后从头再来）就地重置序号；换代 attempt 才带走待结算序号。
      const sameAttempt = current !== null && current.attemptId === action.attemptId
      return {
        ...state,
        settledSeqs: current !== null && !sameAttempt
          ? holdSettle(state, current)
          : state.settledSeqs,
        attempt: { attemptId: action.attemptId, revision: action.revision, nextIndex: 0 },
        liveText: '',
        liveReasoning: '',
        streamError: null,
        retry: null,
        failure: null,
      }
    }
    case 'assistant-chunk': {
      const attempt = state.attempt
      // 没有活动尝试、帧属于旧尝试、或帧序号没有前进：直接丢弃，不触发全局重开。
      if (attempt === null || attempt.attemptId !== action.attemptId
        || action.revision <= attempt.revision) return state
      if (attempt.nextIndex !== action.index) {
        // 同一尝试里出现块序号缺口：只请求一次重开；attempt 清空后后续旧帧都会被丢弃。
        return { ...state, attempt: null, rebaseline: state.rebaseline + 1 }
      }
      const chunk = action.chunk
      const text = isRecord(chunk) && chunk.type === 'text-delta'
        && typeof chunk.text === 'string' ? chunk.text : ''
      const reasoning = isRecord(chunk) && chunk.type === 'reasoning-delta'
        && typeof chunk.text === 'string' ? chunk.text : ''
      return {
        ...state,
        attempt: { ...attempt, revision: action.revision, nextIndex: attempt.nextIndex + 1 },
        liveText: state.liveText + text,
        // 正文一开始到达就不再显示思考态；思考缓冲也只留到那一刻。
        liveReasoning: text === '' ? state.liveReasoning + reasoning : '',
      }
    }
    case 'assistant-end': {
      const attempt = state.attempt
      if (attempt === null || attempt.attemptId !== action.attemptId
        || action.revision < attempt.revision) return state
      const outcome = action.outcome
      if (!isRecord(outcome) || outcome.kind !== 'committed') {
        return { ...state, attempt: null, liveText: '', liveReasoning: '' }
      }
      const seq = typeof outcome.seq === 'number' ? outcome.seq : undefined
      if (seq === undefined || seq < state.nextSeq) return { ...state, attempt: null, liveText: '', liveReasoning: '' }
      return { ...state, attempt: { ...attempt, settleSeq: seq } }
    }
    case 'stream-error':
      // 正文已提交的行不受影响；流式草稿也先留着，重开后的快照才能给出权威版本。
      return { ...state, streamError: action.message, attempt: null, liveReasoning: '' }
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

/** 列表载荷里的 preset：宿主线形在 `projections.values`，旧载荷在顶层。 */
function agentPresetOf(value: Record<string, unknown>): string | undefined {
  if (isRecord(value.projections) && isRecord(value.projections.values)
    && typeof value.projections.values.agentPreset === 'string') {
    return value.projections.values.agentPreset
  }
  return typeof value.agentPreset === 'string' ? value.agentPreset : undefined
}

/** 列表载荷里的标题：宿主线形在 `projections.values.title`，旧载荷在顶层。 */
function titleOf(value: Record<string, unknown>): string | undefined {
  if (isRecord(value.projections) && isRecord(value.projections.values)
    && typeof value.projections.values.title === 'string') {
    const trimmed = value.projections.values.title.trim()
    if (trimmed !== '') return trimmed
  }
  if (typeof value.title === 'string') {
    const trimmed = value.title.trim()
    if (trimmed !== '') return trimmed
  }
  return undefined
}

/** 把 `session/list` 与事件载荷裁成列表项。 */
export function summaryOf(value: unknown): SessionSummary | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.updatedAt !== 'number') return undefined
  const agentPreset = agentPresetOf(value)
  const title = titleOf(value)
  return {
    sessionId: value.sessionId,
    updatedAt: value.updatedAt,
    running: value.running === true,
    blank: value.blank === true,
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
    ...(typeof value.parentSessionId === 'string' ? { parentSessionId: value.parentSessionId } : {}),
    ...(typeof value.origin === 'string' ? { origin: value.origin } : {}),
    ...(agentPreset === undefined ? {} : { agentPreset }),
    ...(title === undefined ? {} : { title }),
  }
}
