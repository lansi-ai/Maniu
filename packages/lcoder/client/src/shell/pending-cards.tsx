/** 审批卡与提问卡：画宿主送来的 waterfall，并把回执原样交回。 */

import { useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Chip } from '@heroui/react'
import type { Translate } from '../locale.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import type { EventOutcome } from '../contract.ts'
import {
  answerBatch, approvalOutcome, approvalViewOf, emptyDrafts, questionOutcome, questionsOf, selectOption,
  type PendingInteraction, type QuestionDraft, type QuestionDrafts,
} from '../chat/pending.ts'

/** 一次回执的结果；失败时卡片就地显示原因。 */
export type AnswerResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** 卡片列表属性。 */
export interface PendingCardsProps {
  readonly t: Translate
  readonly items: readonly PendingInteraction[]
  readonly onAnswer: (interaction: PendingInteraction, outcome: EventOutcome) => Promise<AnswerResult>
  /** 按交互 id 索引的提问草稿；由外层拥有，关闭弹窗不丢。缺省时卡片自管。 */
  readonly drafts?: Readonly<Record<string, QuestionDrafts>>
  readonly onDraftsChange?: (interactionId: string, next: QuestionDrafts) => void
}

/**
 * 一次工具审批：允许一次或拒绝；按钮锁住直到回执返回。
 * @param props - 交互、词典与回执回调。
 * @returns 审批卡。
 */
function ApprovalCard({ t, interaction, onAnswer }: {
  readonly t: Translate
  readonly interaction: PendingInteraction
  readonly onAnswer: PendingCardsProps['onAnswer']
}): JSX.Element {
  const view = approvalViewOf(interaction.request)
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const settle = (allow: boolean): void => {
    if (busy !== null) return
    setBusy(allow ? 'allow' : 'deny')
    setError(null)
    void onAnswer(interaction, approvalOutcome(allow)).then((result) => {
      if (!result.ok) setError(result.message)
    }).finally(() => { setBusy(null) })
  }
  return (
    <Card className="pending-card" role="dialog" aria-label={t('chat.approvalTitle')} data-testid="approval-card">
      <header className="pending-head">
        <h4>{t('chat.approvalTitle')}</h4>
        <Chip size="sm" variant="secondary" data-testid="approval-tool">{view.toolName}</Chip>
      </header>
      {view.reason === undefined ? null : <p className="pending-reason" data-testid="approval-reason">{view.reason}</p>}
      <div className="pending-actions">
        <Button
          variant="secondary"
          data-testid="approval-deny"
          isDisabled={busy !== null}
          onPress={() => { settle(false) }}
        >
          {busy === 'deny' ? t('chat.answering') : t('chat.reject')}
        </Button>
        <Button
          variant="primary"
          data-testid="approval-allow"
          isDisabled={busy !== null}
          onPress={() => { settle(true) }}
        >
          {busy === 'allow' ? t('chat.answering') : t('chat.allowOnce')}
        </Button>
      </div>
      {error === null ? null : <p className="pending-error" data-testid="approval-error">{t('chat.approvalFailed', { detail: error })}</p>}
    </Card>
  )
}

/**
 * 一次提问（含计划评审）：逐题选选项或填自定义回答，最后一并提交。
 * @param props - 交互、词典与回执回调。
 * @returns 提问卡。
 */
export function QuestionCard({ t, interaction, onAnswer, value, onChange }: {
  readonly t: Translate
  readonly interaction: PendingInteraction
  readonly onAnswer: PendingCardsProps['onAnswer']
  readonly value: QuestionDrafts | undefined
  readonly onChange: (next: QuestionDrafts) => void
}): JSX.Element {
  const questions = questionsOf(interaction.request)
  const [localDrafts, setLocalDrafts] = useState<QuestionDrafts>(() => emptyDrafts(questions))
  const drafts = value ?? localDrafts
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answer = answerBatch(questions, drafts)
  const update = (id: string, next: QuestionDraft): void => {
    const updated = { ...drafts, [id]: next }
    if (value === undefined) setLocalDrafts(updated)
    onChange(updated)
  }
  const submit = (): void => {
    const outcome = questionOutcome(questions, drafts)
    if (outcome === null || busy) return
    setBusy(true)
    setError(null)
    void onAnswer(interaction, outcome).then((result) => {
      if (!result.ok) setError(result.message)
    }).finally(() => { setBusy(false) })
  }
  return (
    <Card className="pending-card pending-question" role="dialog" aria-label={t('chat.questionTitle')} data-testid="question-card">
      <header className="pending-head"><h4>{t('chat.questionTitle')}</h4></header>
      <div className="question-list">
        {questions.map((question) => {
          const draft = drafts[question.id] ?? { selected: [], custom: '' }
          return (
            <section key={question.id} className="question" data-testid="question-item" data-question-id={question.id}>
              {question.header === undefined ? null : <span className="question-header">{question.header}</span>}
              <p className="question-text">{question.question}</p>
              {question.detail === undefined ? null : (
                <div className="question-detail">{renderMarkdown(question.detail)}</div>
              )}
              {question.options.length === 0 ? null : (
                <div className="question-options">
                  {question.options.map(option => (
                    <button
                      key={option.label}
                      type="button"
                      className={draft.selected.includes(option.label) ? 'option option-on' : 'option'}
                      data-testid="question-option"
                      data-label={option.label}
                      aria-pressed={draft.selected.includes(option.label)}
                      onClick={() => { update(question.id, selectOption(question, draft, option.label)) }}
                    >
                      <span>{option.label}</span>
                      {option.description === undefined ? null : <small>{option.description}</small>}
                    </button>
                  ))}
                </div>
              )}
              <input
                className="question-custom"
                data-testid="question-custom"
                value={draft.custom}
                placeholder={t('chat.questionCustom')}
                aria-label={t('chat.questionCustom')}
                onChange={(event) => { update(question.id, { ...draft, custom: event.target.value }) }}
              />
            </section>
          )
        })}
      </div>
      <div className="pending-actions">
        <Button
          variant="primary"
          data-testid="question-submit"
          isDisabled={answer === null || busy}
          onPress={submit}
        >
          {busy ? t('chat.answering') : t('chat.questionSubmit')}
        </Button>
      </div>
      {answer === null ? <p className="pending-hint">{t('chat.questionRequired')}</p> : null}
      {error === null ? null : <p className="pending-error" data-testid="question-error">{t('chat.questionFailed', { detail: error })}</p>}
    </Card>
  )
}

/**
 * 全部等待人处理的交互；旧的在上，新的在下。
 * @param props - 交互列表与回执回调。
 * @returns 卡片栈；没有交互时为空。
 */
export function PendingCards({ t, items, onAnswer, drafts, onDraftsChange }: PendingCardsProps): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="pending-stack" data-testid="pending-stack">
      {items.map(interaction => interaction.kind === 'approval'
        ? <ApprovalCard key={interaction.id} t={t} interaction={interaction} onAnswer={onAnswer} />
        : (
          <QuestionCard
            key={interaction.id}
            t={t}
            interaction={interaction}
            onAnswer={onAnswer}
            value={drafts?.[interaction.id]}
            onChange={(next) => { onDraftsChange?.(interaction.id, next) }}
          />
        ))}
    </div>
  )
}
