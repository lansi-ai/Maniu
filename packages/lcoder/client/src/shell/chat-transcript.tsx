/** 聊天正文：用户发言与附件、按回合收敛的过程组、助手 Markdown 与流式草稿。 */

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { Translate } from '../locale.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import type {
  ChatAttachment, ChatImageAttachment, ChatRow, ChatState, ProcessItem, ToolOutcome,
} from '../store.ts'
import { attachmentImageUrl } from '../chat/attachments.ts'
import { copyText } from '../chat/clipboard.ts'
import { formatBytes } from '../chat/composer.ts'

/** 距底部多近算「在跟读」；超过就暂停自动滚动。 */
const FOLLOW_THRESHOLD = 48

/** 正文属性。 */
export interface ChatTranscriptProps {
  readonly t: Translate
  readonly sessionId: string | null
  readonly chat: ChatState
  /** 立项会话的首条用户指令整行不渲染；指令仍照常发送并留在会话日志里。 */
  readonly seedHidden?: boolean
  /** 待处理卡；排在消息之后，随对话一起滚动。 */
  readonly pending?: ReactNode
  /** 待处理卡数量；增加时滚到底，让新卡片进入视野。 */
  readonly pendingCount?: number
}

function toolLabel(name: string, t: Translate): string {
  if (name === 'cmd_run') return t('chat.tool.terminal')
  if (name.startsWith('task_')) return t('chat.tool.task')
  if (name.startsWith('spec_')) return t('chat.tool.spec')
  if (name === 'file_read') return t('chat.tool.read')
  if (name === 'file_edit') return t('chat.tool.edit')
  if (name.startsWith('file_search') || name === 'grep' || name === 'glob') return t('chat.tool.search')
  if (name === 'web_search' || name === 'web_fetch') return t('chat.tool.web')
  if (name === 'ask_user_question') return t('chat.tool.ask')
  return name
}

function argsPreview(args: string): string {
  const text = args.replace(/\s+/gu, ' ').trim()
  if (text === '' || text === '{}') return ''
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

/**
 * 一张已提交图片的预览；字节走宿主的会话附件回执。
 * @param props - 会话、引用与失败文案。
 * @returns 图片或一条就地失败说明。
 */
function MessageImage({ sessionId, image, t }: {
  readonly sessionId: string
  readonly image: ChatImageAttachment
  readonly t: Translate
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    setError(null)
    void attachmentImageUrl(sessionId, image)
      .then((next) => { if (live) setUrl(next) })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { live = false }
  }, [sessionId, image])
  if (error !== null) {
    return <span className="attach-chip" data-testid="message-image-error">{t('chat.attachFailed', { detail: error })}</span>
  }
  return (
    <a className="attach-image" href={url ?? undefined} target="_blank" rel="noreferrer">
      {url === null
        ? <span className="attach-chip">{t('chat.imageLoading')}</span>
        : (
          <img
            src={url}
            alt={image.name ?? t('chat.imageAlt')}
            data-testid="message-image"
            data-attachment-id={image.attachmentId}
            width={Math.min(image.width, 260)}
            height={Math.round((Math.min(image.width, 260) / image.width) * image.height)}
          />
        )}
    </a>
  )
}

/**
 * 用户消息里的附件行；图片给缩略图，文件给名字与大小。
 * @param props - 会话、附件与词典。
 * @returns 附件列表；没有附件时为 null。
 */
function MessageAttachments({ sessionId, attachments, t }: {
  readonly sessionId: string
  readonly attachments: readonly ChatAttachment[]
  readonly t: Translate
}): JSX.Element | null {
  if (attachments.length === 0) return null
  return (
    <div className="attach-row" data-testid="message-attachments">
      {attachments.map((attachment, index) => attachment.kind === 'image'
        ? <MessageImage key={`image-${String(index)}`} sessionId={sessionId} image={attachment.image} t={t} />
        : (
          <span key={`file-${String(index)}`} className="attach-chip" data-testid="message-file">
            {t('chat.fileAttachment', { name: attachment.file.name, size: formatBytes(attachment.file.bytes) })}
          </span>
        ))}
    </div>
  )
}

function toolStatus(outcome: ToolOutcome | undefined, t: Translate): { text: string; failed: boolean } {
  if (outcome === undefined) return { text: t('chat.processStatusCalled'), failed: false }
  return outcome.ok
    ? { text: t('chat.processStatusDone'), failed: false }
    : { text: t('chat.processStatusFailed'), failed: true }
}

/**
 * 一个工具条目：显示名、状态与原样参数，结果只给一行摘要。
 * @param props - 工具条目、结果与词典。
 * @returns 工具卡。
 */
