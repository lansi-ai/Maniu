/** 后台操作浮卡的实时过程订阅：被动跟随 session/follow（activate: false），折叠思考、正文与工具调用进度。 */

import { useEffect, useRef, useState } from 'react'
import { resultSummary } from '../store.ts'

/** 实时过程阶段。 */
export type OpLivePhase =
  | 'connecting'
  | 'thinking'
  | 'streaming'
  | 'tool-streaming'
  | 'tool-running'
  | 'retrying'
  | 'auto-continuing'
  | 'idle'

/** 回合结束原因；用于尽早识别超限或报错，避免空等到超时。 */
export type OpTurnEnd =
  | { readonly kind: 'completed' }
  | { readonly kind: 'max-tokens' }
  | { readonly kind: 'error'; readonly message: string }

/** 单条后台会话的实时进度快照。 */
export interface OpLiveFeed {
  readonly phase: OpLivePhase
  /** 最近一步的编号（从 1 开始，未收到时为 0）。 */
  readonly step: number
  /** 当前正在流式写入或执行中的工具名。 */
  readonly toolName?: string | undefined
  /** 当前工具调用的简短参数摘要。 */
  readonly toolDetail?: string | undefined
  /** 流式生成工具参数时累计输出的字符数。 */
  readonly toolChars?: number | undefined
  /** 模型重试序号（从 1 开始）。 */
  readonly retryAttempt?: number | undefined
  /** 模型重试上限；无上限时为 null。 */
  readonly retryMax?: number | null | undefined
  /** 最新输出片段（已截断末尾，供浮卡实时展示）。 */
  readonly snippet: string
  /** 最近一次工具返回结果的简短摘要。 */
  readonly lastToolNote?: string | undefined
  /** 最近一次收到任意有效帧或事件的本机时间戳（毫秒）。 */
  readonly lastActivityAt: number
  /** 最近一次回合结束原因；新回合或新步骤开始时清空。 */
  readonly turnEnd?: OpTurnEnd | undefined
  /** 内部标记：新步骤已开始、下一段增量将覆盖旧片段，避免步骤切换瞬间闪白。 */
  readonly freshStep?: boolean | undefined
}

const SNIPPET_LIMIT = 360
const FLUSH_INTERVAL_MS = 120

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampTail(text: string, limit = SNIPPET_LIMIT): string {
  const trimmed = text.replace(/\r\n/gu, '\n')
  if (trimmed.length <= limit) return trimmed
  return `…${trimmed.slice(trimmed.length - (limit - 1))}`
}

/** 从工具参数 JSON 里挑出最具可读性的短标签，避免把整段 HTML 塞进状态栏。 */
function toolDetailOf(rawArgs: unknown): string | undefined {
  if (typeof rawArgs !== 'string' || rawArgs.trim() === '') return undefined
  try {
    const parsed: unknown = JSON.parse(rawArgs)
    if (isRecord(parsed)) {
      for (const key of ['requirement', 'path', 'id', 'task_id', 'keyword', 'module', 'domPath', 'title']) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim() !== '') {
          const clean = value.trim()
          return clean.length > 64 ? `${clean.slice(0, 64)}…` : clean
        }
      }
    }
  } catch {
    // 非 JSON 参数（或流式截断）时退回纯文本短摘。
  }
  const singleLine = rawArgs.replace(/\s+/gu, ' ').trim()
  if (singleLine === '' || singleLine === '{}') return undefined
  return singleLine.length > 64 ? `${singleLine.slice(0, 64)}…` : singleLine
}

function errorMessageOf(error: unknown): string {
  if (!isRecord(error)) return ''
  const raw = typeof error.message === 'string' ? error.message.trim() : ''
  if (raw === '') return ''
  const brace = raw.indexOf('{')
  if (brace >= 0) {
    try {
      const parsed: unknown = JSON.parse(raw.slice(brace))
      if (isRecord(parsed) && typeof parsed.message === 'string' && parsed.message.trim() !== '') {
        return parsed.message.trim()
      }
    } catch {
      // 解析失败时保留原始错误文本。
    }
  }
  return raw
}

