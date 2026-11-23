/**
 * 协作流：在当前 maniu-prototype 会话的只读镜像上跟踪回合进度，
 * 并在流内回答提问。不打开全局任务浮卡，也不改会话归属。
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { HostEvent, StreamFrame } from '@maniu/desktop/contract'
import type { EventOutcome } from '../contract.ts'
import { interactionOf, pendingForSession, type PendingInteraction, type QuestionDrafts } from '../chat/pending.ts'
import type { Translate } from '../locale.ts'
import { QuestionCard, type AnswerResult } from '../shell/pending-cards.tsx'
import { emptyOpLiveFeed, foldOpLiveFrame, type OpLiveFeed } from '../shell/op-live-feed.ts'
import { actionOfFrame, chatReducer, emptyChat, type ChatRow } from '../store.ts'
import type { StudioAnchorDraft } from './anchor-composer.tsx'
import type { StudioBridge } from './bridge.ts'

/** 等待期探测暂存与运行态的间隔；事件通道漏帧时由它兜底结束等待。 */
export const TURN_PROBE_INTERVAL_MS = 2000

/** 流标识比首批帧晚到时先缓存的帧数上限；超出即丢弃最旧的，只影响已过期进度。 */
const MAX_BUFFERED_FRAMES = 400

/** 单行提示的字符上限。 */
const ACTIVITY_LIMIT = 140

/** 本轮已发出的一轮意见；发出去就先回显，不等宿主回执。 */
export interface StudioTurnEcho {
  readonly instruction: string
  readonly anchors: readonly StudioAnchorDraft[]
  /** 发出这一轮的本机时间戳，用于和暂存 createdAt、回合结束帧对齐。 */
  readonly sentAt: number
}

/** 一轮已经收束的协作轮次：用户说了什么、助手回了什么、耗时多久。 */
export interface StudioSettledRound {
  readonly instruction: string
  readonly anchors: readonly StudioAnchorDraft[]
  /** 与 {@link StudioTurnEcho.sentAt} 同值，作历史列表的键。 */
  readonly sentAt: number
  readonly seconds: number
  /** 助手正文摘要；模型没有文字回复时为空串。 */
  readonly reply: string
}