function ToolItem({ item, outcome, t }: {
  readonly item: ProcessItem & { readonly kind: 'tool' }
  readonly outcome: ToolOutcome | undefined
  readonly t: Translate
}): JSX.Element {
  const label = toolLabel(item.name, t)
  const args = argsPreview(item.args)
  const status = toolStatus(outcome, t)
  return (
    <li className="process-tool" data-testid="process-tool" data-tool={item.name} data-call-id={item.callId}>
      <div className="process-line">
        <span className="process-label">{label}</span>
        {label === item.name ? null : <code className="process-name">{item.name}</code>}
        <span
          className="process-status"
          data-testid="process-status"
          data-failed={status.failed ? 'true' : undefined}
          data-state={outcome === undefined ? 'called' : outcome.ok ? 'done' : 'failed'}
        >
          {status.text}
        </span>
      </div>
      {args === '' ? null : <code className="process-args" data-testid="process-args">{args}</code>}
      {outcome === undefined || outcome.summary === '' ? null : (
        <p className="process-result" data-testid="process-summary">{t('chat.processResult', { summary: outcome.summary })}</p>
      )}
    </li>
  )
}

/**
 * 一个回合的过程组：思考与工具调用收进一枚可展开的组头，默认折叠。
 * 列表用 hidden 收起，条目仍留在 DOM 里，现有 testid 与展开后的一致。
 * @param props - 过程条目、工具结果与词典。
 * @returns 过程组。
 */
const ProcessGroup = memo(function ProcessGroup({ row, tools, t }: {
  readonly row: ChatRow & { readonly kind: 'process' }
  readonly tools: Readonly<Record<string, ToolOutcome>>
  readonly t: Translate
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const toolCount = row.items.reduce((count, item) => count + (item.kind === 'tool' ? 1 : 0), 0)
  const thoughtCount = row.items.length - toolCount
  const title = toolCount > 0
    ? t('chat.processTools', { count: toolCount })
    : t('chat.processThinking', { count: thoughtCount })
  return (
    <section className="process-group" data-testid="process-group" data-open={open ? 'true' : 'false'}>
      <button type="button" className="process-head" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className="process-title">{title}</span>
        {toolCount > 0 && thoughtCount > 0
          ? <span className="process-sub">{t('chat.processThinking', { count: thoughtCount })}</span>
          : null}
        <span className="process-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      <ol className="process-list" hidden={!open}>
        {row.items.map((item, index) => item.kind === 'reasoning'
          ? (
            <li key={`reasoning-${String(index)}`} className="process-reasoning" data-testid="process-reasoning">
              <span className="process-label">{t('chat.processThought')}</span>
              <p>{item.text}</p>
            </li>
          )
          : (
            <ToolItem
              key={`tool-${String(index)}`}
              item={item}
              outcome={tools[item.callId]}
              t={t}
            />
          ))}
      </ol>
    </section>
  )
}, (previous, next) => previous.row === next.row && previous.t === next.t
  && next.row.items.every(item => item.kind !== 'tool'
    || previous.tools[item.callId] === next.tools[item.callId]))

/** 复制按钮的图标：空闲是两张纸，复制成功是勾。 */
function CopyIcon({ copied }: { readonly copied: boolean }): JSX.Element {
  return (
    <svg className="copy-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {copied
        ? <path d="M3.5 8.5l3 3 6-6.5" />
        : (
          <>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
            <path d="M10.5 3.5h-7a1 1 0 0 0-1 1v7" />
          </>
        )}
    </svg>
  )
}

/**
 * 一条消息旁的复制按钮：图标化，悬停或键盘聚焦时露出；
 * 复制成功换成勾并短暂标注，失败只在 title 里说明。
 * @param props - 原文、testid 与词典。
 * @returns 复制按钮。
 */
function CopyButton({ text, testId, t }: {
  readonly text: string
  readonly testId: string
  readonly t: Translate
}): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  const label = state === 'copied' ? t('chat.copied')
    : state === 'failed' ? t('chat.copyFailed')
      : t('chat.copyMessage')
  return (
    <button
      type="button"
      className="copy-button"
      data-testid={testId}
      data-copied={state === 'copied' ? 'true' : undefined}
      data-failed={state === 'failed' ? 'true' : undefined}
      title={label}
      aria-label={label}
      onClick={() => {
        void copyText(text).then((ok) => {
          setState(ok ? 'copied' : 'failed')
          if (timer.current !== null) window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => { setState('idle') }, 1400)
        })
      }}
    >
      <CopyIcon copied={state === 'copied'} />
      <span className="copy-flash" data-testid={`${testId}-flash`}>{state === 'copied' ? t('chat.copied') : ''}</span>
    </button>
  )
}

/**
 * 一条已提交的用户发言；流式增量不会改动它，靠 memo 跳过重渲。
 * 立项会话的首条指令整行不渲染，正文仍留在会话日志里。
 * @param props - 会话、行、词典与是否收起整行。
 * @returns 用户消息；收起时为 null。
 */
