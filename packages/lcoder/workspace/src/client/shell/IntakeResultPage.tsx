/**
 * 立项结果页：立项分析落在 `.spec` 里的方案、任务与项目信息。
 *
 * 这是一张独立页，不是弹窗——看板选中它以后整块让位，页头只留「返回看板」与
 * 「重新开始」。方案默认展示编号最大的那份，其余可切换；任务按文件事实全量列出，
 * 指回当前方案的标注出来，缺 `proposal` 字段的任务不因此被藏掉。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProposalRow } from '../projection.ts'
import type { ShellProjectInfo, ShellTask } from './shell-data.ts'
import { SHELL_STATES } from './shell-data.ts'
import { latestProposal, PROPOSAL_DECISION } from './intake.ts'
import type { IntakeArtifacts } from './intake.ts'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 结果页的动作：返回看板、重新开始、走两档立项入口。 */
export interface IntakeResultPageProps {
  readonly t: Translate
  readonly proposals: readonly ProposalRow[]
  readonly tasks: readonly ShellTask[]
  readonly info: ShellProjectInfo | null
  readonly problems: readonly string[]
  readonly modelBlocked: boolean
  /** 认出了立项档位才能重开；false 时按钮仍显示，只说明原因。 */
  readonly canRestart: boolean
  readonly onBack: () => void
  readonly onRestart: () => void
  readonly onStartOnboarding: (kind: 'new' | 'docs') => void
}

/** 任务状态的中文/英文标签；越出五态时原样显示文件里的值。 */
function stateLabel(task: ShellTask, t: Translate): string {
  const state = SHELL_STATES.find(row => row.id === task.state)
  return state === undefined ? task.state : t(state.labelKey)
}

/**
 * 画一张独立的结果页。
 * @param props - 投影结果、项目信息与页面动作。
 * @returns 结果页；没有方案时按空态或投影问题渲染。
 */