/** 协作流属性。 */
export interface CoDesignThreadProps {
  readonly t: Translate
  readonly bridge?: StudioBridge | undefined
  readonly sessionId: string | null
  /** 上层为这个会话打开的跟随流；缺省时只靠事件与探测判定进度。 */
  readonly streamId?: string | null | undefined
  /** 最近发出的一轮意见；没有就是首次进入的空态。 */
  readonly turn?: StudioTurnEcho | undefined
  /** 一个回合结束后通知上层刷新暂存与画布。 */
  readonly onStageComplete: () => void
  /** 回合运行态上报；上层据此锁住发送入口。 */
  readonly onRunningChange?: (running: boolean) => void | undefined
  /**
   * 等待期兜底探测：暂存已比本轮新或会话已停止时返回 true。
   * 缺省时只靠运行态回执与回合结束帧。
   */
  readonly onProbeComplete?: ((sentAt: number) => Promise<boolean>) | undefined
  /** 最新一轮收束后要显示的暂存改动卡；卡片跟在该轮回复后面。 */
  readonly changeCard?: ReactNode | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 去掉 ``` 代码块（多半是整段 HTML），只留能读的人话。
 * @param text - 原始正文或思考摘要。
 * @returns 折叠代码块后的文本。
 */
export function humanTextOf(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

/**
 * 压成一行并按上限截断，供单行进度提示使用。
 * @param text - 原始文本。
 * @param limit - 字符上限。
 * @returns 单行短文本。
 */
export function oneLineOf(text: string, limit = ACTIVITY_LIMIT): string {
  const compact = text.replace(/\s+/gu, ' ').trim()
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact
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
    const text = oneLineOf(humanTextOf(row.text))
    if (text === '') continue
    return text
  }
  return ''
}

/**
 * 运行期的一行动作提示：工具步骤优先，其次是思考摘要。
 * @param feed - 跟随流折叠出的实时过程快照。
 * @param t - 词典。
 * @returns 可直接渲染的一行提示；没有可报告的动作时为空串。
 */
export function activityOf(feed: OpLiveFeed, t: Translate): string {
  const runningTool = feed.phase === 'tool-running' || feed.phase === 'tool-streaming'
  if (runningTool && feed.toolName !== undefined && feed.toolName !== '') {
    const tool = feed.toolDetail === undefined || feed.toolDetail === ''
      ? feed.toolName
      : `${feed.toolName} · ${feed.toolDetail}`
    return t('studio.turnTool', { tool })
  }
  if (feed.phase === 'thinking') {
    const text = oneLineOf(humanTextOf(feed.snippet))
    if (text !== '') return t('studio.turnThinking', { text })
  }
  return ''
}

/** 助手正在流式写入的人话正文；代码块不展示。 */
function streamingTextOf(feed: OpLiveFeed): string {
  if (feed.phase !== 'streaming') return ''
  return humanTextOf(feed.snippet)
}

/** 一条流里是否是活着的回合事件（不是开场快照里的历史回合）。 */
function isLiveTurnEvent(value: unknown, type: 'turn/start' | 'turn/end'): boolean {
  return isRecord(value)
    && value.type === 'event'
    && isRecord(value.event)
    && value.event.type === type
}

/**
 * 画协作流：运行进度、完成摘要与会话内提问卡。
 * @param props - 词典、宿主桥、会话号、跟随流与回合完成回调。
 * @returns 协作流。
 */
export function CoDesignThread(props: CoDesignThreadProps): JSX.Element {
  const { t, bridge, sessionId, streamId, onStageComplete, turn } = props
  const [chat, dispatch] = useReducer(chatReducer, emptyChat)
  const [feed, setFeed] = useState<OpLiveFeed>(() => emptyOpLiveFeed())
  const [pending, setPending] = useState<readonly PendingInteraction[]>([])
  /** 草稿按交互 id 存在流组件里：流每帧重渲染（计时、进度）也不会丢用户填了一半的答案。 */
  const [drafts, setDrafts] = useState<Readonly<Record<string, QuestionDrafts>>>({})
  const [eventRunning, setEventRunning] = useState(false)
  /** 已收束的回合时间戳；`turn.sentAt` 大于它才算本轮仍在等待。 */
  const [settledAt, setSettledAt] = useState(0)
  /** 本回合在流里看到的回合开始/结束时间；开场快照里的历史回合不算。 */
  const [turnStartAt, setTurnStartAt] = useState(0)
  const [turnEndAt, setTurnEndAt] = useState(0)
  /** 已收束的轮次按发出顺序累积：每轮都有用户气泡、助手回复与耗时角标。 */
  const [rounds, setRounds] = useState<readonly StudioSettledRound[]>([])
  const streamIdRef = useRef<string | null>(streamId ?? null)
  const bufferedFramesRef = useRef<Array<{ readonly streamId: string; readonly frame: StreamFrame }>>([])
  const startedRef = useRef<number | null>(null)
  /** 宿主最近一次报运行中的时刻；只有它不早于本轮 sentAt，停跑才算本轮结束。 */
  const runningSinceRef = useRef(0)
  const settledRef = useRef(0)
  const briefRef = useRef('')
  /** 本回合流式写出的助手正文；回合收束时 chat 行还没落行，它兜底成回复气泡。 */
  const liveReplyRef = useRef('')
  const lastTurnRef = useRef<StudioTurnEcho | undefined>(undefined)
  const stageCompleteRef = useRef(onStageComplete)
  stageCompleteRef.current = onStageComplete
  const runningChangeRef = useRef(props.onRunningChange)
  runningChangeRef.current = props.onRunningChange

  const applying = turn !== undefined && turn.sentAt > settledAt
  const activeSentAt = turn === undefined ? 0 : turn.sentAt

  /** 结束本轮等待：把这一轮连同助手回复收进历史，放行发送入口，并让上层刷新暂存与画布。 */
  const settle = useCallback((): void => {
    const active = lastTurnRef.current
    if (active === undefined || settledRef.current >= active.sentAt) return
    settledRef.current = active.sentAt
    const start = startedRef.current
    startedRef.current = null
    const seconds = start === null ? 0 : Math.max(0, Math.round((Date.now() - start) / 1000))
    // chat 行要等下一帧才落行；回复优先取已落行的摘要，否则用本轮流式正文。
    const reply = briefRef.current !== '' ? briefRef.current : liveReplyRef.current.trim()
    setSettledAt(active.sentAt)
    setRounds(current => [
      ...current.filter(round => round.sentAt !== active.sentAt),
      { instruction: active.instruction, anchors: active.anchors, sentAt: active.sentAt, seconds, reply },
    ])
    stageCompleteRef.current()
  }, [])

  const applyFrame = useCallback((frame: StreamFrame): void => {
    if (frame.kind !== 'item') return
    if (isLiveTurnEvent(frame.value, 'turn/start')) setTurnStartAt(Date.now())
    else if (isLiveTurnEvent(frame.value, 'turn/end')) setTurnEndAt(Date.now())
    const action = actionOfFrame(frame.value)
    if (action !== undefined) dispatch(action)
    setFeed(current => foldOpLiveFrame(current, frame.value))
  }, [])

  useEffect(() => {
    const off = bridge?.onStreamFrame?.((frameStreamId, frame) => {
      if (frameStreamId !== streamIdRef.current) {
        // 流标识比首批帧晚到：先缓存，等上层把 streamId 传下来再补折叠。
        if (streamIdRef.current === null && bufferedFramesRef.current.length < MAX_BUFFERED_FRAMES) {
          bufferedFramesRef.current.push({ streamId: frameStreamId, frame })
        }
        return
      }
      applyFrame(frame)
    })
    return () => { off?.() }
  }, [bridge, applyFrame])

  useEffect(() => {
    streamIdRef.current = streamId ?? null
    if (streamId === null || streamId === undefined) return
    const buffered = bufferedFramesRef.current
    bufferedFramesRef.current = []
    for (const entry of buffered) {
      if (entry.streamId === streamId) applyFrame(entry.frame)
    }
  }, [streamId, applyFrame])

  useEffect(() => {
    if (turn === undefined || turn === lastTurnRef.current) return
    lastTurnRef.current = turn
    startedRef.current = Date.now()
    briefRef.current = ''
    liveReplyRef.current = ''
    runningSinceRef.current = 0
    // 上一轮的回合开始/结束时刻不能算到新一轮头上，否则会立刻误判本轮已结束。
    setTurnStartAt(0)
    setTurnEndAt(0)
    // 新的一轮不继承上一轮的过程快照：活动行与流式正文都从空白开始。
    setFeed(emptyOpLiveFeed())
  }, [turn])

  useEffect(() => {
    const text = humanTextOf(feed.snippet).trim()
    if (text !== '') liveReplyRef.current = text
  }, [feed])

  /** 保障 1：本轮发出后宿主报过运行中，再回到 false 就结束等待。 */
  useEffect(() => {
    if (!applying || eventRunning) return
    if (runningSinceRef.current >= activeSentAt) settle()
  }, [applying, activeSentAt, eventRunning, settle])

  /** 保障 2：流里先看到本回合的 turn/start，再看到 turn/end。 */
  useEffect(() => {
    if (applying && turnStartAt >= activeSentAt && turnEndAt >= activeSentAt) settle()
  }, [applying, activeSentAt, turnStartAt, turnEndAt, settle])

  /** 保障 3：每两秒探测暂存与运行态，事件通道漏帧时也能退出等待。 */
  useEffect(() => {
    const probe = props.onProbeComplete
    if (!applying || activeSentAt === 0 || probe === undefined) return
    const sentAt = activeSentAt
    let cancelled = false
    const timer = setInterval(() => {
      void probe(sentAt).then((done) => {
        if (!cancelled && done) settle()
      }).catch(() => undefined)
    }, TURN_PROBE_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [applying, activeSentAt, props.onProbeComplete, settle])

  useEffect(() => {
    const off = bridge?.onEvent?.((event: HostEvent) => {
      const first = event.args[0]
      const running = event.args[1]
      if (event.name !== 'api-session/status' || first !== sessionId || typeof running !== 'boolean') return
      if (running) {
        // 只记本回合发出之后的那次运行中：排队时上一轮还在跑，它的回执不能算到本轮头上。
        runningSinceRef.current = Date.now()
      }
      setEventRunning(running)
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
    runningChangeRef.current?.(applying)
  }, [applying])

  const mine = sessionId === null ? [] : pendingForSession(pending, sessionId)
  const questions = mine.filter(item => item.kind === 'question')
  const turnAnchors = turn === undefined ? [] : turn.anchors
  const hasTurn = turn !== undefined && (turn.instruction.trim() !== '' || turnAnchors.length > 0)
  const activity = applying ? activityOf(feed, t) : ''
  const streamText = applying ? streamingTextOf(feed) : ''

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

  const latestSettled = rounds.length === 0 ? undefined : rounds[rounds.length - 1]

  return (
    <section className="studio-thread" data-testid="studio-thread">
      {questions.map(interaction => (
        <QuestionCard
          key={interaction.id}
          t={t}
          interaction={interaction}
          onAnswer={answer}
          value={drafts[interaction.id]}
          onChange={(next) => { setDrafts(current => ({ ...current, [interaction.id]: next })) }}
        />
      ))}
      {rounds.map(round => (
        <div key={round.sentAt} className="studio-round" data-testid="studio-round" data-sent-at={round.sentAt}>
          <UserTurn instruction={round.instruction} anchors={round.anchors} />
          <div className="studio-turn-done" data-testid="studio-turn-done">
            <span className="studio-turn-badge" data-testid="studio-turn-collapsed">
              {t('studio.turnDone', { seconds: round.seconds })}
            </span>
            {round.reply !== '' && (
              <p className="studio-turn-brief" data-testid="studio-turn-brief">{round.reply}</p>
            )}
          </div>
          {round === latestSettled && props.changeCard !== undefined && props.changeCard !== null && (
            <div className="studio-round-card" data-testid="studio-round-card">{props.changeCard}</div>
          )}
        </div>
      ))}
      {applying && (
        <>
          {hasTurn && <UserTurn instruction={turn.instruction} anchors={turnAnchors} />}
          <div className="studio-turn-progress" data-testid="studio-turn-running" role="status">
            <span className="studio-turn-progress-bar" aria-hidden="true" />
            <span className="studio-turn-progress-text">{t('studio.turnApplying')}</span>
            {activity !== '' && (
              <span className="studio-turn-activity" data-testid="studio-turn-activity">{activity}</span>
            )}
            {streamText !== '' && (
              <p className="studio-turn-live-text" data-testid="studio-turn-live-text">{streamText}</p>
            )}
          </div>
        </>
      )}
      {!applying && rounds.length === 0 && !hasTurn && (
        <p className="studio-thread-empty" data-testid="studio-thread-empty">{t('studio.threadEmpty')}</p>
      )}
    </section>
  )
}

/**
 * 一轮用户意见：整体指令与逐锚点要求。历史轮与正在跑的轮共用同一外观。
 * @param props - 用户指令与点选锚点。
 * @returns 用户气泡；指令与锚点都为空时不渲染。
 */
function UserTurn(props: {
  readonly instruction: string
  readonly anchors: readonly StudioAnchorDraft[]
}): JSX.Element | null {
  const instruction = props.instruction.trim()
  if (instruction === '' && props.anchors.length === 0) return null
  return (
    <div className="studio-user-turn" data-testid="studio-user-turn">
      {instruction !== '' && (
        <p className="studio-user-instruction" data-testid="studio-user-instruction">{instruction}</p>
      )}
      {props.anchors.length > 0 && (
        <ul className="studio-user-anchors" data-testid="studio-user-anchors">
          {props.anchors.map((anchor, index) => (
            <li key={anchor.domPath} className="studio-user-anchor" data-dom-path={anchor.domPath}>
              <span className="studio-user-anchor-label">
                {`#${String(index + 1)} ${anchor.label === undefined || anchor.label === '' ? anchor.domPath : anchor.label}`}
              </span>
              {(anchor.note ?? '').trim() !== '' && (
                <span className="studio-user-anchor-note" data-testid="studio-user-anchor-note">{anchor.note?.trim()}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
