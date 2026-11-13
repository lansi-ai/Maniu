/**
 * 「全新项目」的需求分析师向导：首页、提问层、思考提示与结果卡。
 *
 * 组件只画传入的阶段与事实：阶段由 {@link intakeWizardPhase} 从会话事实算出，
 * 提问卡的结算仍交给上游 `pending.answer()`，确认需求仍由外壳派 `/requirement_approve`。
 * 右栏活动区只在提问与结果阶段挂载；思考阶段把它收进左栏，弹窗同时收敛成单栏。
 * 思考与结束状态并进分析师头行，不再单独立一块面板。
 * 这里不新建会话、不发提示、也不记阶段。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementDocRow } from '../projection.ts'
import { REQUIREMENT_PROGRESS_LABEL } from './requirement-page.ts'
import type { ShellProcessItem, ShellSignResult, ShellTask } from './shell-data.ts'
import type { ShellSessionNotice } from '../model-status.ts'
import type { ShellQuestionPending } from './pending.ts'
import type { IntakeModelOption, IntakeResultView, IntakeWizardPhase } from './intake-wizard.ts'
import { cloudErrorKey } from '../cloud/errors.ts'
import { ProcessList, QuestionCard, useMarkdownLabels } from './ChatPanel.tsx'
import bullMark from '../assets/bull-mark.png'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 向导里模型目录的读取状态。 */
export type IntakeModelState = 'idle' | 'loading' | 'ready' | 'error'

/** 需求分析师向导的 props。 */
export interface IntakeWizardProps {
  readonly t: Translate
  readonly phase: IntakeWizardPhase
  /** 就地错误：门禁、发送或采纳失败的原话。 */
  readonly error: string | null
  /** 当前待答问题；不在提问层时为 null。 */
  readonly question: ShellQuestionPending | null
  /** 摊平后的思考与工具过程。 */
  readonly processItems: readonly ShellProcessItem[]
  readonly modelState: IntakeModelState
  readonly models: readonly IntakeModelOption[]
  readonly selectedModel: IntakeModelOption | null
  /** 宿主侧没有可跑模型；确认按钮随之禁用并说明原因。 */
  readonly modelBlocked: boolean
  /** 立项咒语发送在途。 */
  readonly sending: boolean
  /** 结果卡展示的需求；投影还没读到时为 null。 */
  readonly requirement: RequirementDocRow | null
  /** 结果卡画哪一种内容：需求、本轮聊天概要、已确认落盘，或需求还没读出来。 */
  readonly result: IntakeResultView
  /** 最后一条非空助手答复；只在本轮没有方案时当概要展示。 */
  readonly summary: string | null
  /** 会话里是否已经确认过需求；确认按钮据此置为已确认且不再发送。 */
  readonly confirmed: boolean
  /** 确认需求消息发送在途。 */
  readonly confirming: boolean
  /** 项目或任务是否已落盘；已确认且落盘时结果卡直接给去看板。 */
  readonly landed: boolean
  /** 向导会话最近一次失败；确认轮失败时用来显示原因。 */
  readonly notice: ShellSessionNotice | null
  /** 投影里的全部任务；结果卡按 `requirement` 回指过滤出本轮草案。 */
  readonly tasks: readonly ShellTask[]
  /** 界面展示的这一轮是否还在跑；已含结束态沉降窗口，据此决定 loading 转不转、给不给重开入口。 */
  readonly running: boolean
  readonly approving: boolean
  readonly approveResult: ShellSignResult | null
  /** 宿主提供采纳命令且当前有会话；缺任一项时按钮禁用。 */
  readonly canApprove: boolean
  readonly restartBusy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly onSelectModel: (option: IntakeModelOption) => void
  /** 补读或重试模型目录；向导打开时外壳已经读过，展开高级配置不会重复请求。 */
  readonly onLoadModels: () => void
  readonly onOpenSettings: () => void
  readonly onApprove: () => void
  /** 概要路径的确认：向同一会话发「确认需求」，不采纳方案。 */
  readonly onConfirmNeed: () => void
  /** 确认轮失败后的显式重试；不受已确认去重限制。 */
  readonly onRetry: () => void
  /** 已确认且已落盘时回看板。 */
  readonly onOpenBoard: () => void
  /** 第二轮讨论指令发送在途；菜单项据此禁用。 */
  readonly discussing: boolean
  /** 结果卡「更多讨论」：同一会话再发一条讨论指令，不重开、不登记。 */
  readonly onDiscuss: () => void
  readonly onRestart: () => void
}

