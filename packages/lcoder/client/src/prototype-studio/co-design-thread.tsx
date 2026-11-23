/**
 * 协作流：在当前 maniu-prototype 会话的只读镜像上跟踪回合进度，
 * 并在流内回答提问。不打开全局任务浮卡，也不改会话归属。
 */

import { useEffect, useReducer, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { HostEvent } from '@maniu/desktop/contract'
import type { EventOutcome } from '../contract.ts'
import { interactionOf, pendingForSession, type PendingInteraction } from '../chat/pending.ts'
import type { Translate } from '../locale.ts'
import { QuestionCard, type AnswerResult } from '../shell/pending-cards.tsx'
import { actionOfFrame, chatReducer, emptyChat, type ChatRow } from '../store.ts'
import type { StudioBridge } from './bridge.ts'

/** 协作流属性。 */
export interface CoDesignThreadProps {
  readonly t: Translate
  readonly bridge?: StudioBridge | undefined
  readonly sessionId: string | null
  /** 一个回合结束后通知上层刷新暂存与画布。 */
  readonly onStageComplete: () => void
  /** 回合运行态上报；上层据此锁住发送入口。 */
  readonly onRunningChange?: (running: boolean) => void | undefined
}

/**
 * 取最近一条助手正文的摘要；只留一行，避免把整段 HTML 源码刷进流里。
 * @param rows - 折叠后的聊天行。
 * @returns 摘要文本；没有正文时为空串。
 */
export function briefOf(rows: readonly ChatRow[]): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row === undefined || row.kind !== 'assistant') continue
    const text = row.text.replace(/\s+/gu, ' ').trim()
    if (text === '') continue
    return text.length > 160 ? `${text.slice(0, 160)}…` : text
  }
  return ''
}

/**
 * 画协作流：运行进度、完成摘要与会话内提问卡。
 * @param props - 词典、宿主桥、会话号与回合完成回调。
 * @returns 协作流。
 */
export function CoDesignThread(props: CoDesignThreadProps): JSX.Element {
  const { t, bridge, sessionId, onStageComplete } = props
  const [chat, dispatch] = useReducer(chatReducer, emptyChat)
  const [pending, setPending] = useState<readonly PendingInteraction[]>([])
  const [eventRunning, setEventRunning] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [brief, setBrief] = useState('')
  const streamRef = useRef<string | null>(null)
  const startedRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const briefRef = useRef('')
  const stageCompleteRef = useRef(onStageComplete)
  stageCompleteRef.current = onStageComplete
  const runningChangeRef = useRef(props.onRunningChange)
  runningChangeRef.current = props.onRunningChange

  const running = chat.attempt !== null || eventRunning

  useEffect(() => {
    const off = bridge?.onStreamFrame?.((streamId, frame) => {
      if (streamId !== streamRef.current) return
      if (frame.kind !== 'item') return
      const action = actionOfFrame(frame.value)
      if (action !== undefined) dispatch(action)
    })
    return () => { off?.() }
  }, [bridge])

  useEffect(() => {
    if (sessionId === null || bridge?.openStream === undefined) return
    let disposed = false
    const previous = streamRef.current
    if (previous !== null) void bridge.cancelStream?.(previous)
    void Promise.resolve(bridge.openStream('session', 'follow', {
      request: {
        address: { kind: 'session', sessionId },
        activate: false,
        assistantStream: true,
        maxMessages: 20,
      },
    })).then((streamId) => {
      if (!disposed) streamRef.current = streamId
    }).catch(() => undefined)
    return () => {
      disposed = true
      const stream = streamRef.current
      streamRef.current = null
      if (stream !== null) void bridge.cancelStream?.(stream)
    }
  }, [bridge, sessionId])

  useEffect(() => {
    const off = bridge?.onEvent?.((event: HostEvent) => {
      const first = event.args[0]
      if (event.name === 'api-session/status' && first === sessionId && typeof event.args[1] === 'boolean') {
        setEventRunning(event.args[1])
      }
    })
    return () => { off?.() }
  }, [bridge, sessionId])

  useEffect(() => {
    const off = bridge?.onWaterfall?.((event) => {
      const interaction = interactionOf(event.name, event.clientId, event.eventId, event.request, event.agentId)
      if (interaction === undefined) return
      setPending((current) => {
        if (current.some(item => item.id === interaction.id)) {
          return current.map(item => item.id === interaction.id ? interaction : item)
        }
        return [...current, interaction]
      })
    })
    return () => { off?.() }
  }, [bridge])

  useEffect(() => {
    const off = bridge?.onWaterfallCancel?.((event) => {
      setPending(current => current.filter(item => item.eventId !== event.eventId))
    })
    return () => { off?.() }
  }, [bridge])

  const nextBrief = briefOf(chat.rows)

  useEffect(() => {
    if (nextBrief !== '') briefRef.current = nextBrief
  }, [nextBrief])

  useEffect(() => {
    if (running && !runningRef.current) {
      startedRef.current = Date.now()
      setCollapsed(false)
    }
    runningRef.current = running
    if (!running && startedRef.current !== null) {
      const start = startedRef.current
      startedRef.current = null
      setSeconds(Math.max(0, Math.round((Date.now() - start) / 1000)))
      setBrief(briefRef.current)
      setCollapsed(true)
      stageCompleteRef.current()
    }
  }, [running])

  useEffect(() => {
    runningChangeRef.current?.(running)
  }, [running])

  const mine = sessionId === null ? [] : pendingForSession(pending, sessionId)
  const questions = mine.filter(item => item.kind === 'question')

  const answer = async (interaction: PendingInteraction, outcome: EventOutcome): Promise<AnswerResult> => {
    if (bridge?.eventResult === undefined) return { ok: false, message: t('studio.answerUnavailable') }
    try {
      await bridge.eventResult(interaction.clientId, interaction.eventId, outcome)
      setPending(current => current.filter(item => item.id !== interaction.id))
      return { ok: true }
    } catch (cause: unknown) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  return (
    <section className="studio-thread" data-testid="studio-thread">
      {questions.map(interaction => (
        <QuestionCard
          key={interaction.id}
          t={t}
          interaction={interaction}
          onAnswer={answer}
          value={undefined}
          onChange={() => undefined}
        />
      ))}
      {running
        ? <p className="studio-turn-running" data-testid="studio-turn-running">{t('studio.turnRunning')}</p>
        : seconds > 0
          ? (
            <div className="studio-turn-done" data-testid="studio-turn-done">
              <button type="button" className="studio-turn-collapsed" data-testid="studio-turn-collapsed" aria-expanded={!collapsed} onClick={() => { setCollapsed(current => !current) }}>
                {t('studio.turnDone', { seconds })}
              </button>
              {!collapsed && <p className="studio-turn-brief" data-testid="studio-turn-brief">{brief}</p>}
            </div>
          )
          : null}
    </section>
  )
}
