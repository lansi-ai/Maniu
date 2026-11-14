/** 会话控制流：按会话累积投影值，断线后重开并接受新基线。 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** 一个投影键的最新值与其水位。 */
export interface SessionProjectionEntry {
  readonly value: unknown
  readonly seq: number
}

/** 一个会话的投影表。 */
export type SessionProjectionTable = Readonly<Record<string, SessionProjectionEntry>>

/** 控制流状态。 */
export interface SessionControlState {
  readonly bySession: Readonly<Record<string, SessionProjectionTable>>
  readonly error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tableOf(values: unknown, seq: number): SessionProjectionTable {
  if (!isRecord(values)) return {}
  const table: Record<string, SessionProjectionEntry> = {}
  for (const [key, value] of Object.entries(values)) table[key] = { value, seq }
  return table
}

function baselineOf(value: unknown): Record<string, SessionProjectionTable> {
  if (!isRecord(value) || !isRecord(value.projections)) return {}
  const bySession: Record<string, SessionProjectionTable> = {}
  for (const [sessionId, block] of Object.entries(value.projections)) {
    if (!isRecord(block)) continue
    const seq = typeof block.asOfSeq === 'number' ? block.asOfSeq : 0
    bySession[sessionId] = tableOf(block.values, seq)
  }
  return bySession
}

/**
 * 订阅宿主的会话控制流。
 * @param enabled - 宿主就绪后为 true。
 * @returns 按会话的投影与最后一次连接错误。
 */
export function useSessionControl(enabled: boolean): SessionControlState {
  const [bySession, setBySession] = useState<Record<string, SessionProjectionTable>>({})
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const streamRef = useRef<string | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reopen = useCallback(() => {
    if (retryRef.current !== null) return
    retryRef.current = setTimeout(() => {
      retryRef.current = null
      setGeneration(current => current + 1)
    }, 750)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const stream = window.lcoder.openStream('session', 'control', {})
    void stream.then((streamId) => {
      if (disposed) {
        void window.lcoder.cancelStream(streamId)
        return
      }
      streamRef.current = streamId
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      reopen()
    })
    const off = window.lcoder.onStreamFrame((streamId, frame) => {
      if (streamId !== streamRef.current) return
      if (frame.kind === 'error') {
        setError(`${frame.error.code}: ${frame.error.message}`)
        reopen()
        return
      }
      if (frame.kind === 'end') {
        reopen()
        return
      }
      if (!isRecord(frame.value)) return
      const value = frame.value
      if (value.type === 'baseline') {
        setBySession(baselineOf(value.value))
        setError(null)
        return
      }
      if (value.type === 'projection' && typeof value.sessionId === 'string' && typeof value.key === 'string'
        && typeof value.seq === 'number') {
        const sessionId = value.sessionId
        const key = value.key
        const entry: SessionProjectionEntry = { value: value.value, seq: value.seq }
        setBySession(current => ({
          ...current,
          [sessionId]: { ...(current[sessionId] ?? {}), [key]: entry },
        }))
      }
    })
    return () => {
      disposed = true
      off()
      if (retryRef.current !== null) {
        clearTimeout(retryRef.current)
        retryRef.current = null
      }
      const streamId = streamRef.current
      streamRef.current = null
      if (streamId !== null) void window.lcoder.cancelStream(streamId)
    }
  }, [enabled, generation, reopen])

  return { bySession, error }
}
