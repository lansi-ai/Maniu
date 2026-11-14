/**
 * 需求详情抽屉：完整需求文档、立项问答、关联任务与讨论历史入口，按状态给动作。
 *
 * 抽屉只排版与派发动作：确认、发布、关闭各派一条人机命令，拆分把完整正文交给外壳；
 * 失败原文就地显示，不改写成成功。状态文案由调用方按九态词典传入。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementDocRow } from '../projection.ts'
import type { ShellSignResult, ShellTask } from './shell-data.ts'
import type { RequirementAnswer } from './requirement.ts'
import type { RequirementProgressId } from './requirement-page.ts'
import { REQUIREMENT_PROGRESS_LABEL, isRequirementId } from './requirement-page.ts'
import { DeliverableView } from './DeliverableView.tsx'
import { useMarkdownLabels } from './ChatPanel.tsx'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 拆分流程当前段；与 `requirement-split.ts` 的阶段一一对应。 */
export interface RequirementSplitFlowView {
  readonly status: 'running' | 'done' | 'failed'
  readonly stage?: 'pm'
  /** 这次拆出的任务；还没拆完时为空。 */
  readonly newTasks: readonly { readonly id: string; readonly title: string }[]
  /** 完成后的新增条数与按轨分布；失败时也可带已拆出的任务。 */
  readonly summary?: {
    readonly taskCount: number
    readonly tracks: readonly { readonly name: string; readonly count: number }[]
  }
  /** 失败原文；完成时为 undefined。 */
  readonly errorText?: string
}

/** 讨论历史抽屉的展示数据；发言原文按角色分组。 */
export interface DiscussionHistoryView {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed'
  readonly groups: readonly {
    readonly roleId: string
    readonly roleName: string
    readonly statements: readonly string[]
  }[]
  /** 读取或定位失败的原话；成功时为 undefined。 */
  readonly error?: string
}

/** 详情里一次人机动作的在途种类。 */
export type RequirementAction = 'approve' | 'release' | 'cancel'

/** 需求详情抽屉的 props。 */
export interface RequirementDetailProps {
  readonly t: Translate
  readonly row: RequirementDocRow
  readonly progress: RequirementProgressId
  readonly tasks: readonly ShellTask[]
  /** 从当前会话读出的立项问答；读不到时为空数组。 */
  readonly answers: readonly RequirementAnswer[]
  /** 拆分指令发送在途。 */
  readonly splitting: boolean
  /** 拆分流程的当前状态；没有跑过时为 undefined。 */
  readonly splitFlow?: RequirementSplitFlowView | null
  /** 就地错误原文；没有时为 null。 */
  readonly error: string | null
  /** 人机命令在途；对应按钮禁用。 */
  readonly actionBusy: RequirementAction | null
  /** 人机命令的最新回执；成功与失败都原样显示。 */
  readonly actionResult: ShellSignResult | null
  /** 任务状态与轨的显示名。 */
  readonly taskStateLabel: (task: ShellTask) => string
  readonly trackLabel: (track: string | undefined) => string
  readonly onClose: () => void
  readonly onApprove: () => void
  readonly onSplit: () => void
  readonly onRelease: () => void
  readonly onCancel: () => void
  readonly onOpenTask: (taskId: string) => void
  /** 点交付文档路径时打开预览；不传时只显示路径。 */
  readonly onOpenDoc?: (doc: string) => void
  /** 在阅读器里打开完整需求文档；不传时只保留内联预览。 */
  readonly onOpenRequirementDoc?: () => void
  /** 讨论历史抽屉是否打开与它的数据；不传时入口仍可点，抽屉不画。 */
  readonly historyOpen: boolean
  readonly history: DiscussionHistoryView
  readonly onOpenHistory: () => void
  readonly onCloseHistory: () => void
}

