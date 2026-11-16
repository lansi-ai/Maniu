/** 聊天正文：用户发言与附件、按回合收敛的过程组、助手 Markdown 与流式草稿。 */

import { memo, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Translate } from '../locale.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import type {
  ChatAttachment, ChatImageAttachment, ChatRow, ChatState, ProcessItem, ToolOutcome,
} from '../store.ts'
import { attachmentImageUrl } from '../chat/attachments.ts'
import { formatBytes } from '../chat/composer.ts'

/** 正文属性。 */
export interface ChatTranscriptProps {
  readonly t: Translate
  readonly sessionId: string | null
  readonly chat: ChatState
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
    <section className="process-group lg-frost" data-testid="process-group" data-open={open ? 'true' : 'false'}>
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

/**
 * 一条已提交的用户发言；流式增量不会改动它，靠 memo 跳过重渲。
 * @param props - 会话、行与词典。
 * @returns 用户消息。
 */
const UserRow = memo(function UserRow({ sessionId, row, t }: {
  readonly sessionId: string | null
  readonly row: ChatRow & { readonly kind: 'user' }
  readonly t: Translate
}): JSX.Element {
  return (
    <article className="message user" data-testid="message-user">
      {row.text === '' ? null : <p className="message-text">{row.text}</p>}
      {sessionId === null ? null : (
        <MessageAttachments sessionId={sessionId} attachments={row.attachments} t={t} />
      )}
    </article>
  )
})

/**
 * 一条已提交的助手正文；Markdown 渲染只随行内容变化。
 * @param props - 行。
 * @returns 助手消息。
 */
const AssistantRow = memo(function AssistantRow({ row }: {
  readonly row: ChatRow & { readonly kind: 'assistant' }
}): JSX.Element {
  return (
    <article className="message assistant lg-frost" data-testid="message-assistant">
      <div className="markdown-body">{renderMarkdown(row.text)}</div>
    </article>
  )
})

/**
 * 思考态指示：只报「正在思考」，不铺思维链；正文到达后由调用方移除。
 * @param props - 词典。
 * @returns 三个点与一行提示。
 */
function ThinkingRow({ t }: { readonly t: Translate }): JSX.Element {
  return (
    <div className="message assistant thinking" data-testid="chat-thinking" role="status">
      <span>{t('chat.thinking')}</span>
      <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  )
}

/**
 * 聊天正文。
 * @param props - 会话标识、折叠状态与词典。
 * @returns 已提交行、思考态指示、流式草稿与流错误。
 */
export function ChatTranscript({ t, sessionId, chat }: ChatTranscriptProps): JSX.Element {
  // 思考态只在正文还没开始时出现；流式草稿一旦有字就让位。
  const thinking = chat.attempt !== null && chat.liveText === ''
  return (
    <div className="messages" data-testid="messages">
      {chat.rows.map((row) => {
        if (row.kind === 'process') return <ProcessGroup key={row.id} row={row} tools={chat.toolResults} t={t} />
        if (row.kind === 'user') return <UserRow key={row.id} sessionId={sessionId} row={row} t={t} />
        return <AssistantRow key={row.id} row={row} />
      })}
      {thinking && <ThinkingRow t={t} />}
      {chat.liveText !== '' && (
        <article className="message assistant live lg-frost" data-testid="message-assistant" data-live="true">
          {chat.liveText}
        </article>
      )}
      {chat.streamError !== null && <p className="notice" data-testid="stream-error">{chat.streamError}</p>}
    </div>
  )
}
