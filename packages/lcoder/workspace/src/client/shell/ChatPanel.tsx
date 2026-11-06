/**
 * 悬浮对话的正文、思考折叠、注入上下文行，以及审批/提问弹窗。
 *
 * 正文与折叠直接使用上游 ui-primitives 的 MarkdownText / DisclosureRow；
 * 审批与提问的卡片由本包绘制，但结算仍调用上游 PendingApproval /
 * PendingQuestion 的 answer()，不复制它们的水位与降级逻辑。
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DisclosureRow, IconBrowseOutlineRegular, IconContextInjectionOutlineRegular, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ShellMessage, ShellProcessItem } from './shell-data.ts'
import { answerBatch, approvalOf, emptyDrafts, questionOf, selectOption } from './pending.ts'
import type {
  QuestionDraft, QuestionDrafts, ShellApprovalPending, ShellQuestionPending,
} from './pending.ts'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** Markdown 代码块与脚注的本地化文案；身份稳定，避免流式渲染缓存失效。 */
function useMarkdownLabels(t: Translate): { code: { copyLabel: string; copiedLabel: string }; footnotes: string } {
  return useMemo(() => ({
    code: { copyLabel: t('shell.copyCode'), copiedLabel: t('shell.copiedCode') },
    footnotes: t('shell.footnotes'),
  }), [t])
}

/** 对话正文：用户气泡、过程组头、答复 Markdown 与注入上下文折叠行。 */
export function ChatTranscript({
  messages, running, t,
}: {
  readonly messages: readonly ShellMessage[]
  readonly running: boolean
  readonly t: Translate
}): ReactNode {
  const labels = useMarkdownLabels(t)
  if (messages.length === 0) {
    return (
      <div className={`${css.msg} ${css.msgSys}`}>
        <span className={css.who}>{t('shell.brand')}</span>
        {running ? t('shell.chatWaiting') : t('shell.chatEmpty')}
      </div>
    )
  }
  return (
    <>
      {messages.map((message, index) => {
        if (message.role === 'user') {
          return (
            <div key={`user-${String(index)}`} className={`${css.msg} ${css.msgUser}`}>
              <span className={css.who}>{t('shell.you')}</span>
              {message.text}
            </div>
          )
        }
        if (message.role === 'context') {
          return <ContextRow key={`context-${String(index)}`} text={message.text} label={message.label} t={t} />
        }
        if (message.role === 'process') {
          return <ProcessGroup key={`process-${String(index)}`} items={message.items} t={t} />
        }
        if (message.role === 'compaction') {
          return (
            <div key={`compaction-${String(index)}`} className={`${css.msg} ${css.msgSys}`}>
              <span className={css.who}>{t('shell.compactionMarker')}</span>
              {message.error === undefined
                ? t('shell.compactionDetail', { items: message.items, tokens: message.tokens })
                : t('shell.compactionFailed', { detail: message.error })}
            </div>
          )
        }
        return (
          <div key={`assistant-${String(index)}`} className={`${css.msg} ${css.msgAssistant}`}>
            <span className={css.who}>{t('shell.brand')}</span>
            <div className={css.markdownBody}>
              <MarkdownText text={message.text} labels={labels} />
            </div>
          </div>
        )
      })}
    </>
  )
}

/** 工具条目的展示名；未知工具直接用工具名。 */
function toolLabel(item: ShellProcessItem & { readonly kind: 'tool' }, t: Translate): string {
  if (item.name === 'cmd_run') return t('shell.processToolTerminal')
  if (item.name.startsWith('task_')) return t('shell.processToolTask')
  if (item.name.startsWith('spec_')) return t('shell.processToolSpec')
  if (item.name === 'file_read') return t('shell.processToolRead')
  if (item.name === 'file_edit') return t('shell.processToolEdit')
  return item.name
}