/** 创建初始实时进度状态。 */
export function emptyOpLiveFeed(now = Date.now()): OpLiveFeed {
  return {
    phase: 'connecting',
    step: 0,
    snippet: '',
    lastActivityAt: now,
  }
}

function applyDurableEvent(state: OpLiveFeed, event: Record<string, unknown>, now: number): OpLiveFeed {
  const type = typeof event.type === 'string' ? event.type : ''
  const data = isRecord(event.data) ? event.data : undefined
  switch (type) {
    case 'turn/start':
      return {
        ...state,
        phase: 'thinking',
        turnEnd: undefined,
        freshStep: true,
        lastActivityAt: now,
      }
    case 'user/message': {
      const source = data !== undefined && isRecord(data.source) ? data.source : undefined
      if (source?.kind === 'maniu-max-tokens-recovery') {
        return {
          ...state,
          phase: 'auto-continuing',
          turnEnd: undefined,
          freshStep: true,
          lastActivityAt: now,
        }
      }
      return state
    }
    case 'step/start': {
      const step = data !== undefined && typeof data.step === 'number' ? data.step : state.step
      return {
        ...state,
        step,
        phase: state.phase === 'connecting' || state.phase === 'idle' ? 'thinking' : state.phase,
        turnEnd: undefined,
        freshStep: true,
        lastActivityAt: now,
      }
    }
    case 'tool/call': {
      const name = data !== undefined && typeof data.name === 'string' ? data.name : state.toolName
      const detail = data === undefined ? undefined : toolDetailOf(data.arguments)
      return {
        ...state,
        phase: 'tool-running',
        ...(name === undefined ? {} : { toolName: name }),
        ...(detail === undefined ? { toolDetail: undefined } : { toolDetail: detail }),
        toolChars: undefined,
        turnEnd: undefined,
        lastActivityAt: now,
      }
    }
    case 'tool/result': {
      const message = data !== undefined && isRecord(data.message) ? data.message : undefined
      const summary = message === undefined ? '' : resultSummary(message.content)
      const isError = message?.isError === true
      const note = summary === '' ? state.lastToolNote : (isError ? `⚠ ${summary}` : summary)
      return {
        ...state,
        ...(note === undefined ? {} : { lastToolNote: note }),
        lastActivityAt: now,
      }
    }
    case 'assistant/message': {
      const message = data !== undefined && isRecord(data.message) ? data.message : undefined
      const content = message !== undefined && Array.isArray(message.content) ? message.content : []
      let text = ''
      let reasoning = ''
      let toolName = state.toolName
      for (const block of content) {
        if (!isRecord(block)) continue
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          text = block.text.trim()
        } else if (block.type === 'reasoning' && typeof block.text === 'string' && block.text.trim() !== '') {
          reasoning = block.text.trim()
        } else if (block.type === 'tool-call' && typeof block.name === 'string' && block.name !== '') {
          toolName = block.name
        }
      }
      const nextSnippet = text !== ''
        ? clampTail(text)
        : reasoning !== ''
          ? clampTail(reasoning)
          : state.snippet
      return {
        ...state,
        ...(toolName === undefined ? {} : { toolName }),
        snippet: nextSnippet,
        freshStep: true,
        lastActivityAt: now,
      }
    }
    case 'llm/retry': {
      const retry = data !== undefined && typeof data.retry === 'number' ? data.retry : 1
      const max = data !== undefined && typeof data.maxRetries === 'number' ? data.maxRetries : null
      return {
        ...state,
        phase: 'retrying',
        retryAttempt: retry,
        retryMax: max,
        lastActivityAt: now,
      }
    }
    case 'turn/end': {
      const reason = data !== undefined && isRecord(data.reason) ? data.reason : undefined
      const kind = reason !== undefined && typeof reason.kind === 'string' ? reason.kind : ''
      const turnEnd: OpTurnEnd = kind === 'max-tokens'
        ? { kind: 'max-tokens' }
        : kind === 'error'
          ? { kind: 'error', message: errorMessageOf(reason?.error) }
          : { kind: 'completed' }
      return {
        ...state,
        phase: 'idle',
        turnEnd,
        lastActivityAt: now,
      }
    }
    default:
      return state
  }
}