/** 九个进度里可执行的动作；旧流程纯文档需求没有可执行动作。 */
function actionsOf(progress: RequirementProgressId, id: string): {
  readonly approve: boolean
  readonly split: boolean
  readonly release: boolean
  readonly cancel: boolean
} {
  if (!isRequirementId(id)) return { approve: false, split: false, release: false, cancel: false }
  switch (progress) {
    case 'incomplete':
    case 'pending':
      return { approve: true, split: false, release: false, cancel: true }
    case 'confirmed':
      return { approve: false, split: true, release: true, cancel: true }
    case 'split':
    case 'developing':
    case 'testing':
    case 'ready-release':
      return { approve: false, split: false, release: true, cancel: true }
    case 'released':
    case 'cancelled':
      return { approve: false, split: false, release: false, cancel: false }
  }
}

/** 拆分流程区：阶段、已拆出的任务、完成后的条数与按轨分布。 */
function SplitFlowSection({ t, flow }: { readonly t: Translate; readonly flow: RequirementSplitFlowView }): ReactNode {
  const newTaskIds = flow.newTasks.map(task => task.id).join('、')
  const trackText = flow.summary === undefined
    ? ''
    : flow.summary.tracks.map(item => `${item.name} ${item.count}`).join('、')
  return (
    <section className={css.requirementSplitFlow} data-requirement-split-flow>
      {flow.status === 'running' ? (
        <p className={css.requirementSplitPhase} data-requirement-split-phase>{t('shell.splitPmRunning')}</p>
      ) : null}
      {flow.newTasks.length === 0 ? null : (
        <p className={css.requirementSplitTasks} data-requirement-split-tasks>
          {t('shell.splitNewTasks', { count: `${flow.newTasks.length}`, tasks: newTaskIds })}
        </p>
      )}
      {flow.status === 'done' && flow.summary !== undefined ? (
        <p className={css.requirementSplitSummary} data-requirement-split-summary>
          {t('shell.splitResult', { tasks: `${flow.summary.taskCount}` })}
        </p>
      ) : null}
      {flow.status === 'done' && trackText !== '' ? (
        <p className={css.requirementSplitTasks} data-requirement-split-tracks>
          {t('shell.splitTracks', { tracks: trackText })}
        </p>
      ) : null}
    </section>
  )
}

/**
 * 画需求详情抽屉。
 * @param props - 需求行、关联任务、问答、拆分与命令状态，以及全部动作。
 * @returns 抽屉内容；由外壳放进模态容器。
 */