/**
 * 画需求分析师向导当前阶段。
 * @param props - 阶段、会话事实与全部动作回调。
 * @returns 向导面板；`closed` 阶段不画任何东西。
 */
export function IntakeWizard({
  t, phase, error, question, processItems, modelState, models, selectedModel, modelBlocked, sending,
  requirement, result, summary, confirmed, confirming, landed, notice, tasks, running, approving, approveResult, canApprove,
  restartBusy, discussing, onCancel, onConfirm, onSelectModel, onLoadModels, onOpenSettings, onApprove, onConfirmNeed, onRetry,
  onOpenBoard, onDiscuss, onRestart,
}: IntakeWizardProps): ReactNode {
  if (phase === 'closed') return null
  const quiet = phase === 'thinking' || phase === 'result'
  const modelLabel = modelSummary(modelState, models, selectedModel, t)
  const canConfirm = !sending && !modelBlocked

  return (
    <div
      className={css.wizardBackdrop}
      data-lcoder-intake-wizard
      data-phase={phase}
      data-quiet={quiet ? 'true' : undefined}
      onClick={(event) => {
        if (!quiet && event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className={css.wizard}
        role="dialog"
        aria-modal={quiet ? undefined : true}
        aria-label={t('shell.wizardDialogLabel')}
        data-layout={phase === 'thinking' ? 'solo' : 'split'}
      >
        <div className={css.wizardHead}>
          <div className={css.grow}>
            <h2 className={css.wizardTitle} data-wizard-title>
              <span>{t('shell.wizardTitlePrefix')}</span>
              <span className={css.wizardTitleBrand} data-wizard-title-brand>{t('shell.wizardTitleBrand')}</span>
              <span>{t('shell.wizardTitleMiddle')}</span>
              <span className={css.wizardTitleHighlight} data-wizard-title-highlight>{t('shell.wizardTitleHighlight')}</span>
              <span>{t('shell.wizardTitleSuffix')}</span>
            </h2>
          </div>
          {phase === 'home' ? null : (
            <button
              type="button"
              className={css.iconBtn}
              title={t('shell.wizardClose')}
              aria-label={t('shell.wizardClose')}
              onClick={onCancel}
            >
              ✕
            </button>
          )}
        </div>

        {phase === 'home' ? (
          <>
            <div className={css.wizardHome}>
              <WizardSections
                t={t}
                modelLabel={modelLabel}
                modelState={modelState}
                models={models}
                selectedModel={selectedModel}
                onSelectModel={onSelectModel}
                onLoadModels={onLoadModels}
                onOpenSettings={onOpenSettings}
              />
            </div>
            {modelBlocked ? (
              <div className={css.wizardNotice}>
                <p>{t('shell.noModels')}</p>
                <button type="button" className={css.secondaryBtn} onClick={onOpenSettings}>
                  {t('shell.wizardGoSettings')}
                </button>
              </div>
            ) : null}
            {error === null ? null : <p className={`${css.problem} ${css.wizardError}`}>{error}</p>}
            <div className={css.wizardFoot}>
              <button type="button" className={css.secondaryBtn} disabled={sending} onClick={onCancel}>
                {t('shell.cancel')}
              </button>
              <button
                type="button"
                className={css.primaryBtn}
                data-wizard-confirm
                disabled={!canConfirm}
                title={modelBlocked ? t('shell.noModels') : undefined}
                onClick={onConfirm}
              >
                {sending ? t('shell.wizardSending') : t('shell.wizardConfirm')}
              </button>
            </div>
          </>
        ) : (
          <div
            className={`${css.wizardColumns} ${phase === 'thinking' ? css.wizardColumnsSolo : ''}`}
            data-wizard-layout={phase === 'thinking' ? 'solo' : 'split'}
          >
            <aside className={css.wizardAside}>
              <div className={css.wizardAnalyst} data-wizard-analyst>
                <div className={css.wizardAnalystWho}>
                  <img className={css.wizardAvatar} src={bullMark} alt="" aria-hidden />
                  <div className={css.wizardAnalystText}>
                    <b>{t('shell.wizardAnalystName')}</b>
                    <span>{t('shell.wizardAnalystRole')}</span>
                  </div>
                </div>
                {phase === 'thinking' ? (
                  <ThinkingStatus
                    t={t}
                    items={processItems}
                    running={running}
                    confirmed={confirmed}
                    restartBusy={restartBusy}
                    onRestart={onRestart}
                  />
                ) : null}
              </div>
              <WizardSections
                t={t}
                compact
                modelLabel={modelLabel}
                modelState={modelState}
                models={models}
                selectedModel={selectedModel}
                onSelectModel={onSelectModel}
                onLoadModels={onLoadModels}
                onOpenSettings={onOpenSettings}
              />
            </aside>
            {phase === 'thinking' ? null : (
              <section className={css.wizardStage} data-phase={phase} data-wizard-stage key={phase}>
                {phase === 'questions' ? (
                  question === null ? null : (
                    <div className={css.wizardQuestion} key={question.key} data-wizard-question>
                      <p className={css.wizardStageHint}>{t('shell.wizardQuestionHint')}</p>
                      <QuestionCard pending={question} t={t} embedded />
                    </div>
                  )
                ) : null}
                {phase === 'result' ? (
                  <ResultPanel
                    t={t}
                    view={result}
                    requirement={requirement}
                    summary={summary}
                    confirmed={confirmed}
                    confirming={confirming}
                    landed={landed}
                    notice={notice}
                    tasks={tasks}
                    error={error}
                    approving={approving}
                    approveResult={approveResult}
                    canApprove={canApprove}
                    restartBusy={restartBusy}
                    discussing={discussing}
                    onApprove={onApprove}
                    onConfirmNeed={onConfirmNeed}
                    onRetry={onRetry}
                    onOpenBoard={onOpenBoard}
                    onDiscuss={onDiscuss}
                    onRestart={onRestart}
                  />
                ) : null}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 首页与侧栏共用的三节：简历、工作流程与模型高级配置。
 * 三节默认都折叠，只露出标题与一行摘要；摘要里的模型由外壳在打开向导时读好。
 */
function WizardSections({
  t, modelLabel, modelState, models, selectedModel, onSelectModel, onLoadModels, onOpenSettings, compact = false,
}: {
  readonly t: Translate
  readonly modelLabel: string
  readonly modelState: IntakeModelState
  readonly models: readonly IntakeModelOption[]
  readonly selectedModel: IntakeModelOption | null
  readonly onSelectModel: (option: IntakeModelOption) => void
  readonly onLoadModels: () => void
  readonly onOpenSettings: () => void
  readonly compact?: boolean
}): ReactNode {
  return (
    <div className={`${css.wizardSections} ${compact ? css.wizardSectionsCompact : ''}`}>
      <details className={css.wizardSection} data-wizard-section="profile">
        <summary className={css.wizardSectionSummary}>
          <span className={css.wizardSectionTitle}>{t('shell.wizardProfileTitle')}</span>
          <span className={css.wizardSectionBrief}>{t('shell.wizardProfileSummary')}</span>
        </summary>
        <div className={css.wizardSectionBody}>
          <ul className={css.wizardList}>
            <li>{t('shell.wizardProfileBullet1')}</li>
            <li>{t('shell.wizardProfileBullet2')}</li>
            <li>{t('shell.wizardProfileBullet3')}</li>
            <li>{t('shell.wizardProfileBullet4')}</li>
          </ul>
        </div>
      </details>

      <details className={css.wizardSection} data-wizard-section="flow">
        <summary className={css.wizardSectionSummary}>
          <span className={css.wizardSectionTitle}>{t('shell.wizardFlowTitle')}</span>
          <span className={css.wizardSectionBrief}>{t('shell.wizardFlowSummary')}</span>
        </summary>
        <div className={css.wizardSectionBody}>
          <ol className={css.wizardList}>
            <li>{t('shell.wizardFlowStep1')}</li>
            <li>{t('shell.wizardFlowStep2')}</li>
            <li>{t('shell.wizardFlowStep3')}</li>
            <li>{t('shell.wizardFlowStep4')}</li>
            <li>{t('shell.wizardFlowStep5')}</li>
          </ol>
        </div>
      </details>

      <details
        className={css.wizardSection}
        data-wizard-section="advanced"
        onToggle={(event) => { if (event.currentTarget.open) onLoadModels() }}
      >
        <summary className={css.wizardSectionSummary}>
          <span className={css.wizardSectionTitle}>{t('shell.wizardAdvancedTitle')}</span>
          <span className={css.wizardSectionBrief}>
            {fillText(t('shell.wizardAdvancedSummary'), modelLabel)}
          </span>
        </summary>
        <div className={css.wizardSectionBody}>
          <ModelPanel
            t={t}
            modelState={modelState}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={onSelectModel}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </details>
    </div>
  )
}

/** 词典里的 `{model}` 占位符；只替换一遍。 */
function fillText(text: string, model: string): string {
  return text.replace('{model}', model)
}

/** 高级配置摘要里的一句话：目录读到时报真实模型，其余如实说读没读到。 */
function modelSummary(
  state: IntakeModelState,
  models: readonly IntakeModelOption[],
  selected: IntakeModelOption | null,
  t: Translate,
): string {
  if (state === 'idle' || state === 'loading') return t('shell.wizardModelLoading')
  if (state === 'error') return t('shell.wizardModelFailed')
  if (models.length === 0 || selected === null) return t('shell.wizardNoModels')
  return `${selected.providerName} · ${selected.modelName}`
}

/**
 * 高级配置里的模型选择：只列目录里可用的模型，没有时给空态与去设置入口。
 * 这里不收集凭据、不回显任何密钥。
 */
function ModelPanel({
  t, modelState, models, selectedModel, onSelectModel, onOpenSettings,
}: {
  readonly t: Translate
  readonly modelState: IntakeModelState
  readonly models: readonly IntakeModelOption[]
  readonly selectedModel: IntakeModelOption | null
  readonly onSelectModel: (option: IntakeModelOption) => void
  readonly onOpenSettings: () => void
}): ReactNode {
  if (modelState === 'loading' || modelState === 'idle') {
    return <p className={css.wizardEmpty}>{t('shell.wizardModelLoading')}</p>
  }
  if (modelState === 'error') {
    return (
      <div className={css.wizardEmpty}>
        <p>{t('shell.wizardModelFailed')}</p>
        <button type="button" className={css.secondaryBtn} onClick={onOpenSettings}>
          {t('shell.wizardGoSettings')}
        </button>
      </div>
    )
  }
  if (models.length === 0) {
    return (
      <div className={css.wizardEmpty}>
        <p>{t('shell.wizardNoModels')}</p>
        <button type="button" className={css.secondaryBtn} onClick={onOpenSettings}>
          {t('shell.wizardGoSettings')}
        </button>
      </div>
    )
  }
  return (
    <div className={css.wizardModels} role="group" aria-label={t('shell.wizardAdvancedTitle')}>
      {models.map((option) => {
        const active = selectedModel !== null
          && selectedModel.provider === option.provider && selectedModel.model === option.model
        return (
          <button
            type="button"
            key={`${option.provider}/${option.model}`}
            className={`${css.wizardModel} ${active ? css.wizardModelOn : ''}`}
            aria-pressed={active}
            onClick={() => { onSelectModel(option) }}
          >
            <span className={css.wizardModelName}>{option.modelName}</span>
            <span className={css.wizardModelId}>{`${option.providerName} · ${option.model}`}</span>
            {option.isDefault ? <span className={css.wizardModelTag}>{t('shell.wizardModelDefault')}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 分析师头行右侧的状态：在跑时是 loading 与「思考中」，稳定结束后换成结束说明与紧凑的重新开始。
 *
 * 两种情况都点得开过程明细，展开区只与状态行之间用一条分隔线分段，不再套一层大边框。
 * 结束态的「重新开始」仍走外壳的 onRestart，确认框与重开逻辑都不在这里。
 * 已确认需求后这一轮仍然什么都没落盘时，结束说明下再补一句失败提示，不冒充成功。
 */
function ThinkingStatus({
  t, items, running, confirmed, restartBusy, onRestart,
}: {
  readonly t: Translate
  readonly items: readonly ShellProcessItem[]
  readonly running: boolean
  readonly confirmed: boolean
  readonly restartBusy: boolean
  readonly onRestart: () => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className={css.wizardStatus} data-wizard-thinking data-running={running ? 'true' : 'false'}>
        <button
          type="button"
          className={css.thinkingToggle}
          aria-expanded={open}
          title={t('shell.wizardThinkingExpand')}
          onClick={() => { setOpen(value => !value) }}
        >
          <span className={css.thinkingSpinner} data-wizard-spinner data-spinning={running ? 'true' : 'false'} aria-hidden />
          <span>{running ? t('shell.wizardThinking') : t('shell.wizardThinkingEnded')}</span>
        </button>
        {running ? null : (
          <button
            type="button"
            className={css.wizardStatusRestart}
            data-wizard-thinking-restart
            disabled={restartBusy}
            onClick={onRestart}
          >
            {restartBusy ? t('shell.restarting') : t('shell.restartIntake')}
          </button>
        )}
      </div>
      {!running && confirmed ? (
        <p className={css.wizardStageHint} data-wizard-confirm-failed>{t('shell.wizardConfirmFailed')}</p>
      ) : null}
      {open ? (
        <div className={css.wizardExpand} data-wizard-thinking-body>
          {items.length === 0
            ? <p className={css.wizardEmpty}>{t('shell.wizardThinkingEmpty')}</p>
            : <div className={css.wizardProcess}><ProcessList items={items} t={t} /></div>}
        </div>
      ) : null}
    </>
  )
}

/**
 * 分析完成后的结果卡：有方案时是方案的问题、候选、推荐、决定态与本轮草案；
 * 只有聊天概要时用 Markdown 渲染最后一条答复，限高滚动；已确认落盘时只说结果。
 * 「更多轮次」是锚在按钮下方的小菜单：更多讨论留在本会话继续问，重新开始仍交给外壳的 onRestart。
 * 采纳与确认失败的原文都就地显示，卡片保持打开。
 */
function ResultPanel({
  t, view, requirement, summary, confirmed, confirming, landed, notice, tasks, error, approving, approveResult, canApprove,
  restartBusy, discussing, onApprove, onConfirmNeed, onRetry, onOpenBoard, onDiscuss, onRestart,
}: {
  readonly t: Translate
  readonly view: IntakeResultView
  readonly requirement: RequirementDocRow | null
  readonly summary: string | null
  readonly confirmed: boolean
  readonly confirming: boolean
  readonly landed: boolean
  readonly notice: ShellSessionNotice | null
  readonly tasks: readonly ShellTask[]
  readonly error: string | null
  readonly approving: boolean
  readonly approveResult: ShellSignResult | null
  readonly canApprove: boolean
  readonly restartBusy: boolean
  readonly discussing: boolean
  readonly onApprove: () => void
  readonly onConfirmNeed: () => void
  readonly onRetry: () => void
  readonly onOpenBoard: () => void
  readonly onDiscuss: () => void
  readonly onRestart: () => void
}): ReactNode {
  const labels = useMarkdownLabels(t)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrap = useRef<HTMLDivElement | null>(null)
  const moreTrigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutside = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuWrap.current?.contains(target)) return
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      moreTrigger.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])
  const draftTasks = requirement === null ? [] : tasks.filter(task => task.requirement === requirement.id)
  const showRequirement = view === 'requirement' && requirement !== null
  const primaryDisabled = view === 'confirmed'
    ? false
    : view === 'requirement'
      ? requirement === null || approving || !canApprove
      : view === 'summary'
        ? confirming || (confirmed && landed)
        : confirmed && !landed ? confirming : true
  const retryNeeded = confirmed && !landed && view !== 'confirmed'
  const primaryLabel = view === 'requirement'
    ? (approving ? t('shell.approving') : t('shell.confirmRequirement'))
    : view === 'summary'
      ? (confirming
        ? t('shell.wizardConfirmSending')
        : retryNeeded ? t('shell.wizardRetryLanding') : confirmed ? t('shell.wizardConfirmedTitle') : t('shell.confirmRequirement'))
      : retryNeeded ? t('shell.wizardRetryLanding') : t('shell.confirmRequirement')
  return (
    <div className={css.wizardResult} data-wizard-result data-result-view={view}>
      <div className={css.wizardResultHead}>
        <h4>{t('shell.wizardResultTitle')}</h4>
        <p className={css.wizardStageHint}>
          {view === 'summary'
            ? t('shell.wizardSummaryHint')
            : view === 'confirmed' ? t('shell.wizardConfirmedHint') : t('shell.wizardResultHint')}
        </p>
      </div>
      {showRequirement ? (
        <div className={css.wizardResultFields}>
          <b className={css.wizardResultName}>{requirement.title ?? t('shell.requirementUntitled')}</b>
          {requirement.text.trim() === '' ? null : (
            <div className={css.wizardRequirementBody} data-wizard-requirement-body>
              <MarkdownText text={requirement.text} labels={labels} />
            </div>
          )}
          {requirement.options.length === 0 ? null : (
            <div className={css.wizardResultField}>
              <span className={css.wizardResultKey}>{t('shell.proposalOptions')}</span>
              <div className={css.wizardResultOptions}>
                {requirement.options.map(option => (
                  <div key={`${option.name}-${option.summary}`} className={css.wizardResultOption}>
                    <div className={css.wizardResultOptionHead}>
                      <span className={css.wizardResultOptionName}>{option.name}</span>
                      {option.cost === undefined || option.cost === '' ? null : <span className={css.wizardResultOptionCost}>{option.cost}</span>}
                    </div>
                    {option.summary === '' ? null : <span className={css.wizardResultOptionSummary}>{option.summary}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={css.wizardResultField}>
            <span className={css.wizardResultKey}>{t('shell.requirementRecommendation')}</span>
            <span className={css.wizardResultValue}>
              {requirement.recommendation === undefined || requirement.recommendation === ''
                ? t('shell.resultNoRecommendation')
                : requirement.recommendation}
            </span>
          </div>
          <div className={css.wizardResultField}>
            <span className={css.wizardResultKey}>{t('shell.requirementState')}</span>
            <span className={css.wizardResultValue}>
              {t(requirement.state === 'confirmed' || requirement.state === 'released' || requirement.state === 'closed'
                ? requirement.state === 'confirmed'
                  ? REQUIREMENT_PROGRESS_LABEL.confirmed
                  : requirement.state === 'released'
                    ? REQUIREMENT_PROGRESS_LABEL.released
                    : REQUIREMENT_PROGRESS_LABEL.cancelled
                : REQUIREMENT_PROGRESS_LABEL.pending)}
            </span>
          </div>
          <div className={css.wizardResultField}>
            <span className={css.wizardResultKey}>{t('shell.wizardResultTasks', { count: draftTasks.length })}</span>
            {draftTasks.length === 0 ? null : (
              <div className={css.wizardResultTasks}>
                {draftTasks.map(task => (
                  <span key={task.id} className={css.wizardTaskChip} data-wizard-task={task.id}>{task.id}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {view === 'summary' && summary !== null ? (
        <div className={css.wizardSummary} data-wizard-summary>
          <MarkdownText text={summary} labels={labels} />
        </div>
      ) : null}
      {view === 'confirmed' ? (
        <p className={css.wizardConfirmed} data-wizard-confirmed>{t('shell.wizardConfirmedTitle')}</p>
      ) : null}
      {view === 'pending' ? <p className={css.wizardEmpty}>{t('shell.wizardResultMissing')}</p> : null}
      {confirmed && !landed && view !== 'confirmed' ? (
        <div className={css.problem} data-wizard-confirm-notice>
          <p>{t('shell.wizardConfirmFailed')}</p>
          {notice === null ? null : (
            <p className={css.secretRef}>
              {notice.code === undefined ? notice.detail : t(cloudErrorKey(notice.code))}
            </p>
          )}
          {notice?.requestId === undefined ? null : (
            <p className={css.secretRef}>{t('shell.cloudRequestId')}: {notice.requestId}</p>
          )}
        </div>
      ) : null}
      <div className={css.wizardResultActions}>
        {view === 'confirmed' ? (
          <button type="button" className={css.primaryBtn} data-wizard-go-board onClick={onOpenBoard}>
            {t('shell.backToBoard')}
          </button>
        ) : (
          <button
            type="button"
            className={css.primaryBtn}
            data-wizard-approve
            disabled={primaryDisabled}
            onClick={view === 'requirement' ? onApprove : retryNeeded ? onRetry : onConfirmNeed}
          >
            {primaryLabel}
          </button>
        )}
        {confirmed && landed && view !== 'confirmed' ? (
          <button type="button" className={css.secondaryBtn} data-wizard-go-board onClick={onOpenBoard}>
            {t('shell.backToBoard')}
          </button>
        ) : null}
        <div className={css.wizardMoreWrap} ref={menuWrap}>
          <button
            type="button"
            ref={moreTrigger}
            className={css.secondaryBtn}
            data-wizard-more
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen(value => !value) }}
          >
            {t('shell.wizardMoreRounds')}
          </button>
          {menuOpen ? (
            <div className={css.wizardMenu} role="menu" aria-label={t('shell.wizardMoreRounds')} data-wizard-more-menu>
              <button
                type="button"
                role="menuitem"
                className={css.wizardMenuItem}
                data-wizard-discuss
                disabled={discussing}
                onClick={() => {
                  setMenuOpen(false)
                  onDiscuss()
                }}
              >
                {t('shell.wizardMoreDiscuss')}
              </button>
              <button
                type="button"
                role="menuitem"
                className={css.wizardMenuItem}
                data-wizard-restart
                title={t('shell.wizardRestartHint')}
                disabled={restartBusy}
                onClick={() => {
                  setMenuOpen(false)
                  onRestart()
                }}
              >
                {restartBusy ? t('shell.restarting') : t('shell.restartIntake')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {approveResult === null ? null : (
        <p className={approveResult.ok ? css.secretRef : css.problem}>{approveResult.text}</p>
      )}
      {error === null ? null : <p className={css.problem}>{error}</p>}
    </div>
  )
}