function applyChunk(state: OpLiveFeed, chunk: unknown, now: number): OpLiveFeed {
  if (!isRecord(chunk) || typeof chunk.type !== 'string') return state
  if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
    const base = state.freshStep === true || state.phase !== 'thinking' ? '' : state.snippet
    return {
      ...state,
      phase: 'thinking',
      snippet: clampTail(base + chunk.text),
      freshStep: false,
      turnEnd: undefined,
      lastActivityAt: now,
    }
  }
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
    const base = state.freshStep === true || state.phase !== 'streaming' ? '' : state.snippet
    return {
      ...state,
      phase: 'streaming',
      snippet: clampTail(base + chunk.text),
      freshStep: false,
      turnEnd: undefined,
      lastActivityAt: now,
    }
  }
  if (chunk.type === 'tool-call-delta') {
    const nextName = typeof chunk.name === 'string' && chunk.name !== '' ? chunk.name : state.toolName
    const delta = typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
    const prevChars = state.phase === 'tool-streaming' ? (state.toolChars ?? 0) : 0
    return {
      ...state,
      phase: 'tool-streaming',
      ...(nextName === undefined ? {} : { toolName: nextName }),
      toolChars: prevChars + delta.length,
      freshStep: false,
      turnEnd: undefined,
      lastActivityAt: now,
    }
  }
  return state
}

function applyBaselineStream(state: OpLiveFeed, baseline: unknown, now: number): OpLiveFeed {
  if (!isRecord(baseline) || !isRecord(baseline.activeAttempt)) return state
  const attempt = baseline.activeAttempt
  let next: OpLiveFeed = {
    ...state,
    step: typeof attempt.step === 'number' ? attempt.step : state.step,
    freshStep: true,
    turnEnd: undefined,
  }
  const stream = Array.isArray(attempt.stream) ? attempt.stream : []
  for (const record of stream) {
    if (!isRecord(record) || typeof record.type !== 'string') continue
    if (record.type === 'reasoning-chunks' && Array.isArray(record.texts)) {
      const joined = record.texts.filter((item): item is string => typeof item === 'string').join('')
      if (joined !== '') next = applyChunk(next, { type: 'reasoning-delta', text: joined }, now)
    } else if (record.type === 'text-chunks' && Array.isArray(record.texts)) {
      const joined = record.texts.filter((item): item is string => typeof item === 'string').join('')
      if (joined !== '') next = applyChunk(next, { type: 'text-delta', text: joined }, now)
    } else if (record.type === 'tool-call-chunks') {
      const name = typeof record.name === 'string' ? record.name : undefined
      const deltas = Array.isArray(record.argumentsDeltas)
        ? record.argumentsDeltas.filter((item): item is string => typeof item === 'string').join('')
        : ''
      next = applyChunk(next, {
        type: 'tool-call-delta',
        ...(name === undefined ? {} : { name }),
        argumentsDelta: deltas,
      }, now)
    } else if (record.type === 'chunk') {
      next = applyChunk(next, record.chunk, now)
    }
  }
  return next
}

/**
 * 把 `session/follow` 的单条流帧折叠成浮卡实时进度快照。
 * @param state - 当前进度快照。
 * @param value - 宿主流帧 `frame.value`。
 * @param now - 当前时间戳（毫秒），测试可注入。
 * @returns 折叠后的新进度快照。
 */
export function foldOpLiveFrame(state: OpLiveFeed, value: unknown, now = Date.now()): OpLiveFeed {
  if (!isRecord(value) || typeof value.type !== 'string') return state
  if (value.type === 'snapshot') {
    let next: OpLiveFeed = { ...emptyOpLiveFeed(now), snippet: state.snippet }
    const records = Array.isArray(value.records) ? value.records : []
    for (const record of records) {
      if (isRecord(record) && record.type === 'event' && isRecord(record.event)) {
        next = applyDurableEvent(next, record.event, now)
      }
    }
    return applyBaselineStream(next, value.assistantStream, now)
  }
  if (value.type === 'event' && isRecord(value.event)) {
    return applyDurableEvent(state, value.event, now)
  }
  if (value.type === 'assistant-stream' && isRecord(value.frame)) {
    const frame = value.frame
    if (frame.type === 'start') {
      return {
        ...state,
        step: typeof frame.step === 'number' ? frame.step : state.step,
        phase: 'thinking',
        toolName: undefined,
        toolDetail: undefined,
        toolChars: undefined,
        freshStep: true,
        turnEnd: undefined,
        lastActivityAt: now,
      }
    }
    if (frame.type === 'chunk') {
      return applyChunk(state, frame.chunk, now)
    }
    if (frame.type === 'end') {
      return { ...state, lastActivityAt: now }
    }
  }
  return state
}