export function RequirementDetail({
  t, row, progress, tasks, answers, splitting, splitFlow, error, actionBusy, actionResult,
  taskStateLabel, trackLabel, onClose, onApprove, onSplit, onRelease, onCancel, onOpenTask,
  onOpenDoc, onOpenRequirementDoc, historyOpen, history, onOpenHistory, onCloseHistory,
}: RequirementDetailProps): ReactNode {
  const labels = useMarkdownLabels(t)
  const actions = actionsOf(progress, row.id)
  const body = row.text.trim()
  const delivered = tasks.filter(task => task.deliverable !== undefined)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (historyOpen) onCloseHistory()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [historyOpen, onClose, onCloseHistory])
  return (
    <div className={css.requirementCard} data-requirement-detail={row.id}>
      <div className={css.modalHead}>
        <div className={css.grow}>
          <h3 className={css.requirementTitle} data-requirement-detail-title>
            {`${row.id} · ${row.title ?? t('shell.requirementUntitled')}`}
          </h3>
          <p className={css.requirementMetaLine}>{t('shell.requirementDetailHint')}</p>
        </div>
        <span className={css.pill} data-requirement-detail-state={progress}>{t(REQUIREMENT_PROGRESS_LABEL[progress])}</span>
        <button type="button" className={css.iconBtn} aria-label={t('shell.close')} onClick={onClose}>✕</button>
      </div>
      <div className={css.modalBody}>
        <section className={css.requirementContent} data-requirement-document>
          <div className={css.requirementContentHead}>
            <span className={css.requirementContentTitle}>{t('shell.requirementContent')}</span>
            {body === '' || onOpenRequirementDoc === undefined ? null : (
              <button
                type="button"
                className={css.requirementMore}
                data-requirement-document-reader
                onClick={onOpenRequirementDoc}
              >
                {t('shell.requirementOpenReader')}
              </button>
            )}
          </div>
          {body === '' ? (
            <p className={css.requirementPreview} data-requirement-document-empty>{t('shell.requirementDocumentMissing')}</p>
          ) : (
            <div className={`${css.requirementBody} ${css.requirementBodyTall}`} data-requirement-document-body>
              <MarkdownText text={body} labels={labels} />
            </div>
          )}
          {row.options.length === 0 ? null : (
            <ul className={css.requirementOptions} data-requirement-options>
              {row.options.map(option => (
                <li key={`${option.name}-${option.summary}`} className={css.requirementOption}>
                  <span className={css.requirementOptionName}>{option.name}</span>
                  {option.summary === '' ? null : <p className={css.requirementOptionSummary}>{option.summary}</p>}
                  {option.cost === undefined || option.cost === '' ? null : (
                    <p className={css.requirementOptionCost}>{t('shell.requirementOptionCost')}{option.cost}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {row.recommendation === undefined || row.recommendation === '' ? null : (
            <p className={css.requirementRecommendation} data-requirement-recommendation>
              <span className={css.requirementRecommendationLabel}>{t('shell.requirementRecommendation')}</span>
              {row.recommendation}
            </p>
          )}
          {isRequirementId(row.id) ? null : (
            <p className={css.requirementPreview} data-requirement-legacy>{t('shell.requirementLegacyReadonly')}</p>
          )}
        </section>

        <section className={css.requirementContent} data-requirement-answers>
          <div className={css.requirementContentHead}>
            <span className={css.requirementContentTitle}>{t('shell.requirementAnswers')}</span>
          </div>
          {answers.length === 0 ? (
            <p className={css.requirementPreview} data-requirement-answers-empty>{t('shell.requirementAnswersEmpty')}</p>
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
          )}
        </section>

        <section className={css.requirementContent} data-requirement-related-tasks>
          <div className={css.requirementContentHead}>
            <span className={css.requirementContentTitle}>{t('shell.requirementRelatedTasks')}</span>
            <span className={css.requirementMetaLine}>{t('shell.requirementTaskCount', { count: `${tasks.length}` })}</span>
          </div>
          {tasks.length === 0
            ? <p className={css.requirementPreview} data-requirement-related-empty>{t('shell.requirementNoTasks')}</p>
            : (
              <ul className={css.requirementTaskList}>
                {tasks.map(task => (
                  <li key={task.id} className={css.requirementTaskRow} data-requirement-task={task.id}>
                    <button
                      type="button"
                      className={css.requirementTaskOpen}
                      onClick={() => { onOpenTask(task.id) }}
                    >
                      <span className={css.requirementTaskId}>{task.id}</span>
                      <span className={css.requirementTaskTitle}>{task.title}</span>
                    </button>
                    <span className={css.tag}>{taskStateLabel(task)}</span>
                    {task.track === undefined ? null : <span className={css.tag}>{trackLabel(task.track)}</span>}
                  </li>
                ))}
              </ul>
            )}
        </section>

        {delivered.length === 0 ? null : (
          <section className={css.requirementContent} data-requirement-deliverables>
            <div className={css.requirementContentHead}>
              <span className={css.requirementContentTitle}>{t('shell.requirementDeliverables')}</span>
              <span className={css.requirementMetaLine}>{t('shell.requirementTaskCount', { count: `${delivered.length}` })}</span>
            </div>
            <div className={css.deliverableStack}>
              {delivered.map(task => (
                <DeliverableView
                  key={task.id}
                  t={t}
                  taskId={task.id}
                  {...(task.deliverable === undefined ? {} : { deliverable: task.deliverable })}
                  required={false}
                  showHeading={false}
                  onOpenTask={onOpenTask}
                  {...(onOpenDoc === undefined ? {} : { onOpenDoc })}
                />
              ))}
            </div>
          </section>
        )}

        {splitFlow === undefined || splitFlow === null ? null : <SplitFlowSection t={t} flow={splitFlow} />}
        {error === null ? null : <p className={css.problem} data-requirement-detail-error>{error}</p>}
      </div>
      <div className={css.modalFoot}>
        <button
          type="button"
          className={css.secondaryBtn}
          data-requirement-history
          onClick={onOpenHistory}
        >
          {t('shell.discussionHistory')}
        </button>
        <div className={css.spacer} />
        {actions.cancel
          ? (
            <button
              type="button"
              className={css.secondaryBtn}
              data-requirement-cancel
              disabled={actionBusy !== null || splitting}
              onClick={onCancel}
            >
              {actionBusy === 'cancel' ? t('shell.requirementActionRunning') : t('shell.requirementClose')}
            </button>
          )
          : null}
        {actions.approve
          ? (
            <button
              type="button"
              className={css.primaryBtn}
              data-requirement-approve
              disabled={actionBusy !== null || splitting}
              onClick={onApprove}
            >
              {actionBusy === 'approve' ? t('shell.requirementActionRunning') : t('shell.confirmRequirement')}
            </button>
          )
          : null}
        {actions.split
          ? (
            <button
              type="button"
              className={css.primaryBtn}
              data-requirement-split
              disabled={splitting || actionBusy !== null}
              onClick={onSplit}
            >
              {splitting ? t('shell.splittingTasks') : t('shell.splitTasks')}
            </button>
          )
          : null}
        {actions.release
          ? (
            <button
              type="button"
              className={css.primaryBtn}
              data-requirement-release
              disabled={actionBusy !== null || splitting}
              onClick={onRelease}
            >
              {actionBusy === 'release' ? t('shell.requirementActionRunning') : t('shell.requirementRelease')}
            </button>
          )
          : null}
        <button
          type="button"
          className={css.secondaryBtn}
          data-requirement-drawer-close
          onClick={onClose}
        >
          {t('shell.close')}
        </button>
      </div>
      {actionResult === null ? null : (
        <p
          className={actionResult.ok ? css.requirementPreview : css.problem}
          data-requirement-action-result
        >
          {actionResult.text}
        </p>
      )}
      {historyOpen ? (
        <div
          className={css.requirementHistoryBackdrop}
          data-discussion-history
          onClick={(event) => { if (event.target === event.currentTarget) onCloseHistory() }}
        >
          <aside
            className={css.requirementHistoryPanel}
            role="dialog"
            aria-modal="true"
            aria-label={t('shell.historyTitle')}
          >
            <div className={css.requirementHistoryHead}>
              <h4 className={css.requirementHistoryTitle}>{t('shell.historyTitle')}</h4>
              <button
                type="button"
                className={css.iconBtn}
                aria-label={t('shell.historyClose')}
                onClick={onCloseHistory}
              >✕</button>
            </div>
            <div className={css.requirementHistoryBody}>
              {history.status === 'loading' || history.status === 'idle' ? (
                <p className={css.requirementPreview}>{t('shell.historyLoading')}</p>
              ) : null}
              {history.status === 'failed' ? (
                <p className={css.problem} data-discussion-history-error>{history.error}</p>
              ) : null}
              {history.status === 'ready' && history.groups.length === 0 ? (
                <p className={css.requirementPreview}>{t('shell.historyEmpty')}</p>
              ) : null}
              {history.status === 'ready'
                ? history.groups.map(group => (
                  <section key={group.roleId} className={css.requirementHistoryGroup} data-discussion-history-group={group.roleId}>
                    <h5 className={css.requirementHistoryRole}>{group.roleName}</h5>
                    {group.statements.map((statement, index) => (
                      <p key={`${group.roleId}-${String(index)}`} className={css.requirementHistoryStatement}>{statement}</p>
                    ))}
                  </section>
                ))
                : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