const UserRow = memo(function UserRow({ sessionId, row, t, seed }: {
  readonly sessionId: string | null
  readonly row: ChatRow & { readonly kind: 'user' }
  readonly t: Translate
  readonly seed?: boolean
}): JSX.Element | null {
  if (seed === true) return null
  return (
    <div className="message-line" data-kind="user">
      <article className="message user" data-testid="message-user">
        {row.text === '' ? null : <p className="message-text">{row.text}</p>}
        {sessionId === null ? null : (
          <MessageAttachments sessionId={sessionId} attachments={row.attachments} t={t} />
        )}
      </article>
      {row.text.trim() === '' ? null : <CopyButton text={row.text} testId="copy-user" t={t} />}
    </div>
  )
})

/**
 * 一条已提交的助手正文；Markdown 渲染只随行内容变化。
 * @param props - 行与词典。
 * @returns 助手消息。
 */
const AssistantRow = memo(function AssistantRow({ row, t }: {
  readonly row: ChatRow & { readonly kind: 'assistant' }
  readonly t: Translate
}): JSX.Element {
  return (
    <div className="message-line" data-kind="assistant">
      <article className="message assistant" data-testid="message-assistant">
        <div className="markdown-body">{renderMarkdown(row.text)}</div>
      </article>
      <CopyButton text={row.text} testId="copy-assistant" t={t} />
    </div>
  )
})

/**
 * 思考态：一行提示、三个点，以及跟着流式增量长出来的思考原文。
 * 原文在小窗里滚动，正文一开始出现就由调用方整个移除。
 * @param props - 实时思考文本与词典。
 * @returns 思考面板。
 */
function ThinkingRow({ reasoning, t }: { readonly reasoning: string; readonly t: Translate }): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (box.current !== null) box.current.scrollTop = box.current.scrollHeight
  }, [reasoning])
  return (
    <div className="message assistant thinking" data-testid="chat-thinking" role="status">
      <div className="thinking-head">
        <span>{t('chat.thinking')}</span>
        <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
      {reasoning.trim() === '' ? null : (
        <div className="thinking-process" data-testid="chat-thinking-reasoning" ref={box}>{reasoning}</div>
      )}
    </div>
  )
}

/**
 * 聊天正文。
 * @param props - 会话标识、折叠状态、立项收起、待处理卡与词典。
 * @returns 已提交行、思考态指示、流式草稿、待处理卡与流错误。
 */
export function ChatTranscript({
  t, sessionId, chat, seedHidden, pending, pendingCount = 0,
}: ChatTranscriptProps): JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  // 只有用户停在底部附近时才跟着长高；主动上滚后暂停，回到底部自动恢复。
  const follow = useRef(true)
  // 待处理卡出现前可能已经停在别处；卡片一多出来就必须滚到它。
  const seenPending = useRef(0)
  useEffect(() => { follow.current = true }, [sessionId])
  useLayoutEffect(() => {
    const node = list.current
    if (node === null) return
    if (pendingCount > seenPending.current) follow.current = true
    seenPending.current = pendingCount
    if (follow.current) node.scrollTop = node.scrollHeight
  }, [
    chat.rows, chat.liveText, chat.liveReasoning, chat.attempt, chat.retry, chat.failure, chat.streamError,
    pendingCount,
  ])
  // 思考态只在正文还没开始时出现；流式草稿一旦有字就让位。
  const thinking = chat.attempt !== null && chat.liveText === ''
  const seedId = seedHidden === true ? chat.rows.find(row => row.kind === 'user')?.id : undefined
  return (
    <div
      className="messages"
      data-testid="messages"
      ref={list}
      onScroll={() => {
        const node = list.current
        if (node === null) return
        follow.current = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_THRESHOLD
      }}
    >
      {chat.rows.map((row) => {
        if (row.kind === 'process') return <ProcessGroup key={row.id} row={row} tools={chat.toolResults} t={t} />
        if (row.kind === 'user') {
          return <UserRow key={row.id} sessionId={sessionId} row={row} t={t} seed={row.id === seedId} />
        }
        return <AssistantRow key={row.id} row={row} t={t} />
      })}
      {thinking && <ThinkingRow reasoning={chat.liveReasoning} t={t} />}
      {chat.liveText !== '' && (
        <article className="message assistant live" data-testid="message-assistant" data-live="true">
          {chat.liveText}
        </article>
      )}
      {chat.retry !== null && (
        <p className="notice model-retry" data-testid="chat-retry" role="status">
          {t('chat.modelRetrying', {
            attempt: chat.retry.attempt,
            max: chat.retry.max ?? '∞',
          })}
        </p>
      )}
      {chat.failure !== null && (
        <p
          className="notice model-failure"
          data-testid="chat-failure"
          data-request-id={chat.failure.requestId ?? undefined}
        >
          <span>{t('chat.modelFailed', {
            detail: chat.failure.message === '' ? t('chat.modelFailedGeneric') : chat.failure.message,
          })}</span>
          {chat.failure.requestId === null ? null : (
            <span className="failure-request">{t('chat.modelFailedRequest', { id: chat.failure.requestId })}</span>
          )}
        </p>
      )}
      {chat.streamError !== null && <p className="notice" data-testid="stream-error">{chat.streamError}</p>}
      {pending}
    </div>
  )
}
