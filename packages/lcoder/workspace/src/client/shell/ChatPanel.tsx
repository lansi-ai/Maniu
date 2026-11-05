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
  DisclosureRow, IconContextInjectionOutlineRegular, IconThinkOutlineRegular, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ShellMessage } from './shell-data.ts'
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

/** 折叠摘要用的一行；空行跳过，过长省略。 */
function firstLine(text: string): string {
  const line = text.split('\n').map(part => part.trim()).find(part => part !== '') ?? ''
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}

/** 对话正文：用户气泡、助手 Markdown 与思考折叠、注入上下文折叠行。 */
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
        <span className={css.who}>LCoder</span>
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
        return (
          <div key={`assistant-${String(index)}`} className={`${css.msg} ${css.msgAssistant}`}>
            <span className={css.who}>LCoder</span>
            {message.blocks.map((block, blockIndex) => block.kind === 'reasoning'
              ? <ReasoningFold key={`reasoning-${String(blockIndex)}`} text={block.text} t={t} />
              : (
                <div key={`text-${String(blockIndex)}`} className={css.markdownBody}>
                  <MarkdownText text={block.text} labels={labels} />
                </div>
              ))}
          </div>
        )
      })}
    </>
  )
}

/** 思考过程默认折叠，只显示首行摘要；展开后按 Markdown 阅读。 */
function ReasoningFold({ text, t }: { readonly text: string; readonly t: Translate }): ReactNode {
  const [open, setOpen] = useState(false)
  const labels = useMarkdownLabels(t)
  const summary = useMemo(() => firstLine(text).replaceAll('**', ''), [text])
  return (
    <div className={css.reasoningFold}>
      <DisclosureRow
        icon={<IconThinkOutlineRegular size={14} />}
        title={t('shell.thinking')}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={summary === '' ? undefined : (
          <>
            <span className={css.foldSep} aria-hidden />
            <span className={css.foldSummary}>{summary}</span>
          </>
        )}
      >
        <div className={css.reasoningBody}>
          <MarkdownText text={text} labels={labels} variant="compact" />
        </div>
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