/** 工具条目的状态；未知结果不冒充成功。 */
function toolStatus(item: ShellProcessItem & { readonly kind: 'tool' }, t: Translate): string {
  if (item.ok === false) return t('shell.processStatusFailed')
  if (item.ok === undefined) return t('shell.processStatusCalled')
  if (item.name === 'cmd_run') return t('shell.processStatusRan')
  if (item.name.startsWith('task_')) return t('shell.processStatusSent')
  if (item.name === 'file_read') return t('shell.processStatusRead')
  if (item.name === 'file_edit') return t('shell.processStatusWritten')
  return t('shell.processStatusDone')
}

/** 参数预览：空对象不占行，过长截断。 */
function argsPreview(args: string): string {
  const text = args.trim()
  if (text === '' || text === '{}') return ''
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

/**
 * 一个回合内的思考与工具调用收敛成一行组头；展开后逐条列出细节。
 * 上游 trajectory 的组头/时间线不在包入口导出，这里按最小列表呈现。
 */
function ProcessGroup({ items, t }: { readonly items: readonly ShellProcessItem[]; readonly t: Translate }): ReactNode {
  const [open, setOpen] = useState(false)
  const tools = items.reduce((count, item) => count + (item.kind === 'tool' ? 1 : 0), 0)
  const thoughts = items.length - tools
  const title = tools > 0
    ? t('shell.processTools', { count: tools })
    : t('shell.processThinking', { count: thoughts })
  const summary = tools > 0 && thoughts > 0
    ? t('shell.processThinking', { count: thoughts })
    : undefined
  return (
    <div className={css.processGroup}>
      <DisclosureRow
        icon={<IconBrowseOutlineRegular size={14} />}
        title={title}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={summary === undefined ? undefined : (
          <>
            <span className={css.foldSep} aria-hidden />
            <span className={css.foldSummary}>{summary}</span>
          </>
        )}
      >
        <ol className={css.processList}>
          {items.map((item, index) => {
            if (item.kind === 'reasoning') {
              return (
                <li key={`reasoning-${String(index)}`} className={css.processRow}>
                  <span className={css.processLabel}>{t('shell.processThought')}</span>
                  <p className={css.processReasoning}>{item.text}</p>
                </li>
              )
            }
            const label = toolLabel(item, t)
            const args = argsPreview(item.args)
            return (
              <li key={`tool-${String(index)}`} className={css.processRow}>
                <div className={css.processLine}>
                  <span className={css.processLabel}>{label}</span>
                  <span className={css.processStatus} data-failed={item.ok === false ? 'true' : undefined}>
                    {toolStatus(item, t)}
                  </span>
                </div>
                {label === item.name && args === '' ? null : (
                  <div className={css.processDetail}>
                    {label === item.name ? null : <code>{item.name}</code>}
                    {args === '' ? null : <code>{args}</code>}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </DisclosureRow>
    </div>
  )
}

/** 注入上下文（runtime context、agent 指令、技能正文等）折成一行，可展开回看。 */
function ContextRow({
  text, label, t,
}: {
  readonly text: string
  readonly label: string
  readonly t: Translate
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className={css.contextFold}>
      <DisclosureRow
        icon={<IconContextInjectionOutlineRegular size={14} />}
        title={t('shell.contextInjection')}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.foldSep} aria-hidden />
            <span className={css.foldLabel}>{label}</span>
          </>
        )}
      >
        <pre className={css.contextBody}>{text}</pre>
      </DisclosureRow>
    </div>
  )
}

/** 当前会话等待人处理的那一条交互；审批与提问各一张卡。 */
export function PendingInteractionCard({
  pending, t,
}: {
  readonly pending: SessionPendingInteractionBase
  readonly t: Translate
}): ReactNode | null {
  const approval = approvalOf(pending)
  if (approval !== null) return <ApprovalCard pending={approval} t={t} />
  const question = questionOf(pending)
  if (question !== null) return <QuestionCard pending={question} t={t} />
  return null
}

/** 一次工具审批：允许一次或拒绝。 */
function ApprovalCard({ pending, t }: { readonly pending: ShellApprovalPending; readonly t: Translate }): ReactNode {
  const [busy, setBusy] = useState<'allow' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const settle = (decision: 'allowed-once' | 'rejected'): void => {
    setBusy(decision === 'allowed-once' ? 'allow' : 'reject')
    setError(null)
    void pending.answer(decision).catch((reason: unknown) => { setError(String(reason)) }).finally(() => { setBusy(null) })
  }
  const disabled = busy !== null || !pending.answerable
  return (
    <div className={css.pendingLayer}>
      <div className={css.pendingCard} role="dialog" aria-label={t('shell.approvalTitle')}>
        <div className={css.pendingHead}>
          <h4>{t('shell.approvalTitle')}</h4>
          <span className={css.pill}>{pending.toolName}</span>
        </div>
        {pending.reason === undefined ? null : <p className={css.pendingReason}>{pending.reason}</p>}
        <div className={css.pendingActions}>
          <button type="button" className={css.secondaryBtn} disabled={disabled} onClick={() => { settle('rejected') }}>
            {t('shell.reject')}
          </button>
          <button type="button" className={css.primaryBtn} disabled={disabled} onClick={() => { settle('allowed-once') }}>
            {busy === 'allow' ? t('shell.answering') : t('shell.allowOnce')}
          </button>
        </div>
        {error === null ? null : <p className={css.problem}>{error}</p>}
      </div>
    </div>
  )
}

/** 一次提问（含计划评审）：逐题选选项或填自定义回答，最后一并提交。 */
function QuestionCard({ pending, t }: { readonly pending: ShellQuestionPending; readonly t: Translate }): ReactNode {
  const [drafts, setDrafts] = useState<QuestionDrafts>(() => emptyDrafts(pending.questions))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const labels = useMarkdownLabels(t)
  const answer = answerBatch(pending.questions, drafts)
  const update = (id: string, next: QuestionDraft): void => {
    setDrafts(current => ({ ...current, [id]: next }))
  }
  const submit = (): void => {
    if (answer === null) return
    setBusy(true)
    setError(null)
    void pending.answer(answer).catch((reason: unknown) => { setError(String(reason)) }).finally(() => { setBusy(false) })
  }
  return (
    <div className={css.pendingLayer}>
      <div className={`${css.pendingCard} ${css.pendingQuestionCard}`} role="dialog" aria-label={t('shell.questionTitle')}>
        <div className={css.pendingHead}><h4>{t('shell.questionTitle')}</h4></div>
        <div className={css.questionList}>
          {pending.questions.map((question) => {
            const draft = drafts[question.id] ?? { selected: [], custom: '' }
            return (
              <section key={question.id} className={css.question}>
                {question.header === undefined ? null : <span className={css.questionHeader}>{question.header}</span>}
                <p className={css.questionText}>{question.question}</p>
                {question.detail === undefined ? null : (
                  <div className={css.questionDetail}>
                    <MarkdownText text={question.detail} labels={labels} variant="compact" />
                  </div>
                )}
                {question.options === undefined || question.options.length === 0 ? null : (
                  <div className={css.options}>
                    {question.options.map(option => (
                      <button
                        key={option.label}
                        type="button"
                        className={`${css.option} ${draft.selected.includes(option.label) ? css.optionOn : ''}`}
                        onClick={() => { update(question.id, selectOption(question, draft, option.label)) }}
                      >
                        <span>{option.label}</span>
                        {option.description === undefined ? null : <small>{option.description}</small>}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className={css.questionCustom}
                  value={draft.custom}
                  placeholder={t('shell.customAnswer')}
                  onChange={(event) => { update(question.id, { ...draft, custom: event.target.value }) }}
                />
              </section>
            )
          })}
        </div>
        <div className={css.pendingActions}>
          <button type="button" className={css.primaryBtn} disabled={answer === null || busy} onClick={submit}>
            {busy ? t('shell.answering') : t('shell.submitAnswer')}
          </button>
        </div>
        {answer === null ? <p className={css.secretRef}>{t('shell.answerRequired')}</p> : null}
        {error === null ? null : <p className={css.problem}>{error}</p>}
      </div>
    </div>
  )
}