export function IntakeResultPage({
  t, proposals, tasks, info, problems, modelBlocked, canRestart, onBack, onRestart, onStartOnboarding,
}: IntakeResultPageProps): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = proposals.find(row => row.id === selectedId) ?? latestProposal(proposals)

  return (
    <div className={css.intakePage} data-lcoder-intake-result>
      <div className={css.intakeHead}>
        <button type="button" className={css.secondaryBtn} onClick={onBack}>
          ← {t('shell.backToBoard')}
        </button>
        <div className={css.grow}>
          <h2>{t('shell.intakeResult')}</h2>
          <p className={css.intakeHeadHint}>{t('shell.intakeResultHint')}</p>
        </div>
        <button
          type="button"
          className={css.primaryBtn}
          disabled={!canRestart}
          title={canRestart ? undefined : t('shell.restartIntakeUnknown')}
          onClick={onRestart}
        >
          {t('shell.restartIntake')}
        </button>
      </div>

      {proposals.length === 0
        ? (problems.length === 0
          ? (
            <section className={css.intakeSection}>
              <h3>{t('shell.resultNoProposal')}</h3>
              <p className={css.intakeMuted}>{t('shell.resultNoProposalHint')}</p>
              <div className={css.onboardingBar}>
                <button
                  type="button"
                  className={css.secondaryBtn}
                  disabled={modelBlocked}
                  title={modelBlocked ? t('shell.noModels') : undefined}
                  onClick={() => { onStartOnboarding('docs') }}
                >
                  {t('shell.onboardingExistingDocs')}
                </button>
                <button
                  type="button"
                  className={css.primaryBtn}
                  disabled={modelBlocked}
                  title={modelBlocked ? t('shell.noModels') : undefined}
                  onClick={() => { onStartOnboarding('new') }}
                >
                  {t('shell.onboardingNewProject')}
                </button>
              </div>
            </section>
          )
          : (
            <section className={css.intakeSection}>
              <h3>{t('shell.resultProposalReadFailed')}</h3>
              {problems.map(problem => <p key={problem} className={css.problem}>{problem}</p>)}
            </section>
          ))
        : selected === undefined
          ? null
          : (
            <>
              <section className={css.intakeSection}>
                <div className={css.intakeProposalBar}>
                  {proposals.map((row) => {
                    const active = row.id === selected.id
                    return (
                      <button
                        type="button"
                        key={row.id}
                        className={`${css.filterChip} ${active ? css.filterChipActive : ''}`}
                        data-intake-proposal={row.id}
                        aria-pressed={active}
                        onClick={() => { setSelectedId(row.id) }}
                      >
                        {row.id}
                      </button>
                    )
                  })}
                  <span className={css.intakeMuted}>
                    {t('shell.resultProposalCount', { count: proposals.length })}
                  </span>
                </div>
                <h3 className={css.intakeTitle} data-intake-proposal-title>{selected.title}</h3>
                <div className={css.intakeField}>
                  <span className={css.intakeFieldK}>{t('shell.proposalProblem')}</span>
                  <span className={css.intakeFieldV}>{selected.problem}</span>
                </div>
                <div className={css.intakeField}>
                  <span className={css.intakeFieldK}>{t('shell.proposalOptions')}</span>
                  {selected.options.length === 0
                    ? <span className={css.intakeMuted}>{t('shell.resultNoOptions')}</span>
                    : (
                      <div className={css.intakeOptions}>
                        {selected.options.map(option => (
                          <div key={`${option.name}-${option.summary}`} className={css.intakeOption}>
                            <div className={css.intakeOptionHead}>
                              <span className={css.intakeOptionName}>{option.name}</span>
                              {option.cost === '' ? null : <span className={css.intakeOptionCost}>{option.cost}</span>}
                            </div>
                            {option.summary === '' ? null : <span className={css.intakeMuted}>{option.summary}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                <div className={css.intakeField}>
                  <span className={css.intakeFieldK}>{t('shell.proposalRecommendation')}</span>
                  <span className={css.intakeFieldV}>{selected.recommendation}</span>
                </div>
                <div className={css.infoRow}>
                  <span>{t('shell.resultDecision')}</span>
                  <b>
                    {t(PROPOSAL_DECISION[selected.decision])}
                    {selected.decidedAt === null ? '' : ` · ${selected.decidedAt}`}
                  </b>
                </div>
              </section>

              <section className={css.intakeSection}>
                <h3>{t('shell.resultDraftedTasks')}</h3>
                {tasks.length === 0
                  ? <p className={css.intakeMuted}>{t('shell.resultNoTasks')}</p>
                  : (
                    <div className={css.intakeList}>
                      {tasks.map(task => (
                        <div key={task.id} className={css.intakeTask} data-intake-task={task.id}>
                          <span className={css.intakeTaskId}>{task.id}</span>
                          <span className={css.intakeTaskTitle}>{task.title}</span>
                          {task.proposal === selected.id
                            ? <span className={`${css.tag} ${css.tagOk}`}>{t('shell.resultTaskOfProposal')}</span>
                            : null}
                          <span className={css.tag}>{stateLabel(task, t)}</span>
                        </div>
                      ))}
                    </div>
                  )}
              </section>

              <section className={css.intakeSection}>
                <h3>{t('shell.projectInfo')}</h3>
                {info === null
                  ? <p className={css.intakeMuted}>{t('shell.resultProjectMissing')}</p>
                  : (
                    <>
                      <div className={css.infoRow}><span>{t('shell.kind')}</span><b>{info.kind}</b></div>
                      <div className={css.infoRow}><span>{t('shell.repoUrl')}</span><b>{info.repoUrl === '' ? '—' : info.repoUrl}</b></div>
                      <div className={css.infoRow}><span>{t('shell.branch')}</span><b>{info.branch}</b></div>
                      <div className={css.infoRow}><span>{t('shell.productDoc')}</span><code>{info.docs.product || '—'}</code></div>
                      <div className={css.infoRow}><span>{t('shell.architectureDoc')}</span><code>{info.docs.architecture || '—'}</code></div>
                      <div className={css.infoRow}><span>{t('shell.tests')}</span><code>{info.docs.tests || '—'}</code></div>
                    </>
                  )}
              </section>

              {problems.length === 0 ? null : (
                <section className={css.intakeSection}>
                  <h3>{t('shell.problems')}</h3>
                  {problems.map(problem => <p key={problem} className={css.problem}>{problem}</p>)}
                </section>
              )}
            </>
          )}
    </div>
  )
}

/** 「重新开始」确认框的 props。 */
export interface IntakeRestartDialogProps {
  readonly t: Translate
  readonly artifacts: IntakeArtifacts
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/**
 * 重开前的确认框：如实列出已有产物，并说明不会清空任何落盘内容。
 * @param props - 计数、在途状态与两个动作。
 * @returns 确认框。
 */
export function IntakeRestartDialog({
  t, artifacts, busy, onCancel, onConfirm,
}: IntakeRestartDialogProps): ReactNode {
  return (
    <div
      className={css.modalBackdrop}
      data-lcoder-intake-restart
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}
    >
      <div className={`${css.modal} ${css.modalSmall}`} role="dialog" aria-modal="true">
        <div className={css.modalHead}>
          <div className={css.grow}>
            <h3>{t('shell.restartIntakeTitle')}</h3>
            <p>{t('shell.restartIntakeHint')}</p>
          </div>
          <button type="button" className={css.iconBtn} disabled={busy} onClick={onCancel}>✕</button>
        </div>
        <div className={css.modalBody}>
          <div className={css.infoRow}>
            <span>{t('shell.restartProject')}</span>
            <b data-restart-project>
              {artifacts.projectRegistered ? t('shell.restartRegistered') : t('shell.restartUnregistered')}
            </b>
          </div>
          <div className={css.infoRow}><span>{t('shell.restartRules')}</span><b data-restart-rules>{artifacts.rules}</b></div>
          <div className={css.infoRow}><span>{t('shell.restartTasks')}</span><b data-restart-tasks>{artifacts.tasks}</b></div>
          <div className={css.infoRow}><span>{t('shell.restartDrafting')}</span><b data-restart-drafting>{artifacts.drafting}</b></div>
          <div className={css.infoRow}><span>{t('shell.restartProposals')}</span><b data-restart-proposals>{artifacts.proposals}</b></div>
          <p className={css.secretRef}>{t('shell.restartKeep')}</p>
        </div>
        <div className={css.modalFoot}>
          <div className={css.spacer} />
          <button type="button" className={css.secondaryBtn} disabled={busy} onClick={onCancel}>
            {t('shell.cancel')}
          </button>
          <button type="button" className={css.primaryBtn} disabled={busy} onClick={onConfirm}>
            {busy ? t('shell.restarting') : t('shell.restartConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
