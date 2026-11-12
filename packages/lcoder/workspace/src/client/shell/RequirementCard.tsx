/**
 * 需求确认卡片：需求编号、创建人、创建时间、默认折叠的需求文档与立项问答，以及拆分任务。
 *
 * 需求文档优先取 `.spec/requirements/<方案编号>.md` 的完整正文；没有该文件时退回
 * 立项会话里的《项目需求概要》，再退回任务回指方案的 `problem`，最后用任务自己的
 * description。方案候选与推荐只在没有完整需求文档时展示。拆分时把已读到的完整需求
 * 文档交给外壳，指令以它作为拆分依据。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProposalRow, RequirementDocRow } from '../projection.ts'
import type { ShellTask } from './shell-data.ts'
import type { RequirementAnswer } from './requirement.ts'
import { formatOpenedAt } from './requirement.ts'
import { useMarkdownLabels } from './ChatPanel.tsx'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 拆分流程停在的段；与 `requirement-split.ts` 的阶段一一对应。 */
export type RequirementSplitStageView = 'pm' | 'manager' | 'assigning' | 'readying'

/** 卡片要画的一次拆分流程；文案已由外壳按词典拼好，卡片只排版。 */
export interface RequirementSplitFlowView {
  readonly status: 'running' | 'done' | 'failed'
  readonly stage?: RequirementSplitStageView
  /** 这次拆出的任务；还没拆完时为空。 */
  readonly newTasks: readonly { readonly id: string; readonly title: string }[]
  /** 完成后的计数与失败明细；失败时也可以带已拆出的任务。 */
  readonly summary?: {
    readonly taskCount: number
    readonly assignedCount: number
    /** 成功进入待开发（contracted）的条数。 */
    readonly readyCount: number
    /** 逐条失败或未分配的说明，已本地化。 */
    readonly lines: readonly string[]
  }
  /** 失败原文；完成时为 undefined。 */
  readonly errorText?: string
}

/** 需求卡片要的任务、方案、问答与动作。 */
export interface RequirementCardProps {
  readonly t: Translate
  readonly task: ShellTask
  /** 任务回指的需求文档（`.spec/requirements/<方案编号>.md`）；没有文件时为 undefined。 */
  readonly requirementDocument?: RequirementDocRow | undefined
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
  /** 拆分与分配流程的当前状态；没有跑过时为 undefined。 */
  readonly flow?: RequirementSplitFlowView | null
  readonly onClose: () => void
  /**
   * 拆分动作；参数是卡片已读到的完整需求文档，没有落盘文件时为 undefined，
   * 由外壳退回任务与方案文本。
   */
  readonly onSplit: (requirementDocument: RequirementDocRow | undefined) => void
  /** 完成后回看板；不传时不画这个入口。 */
  readonly onViewBoard?: () => void
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

/** 运行中那一段的文案：没有阶段时按最早的「项目经理拆分中」画。 */
function runningStageText(t: Translate, stage: RequirementSplitStageView | undefined): string {
  if (stage === 'manager') return t('shell.splitManagerRunning')
  if (stage === 'assigning') return t('shell.splitAssigning')
  if (stage === 'readying') return t('shell.splitReadying')
  return t('shell.splitPmRunning')
}

/** 拆分流程区：阶段、已拆出的任务、完成后的计数与失败明细。 */
function SplitFlowSection({ t, flow }: { readonly t: Translate; readonly flow: RequirementSplitFlowView }): ReactNode {
  const newTaskIds = flow.newTasks.map(task => task.id).join('、')
  return (
    <section className={css.requirementSplitFlow} data-requirement-split-flow>
      {flow.status === 'running' ? (
        <p className={css.requirementSplitPhase} data-requirement-split-phase>
          {runningStageText(t, flow.stage)}
        </p>
      ) : null}
      {flow.newTasks.length === 0 ? null : (
        <p className={css.requirementSplitTasks} data-requirement-split-tasks>
          {t('shell.splitNewTasks', { count: `${flow.newTasks.length}`, tasks: newTaskIds })}
        </p>
      )}
      {flow.status === 'done' && flow.summary !== undefined ? (
        <p className={css.requirementSplitSummary} data-requirement-split-summary>
          {t('shell.splitResult', {
            tasks: `${flow.summary.taskCount}`,
            assigned: `${flow.summary.assignedCount}`,
            ready: `${flow.summary.readyCount}`,
          })}
        </p>
      ) : null}
      {flow.summary === undefined || flow.summary.lines.length === 0 ? null : (
        <ul className={css.requirementSplitFailures} data-requirement-split-failures>
          {flow.summary.lines.map(line => <li key={line}>{line}</li>)}
        </ul>
      )}
    </section>
  )
}

/**
 * 画一张需求卡片。
 * @param props - 任务、方案、问答、在途与错误、关闭与拆分动作。
 * @returns 卡片内容；由外壳放在既有模态容器里。
 */
export function RequirementCard({
  t, task, requirementDocument, document, proposal, answers, splitting, error, flow, onClose, onSplit, onViewBoard,
}: RequirementCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [answersOpen, setAnswersOpen] = useState(false)
  const labels = useMarkdownLabels(t)
  // 优先展示落盘的需求文档，其次会话里的需求概要；两者都没有才用方案正文或任务描述。
  const fileText = requirementDocument?.text ?? ''
  const summaryText = document ?? ''
  const fullText = fileText !== '' ? fileText : summaryText !== '' ? summaryText : undefined
  const body = fullText ?? (proposal === undefined ? task.description : proposal.problem)
  const usingDocument = fullText !== undefined
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
        {flow === undefined || flow === null ? null : <SplitFlowSection t={t} flow={flow} />}
        {error === null ? null : <p className={css.problem}>{error}</p>}
      </div>
      <div className={css.modalFoot}>
        <div className={css.spacer} />
        {flow?.status === 'done' && onViewBoard !== undefined ? (
          <button type="button" className={css.secondaryBtn} data-requirement-board onClick={onViewBoard}>
            {t('shell.splitViewBoard')}
          </button>
        ) : null}
        <button type="button" className={css.secondaryBtn} onClick={onClose}>
          {t('shell.close')}
        </button>
        <button
          type="button"
          className={css.primaryBtn}
          data-requirement-split
          disabled={splitting}
          onClick={() => { onSplit(requirementDocument) }}
        >
          {splitting ? t('shell.splittingTasks') : t('shell.splitTasks')}
        </button>
      </div>
    </div>
  )
}
