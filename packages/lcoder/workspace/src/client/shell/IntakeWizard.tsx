/**
 * 「全新项目」的需求分析师向导：首页、提问层、思考提示与结果卡。
 *
 * 组件只画传入的阶段与事实：阶段由 {@link intakeWizardPhase} 从会话事实算出，
 * 提问卡的结算仍交给上游 `pending.answer()`，采纳方案仍由外壳派 `/proposal_approve`。
 * 这里不新建会话、不发提示、也不记阶段。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProposalRow } from '../projection.ts'
import type { ShellProcessItem, ShellSignResult } from './shell-data.ts'
import type { ShellQuestionPending } from './pending.ts'
import type { IntakeModelOption, IntakeWizardPhase } from './intake-wizard.ts'
import { PROPOSAL_DECISION } from './intake.ts'
import { ProcessList, QuestionCard } from './ChatPanel.tsx'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 高级配置里模型目录的读取状态。 */
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
  /** 结果卡展示的方案；投影还没读到时为 null。 */
  readonly proposal: ProposalRow | null
  readonly approving: boolean
  readonly approveResult: ShellSignResult | null
  /** 宿主提供采纳命令且当前有会话；缺任一项时按钮禁用。 */
  readonly canApprove: boolean
  readonly restartBusy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly onSelectModel: (option: IntakeModelOption) => void
  /** 首次展开高级配置时读模型目录。 */
  readonly onLoadModels: () => void
  readonly onOpenSettings: () => void
  readonly onApprove: () => void
  readonly onRestart: () => void
}

/**
 * 画需求分析师向导当前阶段。
 * @param props - 阶段、会话事实与全部动作回调。
 * @returns 向导面板；`closed` 阶段不画任何东西。
 */
export function IntakeWizard({
  t, phase, error, question, processItems, modelState, models, selectedModel, modelBlocked, sending,
  proposal, approving, approveResult, canApprove, restartBusy,
  onCancel, onConfirm, onSelectModel, onLoadModels, onOpenSettings, onApprove, onRestart,
}: IntakeWizardProps): ReactNode {
  const [moreOpen, setMoreOpen] = useState(false)
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
      <div className={css.wizard} role="dialog" aria-modal={quiet ? undefined : true} aria-label={t('shell.wizardDialogLabel')}>
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
          <div className={css.wizardColumns}>
            <aside className={css.wizardAside}>
              <div className={css.wizardAnalyst}>
                <span className={css.wizardAvatar} aria-hidden />
                <div className={css.wizardAnalystText}>
                  <b>{t('shell.wizardAnalystName')}</b>
                  <span>{t('shell.wizardAnalystRole')}</span>
                </div>
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
            <section className={css.wizardStage} data-phase={phase} key={phase}>
              {phase === 'questions' ? (
                question === null ? null : (
                  <div className={css.wizardQuestion} key={question.key} data-wizard-question>
                    <p className={css.wizardStageHint}>{t('shell.wizardQuestionHint')}</p>
                    <QuestionCard pending={question} t={t} embedded />
                  </div>
                )
              ) : null}
              {phase === 'thinking' ? (
                <ThinkingPanel t={t} items={processItems} />
              ) : null}
              {phase === 'result' ? (
                <ResultPanel
                  t={t}
                  proposal={proposal}
                  error={error}
                  approving={approving}
                  approveResult={approveResult}
                  canApprove={canApprove}
                  restartBusy={restartBusy}
                  moreOpen={moreOpen}
                  onToggleMore={() => { setMoreOpen(value => !value) }}
                  onApprove={onApprove}
                  onRestart={onRestart}
                />
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 首页与侧栏共用的三节：简历、工作流程与模型高级配置。
 * 三节默认都折叠，只露出标题与一行摘要；高级配置第一次展开时才读模型目录。
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

/** 高级配置摘要里的一句话：只有目录读到时才报真实模型，其余如实说读没读到。 */
function modelSummary(
  state: IntakeModelState,
  models: readonly IntakeModelOption[],
  selected: IntakeModelOption | null,
  t: Translate,
): string {
  if (state === 'idle') return t('shell.wizardModelUnknown')
  if (state === 'loading') return t('shell.wizardModelLoading')
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
 * 问题答完后的思考提示：一行小号 loading 与可展开的过程明细。
 * 默认收起，展开后按原顺序画出思考与工具行。
 */
function ThinkingPanel({
  t, items,
}: {
  readonly t: Translate
  readonly items: readonly ShellProcessItem[]
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className={css.wizardThinking} data-wizard-thinking>
      <button
        type="button"
        className={css.thinkingToggle}
        aria-expanded={open}
        title={t('shell.wizardThinkingExpand')}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.thinkingSpinner} data-wizard-spinner aria-hidden />
        <span>{t('shell.wizardThinking')}</span>
      </button>
      {open
        ? items.length === 0
          ? <p className={css.wizardEmpty}>{t('shell.wizardThinkingEmpty')}</p>
          : <div className={css.wizardProcess}><ProcessList items={items} t={t} /></div>
        : null}
    </div>
  )
}

/**
 * 分析完成后的结果卡：方案摘要、确认需求与更多轮次。
 * 采纳失败时原文就地显示，卡片保持打开。
 */
function ResultPanel({
  t, proposal, error, approving, approveResult, canApprove, restartBusy, moreOpen, onToggleMore, onApprove, onRestart,
}: {
  readonly t: Translate
  readonly proposal: ProposalRow | null
  readonly error: string | null
  readonly approving: boolean
  readonly approveResult: ShellSignResult | null
  readonly canApprove: boolean
  readonly restartBusy: boolean
  readonly moreOpen: boolean
  readonly onToggleMore: () => void
  readonly onApprove: () => void
  readonly onRestart: () => void
}): ReactNode {
  return (
    <div className={css.wizardResult} data-wizard-result>
      <div className={css.wizardResultHead}>
        <h4>{t('shell.wizardResultTitle')}</h4>
        <p className={css.wizardStageHint}>{t('shell.wizardResultHint')}</p>
      </div>
      {proposal === null
        ? <p className={css.wizardEmpty}>{t('shell.wizardResultMissing')}</p>
        : (
          <div className={css.wizardResultBody}>
            <b className={css.wizardResultName}>{proposal.title}</b>
            <span className={css.wizardResultMeta}>{t(PROPOSAL_DECISION[proposal.decision])}</span>
          </div>
        )}
      <div className={css.wizardResultActions}>
        <button
          type="button"
          className={css.primaryBtn}
          data-wizard-approve
          disabled={proposal === null || approving || !canApprove}
          onClick={onApprove}
        >
          {approving ? t('shell.approving') : t('shell.confirmRequirement')}
        </button>
        <button
          type="button"
          className={css.secondaryBtn}
          data-wizard-more
          aria-expanded={moreOpen}
          onClick={onToggleMore}
        >
          {t('shell.wizardMoreRounds')}
        </button>
      </div>
      {moreOpen ? (
        <div className={css.wizardMore}>
          <p className={css.wizardStageHint}>{t('shell.wizardRestartHint')}</p>
          <button type="button" className={css.secondaryBtn} data-wizard-restart disabled={restartBusy} onClick={onRestart}>
            {restartBusy ? t('shell.restarting') : t('shell.restartIntake')}
          </button>
        </div>
      ) : null}
      {approveResult === null ? null : (
        <p className={approveResult.ok ? css.secretRef : css.problem}>{approveResult.text}</p>
      )}
      {error === null ? null : <p className={css.problem}>{error}</p>}
    </div>
  )
}
