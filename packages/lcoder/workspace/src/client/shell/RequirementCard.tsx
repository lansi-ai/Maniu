/**
 * 需求确认卡片：需求编号、创建人、创建时间、默认折叠的需求文档与立项问答，以及拆分任务。
 *
 * 需求文档取任务回指方案（`problem`、`options`、`recommendation`）；方案文件没读到时才
 * 退回任务自己的 description。只画传入的任务、方案与问答；拆分指令由外壳发送。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProposalRow } from '../projection.ts'
import type { ShellTask } from './shell-data.ts'
import type { RequirementAnswer } from './requirement.ts'
import { formatOpenedAt } from './requirement.ts'
import { useMarkdownLabels } from './ChatPanel.tsx'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 需求卡片要的任务、方案、问答与动作。 */
export interface RequirementCardProps {
  readonly t: Translate
  readonly task: ShellTask
  /** 立项会话里分析师输出的《项目需求概要》正文；读不到时为 null。 */
  readonly document?: string | null
  /** 任务回指的需求方案；文件没读到时为 undefined，正文退回任务 description。 */
  readonly proposal?: ProposalRow | undefined
  /** 从立项会话读出的问答；空数组表示没读到记录。 */
  readonly answers: readonly RequirementAnswer[]
  /** 拆分指令发送在途；按钮据此禁用。 */
  readonly splitting: boolean
  /** 就地错误原文；没有时为 null。 */
  readonly error: string | null
  readonly onClose: () => void
  readonly onSplit: () => void
}

/** 内容折叠时的一行摘要：取正文第一段，过长截断。 */
function previewOf(text: string): string {
  const line = text.trim().split(/\r?\n/u, 1)[0]?.trim() ?? ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}

/** 一段可折叠区的标题与开关。 */
function SectionHead({
  t, title, open, onToggle, testId,
}: {
  readonly t: Translate
  readonly title: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly testId: string
}): ReactNode {
  return (
    <div className={css.requirementContentHead}>
      <span className={css.requirementContentTitle}>{title}</span>
      <button
        type="button"
        className={css.requirementMore}
        aria-expanded={open}
        data-section-toggle={testId}
        onClick={onToggle}
      >
        {open ? t('shell.requirementShowLess') : t('shell.requirementShowMore')}
      </button>
    </div>
  )
}

/**
 * 画一张需求卡片。
 * @param props - 任务、方案、问答、在途与错误、关闭与拆分动作。
 * @returns 卡片内容；由外壳放在既有模态容器里。
 */
export function RequirementCard({
  t, task, document, proposal, answers, splitting, error, onClose, onSplit,
}: RequirementCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [answersOpen, setAnswersOpen] = useState(false)
  const labels = useMarkdownLabels(t)
  // 优先展示分析师当时输出的需求文档；没有文档时才用方案正文或任务描述。
  const body = document ?? (proposal === undefined ? task.description : proposal.problem)
  const usingDocument = document !== null && document !== undefined
  const preview = previewOf(body)
  const createdAt = formatOpenedAt(task.openedAt)
  return (
    <div className={css.requirementCard} data-requirement-card>
      <div className={css.modalHead}>
        <div className={css.grow}>
          <h3 className={css.requirementTitle} data-requirement-title>
            {t('shell.requirementHeading', { id: task.id, title: task.title })}
          </h3>
        </div>
        <span className={css.pill}>{t('shell.drafting')}</span>
        <button type="button" className={css.iconBtn} onClick={onClose}>✕</button>
      </div>
      <div className={css.modalBody}>
        <dl className={css.requirementMeta}>
          <div className={css.requirementMetaItem}>
            <dt className={css.metaK}>{t('shell.requirementCreatorLabel')}</dt>
            <dd className={css.metaV}>{t('shell.requirementCreator')}</dd>
          </div>
          <div className={css.requirementMetaItem}>
            <dt className={css.metaK}>{t('shell.requirementCreatedLabel')}</dt>
            <dd className={css.metaV}>{createdAt === '' ? '—' : createdAt}</dd>
          </div>
        </dl>
        <section className={css.requirementContent} data-requirement-content>
          <SectionHead
            t={t}
            title={t('shell.requirementContent')}
            open={open}
            onToggle={() => { setOpen(value => !value) }}
            testId="content"
          />
          {open ? (
            <div className={css.requirementBody} data-requirement-body>
              <MarkdownText text={body} labels={labels} />
              {usingDocument || proposal === undefined || proposal.options.length === 0 ? null : (
                <ul className={css.requirementOptions} data-requirement-options>
                  {proposal.options.map(option => (
                    <li key={option.name} className={css.requirementOption} data-requirement-option>
                      <span className={css.requirementOptionName}>{option.name}</span>
                      {option.summary === '' ? null : (
                        <p className={css.requirementOptionSummary}>{option.summary}</p>
                      )}
                      {option.cost === '' ? null : (
                        <p className={css.requirementOptionCost}>
                          {t('shell.requirementOptionCost')}{option.cost}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {usingDocument || proposal === undefined || proposal.recommendation === '' ? null : (
                <p className={css.requirementRecommendation} data-requirement-recommendation>
                  <span className={css.requirementRecommendationLabel}>{t('shell.requirementRecommendation')}</span>
                  {proposal.recommendation}
                </p>
              )}
              <p className={css.requirementMetaLine}>
                {t('shell.difficulty')}：{task.grade}
                {' · '}
                {t('shell.rules')}：{task.rules.join('、') || '—'}
              </p>
            </div>
          ) : (
            <p className={css.requirementPreview} data-requirement-preview>{preview || t('shell.noDescription')}</p>
          )}
        </section>
        <section className={css.requirementContent} data-requirement-answers>
          <SectionHead
            t={t}
            title={t('shell.requirementAnswers')}
            open={answersOpen}
            onToggle={() => { setAnswersOpen(value => !value) }}
            testId="answers"
          />
          {answersOpen ? (
            answers.length === 0 ? (
              <p className={css.requirementPreview} data-requirement-answers-empty>
                {t('shell.requirementAnswersEmpty')}
              </p>
            ) : (
              <ol className={`${css.requirementBody} ${css.requirementAnswerList}`}>
                {answers.map(item => (
                  <li key={item.id} className={css.requirementAnswer} data-requirement-answer>
                    <p className={css.requirementAnswerQuestion}>
                      {item.header === undefined ? null : (
                        <span className={css.requirementAnswerHeader}>{item.header}</span>
                      )}
                      {item.question}
                    </p>
                    <p className={css.requirementAnswerValue}>{item.answer}</p>
                  </li>
                ))}
              </ol>
            )
          ) : (
            <p className={css.requirementPreview} data-requirement-answers-preview>
              {answers.length === 0
                ? t('shell.requirementAnswersEmpty')
                : t('shell.requirementAnswersCount', { count: `${answers.length}` })}
            </p>
          )}
        </section>
        {error === null ? null : <p className={css.problem}>{error}</p>}
      </div>
      <div className={css.modalFoot}>
        <div className={css.spacer} />
        <button type="button" className={css.secondaryBtn} onClick={onClose}>
          {t('shell.close')}
        </button>
        <button
          type="button"
          className={css.primaryBtn}
          data-requirement-split
          disabled={splitting}
          onClick={onSplit}
        >
          {splitting ? t('shell.splittingTasks') : t('shell.splitTasks')}
        </button>
      </div>
    </div>
  )
}