interface StreamEntry {
  streamId: string | null
  cancelled: boolean
}

function hasFollowApi(): boolean {
  return typeof window !== 'undefined'
    && typeof window.lcoder !== 'undefined'
    && typeof window.lcoder.openStream === 'function'
    && typeof window.lcoder.cancelStream === 'function'
    && typeof window.lcoder.onStreamFrame === 'function'
}

/**
 * 为一组后台在途会话订阅被动 `session/follow` 流，按节流批量更新实时过程快照。
 * @param sessionIds - 当前需要跟踪的会话标识集合。
 * @returns 以 sessionId 为键的实时过程快照表。
 */
export function useOpLiveFeeds(sessionIds: readonly string[]): Readonly<Record<string, OpLiveFeed>> {
  const [feeds, setFeeds] = useState<Readonly<Record<string, OpLiveFeed>>>({})
  const streamsRef = useRef<Map<string, StreamEntry>>(new Map())
  const streamToSessionRef = useRef<Map<string, string>>(new Map())
  const latestRef = useRef<Record<string, OpLiveFeed>>({})
  const dirtyRef = useRef(false)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const uniqueKey = [...new Set(sessionIds)].sort().join('\u0000')

  const scheduleFlush = (): void => {
    dirtyRef.current = true
    if (flushTimerRef.current !== null) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setFeeds({ ...latestRef.current })
    }, FLUSH_INTERVAL_MS)
  }

  useEffect(() => {
    if (!hasFollowApi()) return
    const off = window.lcoder.onStreamFrame((streamId, frame) => {
      const sessionId = streamToSessionRef.current.get(streamId)
      if (sessionId === undefined) return
      if (frame.kind !== 'item') return
      const current = latestRef.current[sessionId] ?? emptyOpLiveFeed()
      const next = foldOpLiveFrame(current, frame.value)
      if (next === current) return
      latestRef.current = { ...latestRef.current, [sessionId]: next }
      scheduleFlush()
    })
    return () => {
      off()
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      for (const entry of streamsRef.current.values()) {
        entry.cancelled = true
        if (entry.streamId !== null) void window.lcoder.cancelStream(entry.streamId)
      }
      streamsRef.current.clear()
      streamToSessionRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!hasFollowApi()) return
    const desired = new Set(uniqueKey === '' ? [] : uniqueKey.split('\u0000'))
    for (const [sessionId, entry] of [...streamsRef.current.entries()]) {
      if (desired.has(sessionId)) continue
      entry.cancelled = true
      if (entry.streamId !== null) {
        streamToSessionRef.current.delete(entry.streamId)
        void window.lcoder.cancelStream(entry.streamId)
      }
      streamsRef.current.delete(sessionId)
    }
    for (const sessionId of desired) {
      if (streamsRef.current.has(sessionId)) continue
      const entry: StreamEntry = { streamId: null, cancelled: false }
      streamsRef.current.set(sessionId, entry)
      if (latestRef.current[sessionId] === undefined) {
        latestRef.current = { ...latestRef.current, [sessionId]: emptyOpLiveFeed() }
        scheduleFlush()
      }
      void window.lcoder.openStream('session', 'follow', {
        request: {
          address: { kind: 'session', sessionId },
          activate: false,
          assistantStream: true,
          maxMessages: 12,
        },
      }).then((streamId) => {
        if (entry.cancelled) {
          void window.lcoder.cancelStream(streamId)
          return
        }
        entry.streamId = streamId
        streamToSessionRef.current.set(streamId, sessionId)
      }).catch(() => {
        // 被动过程流打开失败时静默降级，不影响主轮询判定。
      })
    }
  }, [uniqueKey])

  return feeds
}
