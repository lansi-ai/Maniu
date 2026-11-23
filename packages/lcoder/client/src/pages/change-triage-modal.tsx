/** 统一「提变更 / 加功能」分流弹窗：HeroUI Glass 居中 Modal，展示四维 S / M / L 分级建议、文档影响并支持手动改选。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Chip, Modal, Separator, useOverlayState } from '@heroui/react'
import { Check, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import {
  actionKindForLevel,
  docImpactForLevel,
  isTriageLevelAllowed,
  triageRequirementChange,
  type ChangeTriageActionKind,
  type ChangeTriageLevel,
} from '../intake/change-triage.ts'
import { translate, type MessageKey, type Translate } from '../locale.ts'
import { requirementStateLabel } from '../spec/board.ts'
import type { ProjectTrackRow, RequirementDocRow, TaskRow } from '../spec/rows.ts'

const zhText: Translate = (key, params) => translate('zh', key, params)

const LEVEL_LABEL_KEY: Readonly<Record<ChangeTriageLevel, MessageKey>> = {
  draft: 'triage.levelLabel.draft',
  S: 'triage.levelLabel.S',
  M: 'triage.levelLabel.M',
  L: 'triage.levelLabel.L',
}

const LEVEL_DESC_KEY: Readonly<Record<ChangeTriageLevel, MessageKey>> = {
  draft: 'triage.levelDesc.draft',
  S: 'triage.levelDesc.S',
  M: 'triage.levelDesc.M',
  L: 'triage.levelDesc.L',
}

const LEVEL_CHIP_COLOR: Readonly<Record<ChangeTriageLevel, 'accent' | 'success' | 'warning' | 'default'>> = {
  draft: 'default',
  S: 'success',
  M: 'warning',
  L: 'accent',
}

/** 弹窗确认执行时传给父页面的结构化路由载荷。 */
export interface ChangeTriageConfirmPayload {
  readonly targetId: string | null
  readonly description: string
  readonly level: ChangeTriageLevel
  readonly actionKind: ChangeTriageActionKind
  readonly recommendedLevel: ChangeTriageLevel
}

/** 统一变更分流弹窗属性。 */
export interface ChangeTriageModalProps {
  /** 受控开关。 */
  readonly isOpen: boolean
  readonly requirements: readonly RequirementDocRow[]
  readonly tasks: readonly TaskRow[]
  readonly tracks: readonly ProjectTrackRow[]
  readonly projectKind?: 'web' | 'desktop' | 'library' | undefined
  /** 从详情页打开时传入当前需求编号以自动预选。 */
  readonly initialTargetId?: string | null | undefined
  readonly onClose: () => void
  readonly onConfirm: (
    payload: ChangeTriageConfirmPayload,
  ) => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
}

/**
 * 渲染统一「提变更 / 加功能」居中 Glass 分流弹窗。
 * @param props - 开关、需求/任务/轨上下文、预选需求与确认路由回调。
 * @returns 受 isOpen 控制的 HeroUI Glass Modal。
 */
export function ChangeTriageModal(props: ChangeTriageModalProps): JSX.Element {
  const t = props.t ?? zhText
  const overlayState = useOverlayState({
    isOpen: props.isOpen,
    onOpenChange: (open) => { if (!open) props.onClose() },
  })
  const [targetId, setTargetId] = useState<string>(props.initialTargetId ?? '')
  const [description, setDescription] = useState('')
  const [manualLevel, setManualLevel] = useState<ChangeTriageLevel | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!props.isOpen) return
    setTargetId(props.initialTargetId ?? '')
    setDescription('')
    setManualLevel(null)
    setOverrideOpen(false)
    setFailure(null)
  }, [props.isOpen, props.initialTargetId])

  const selectedTarget = targetId === ''
    ? null
    : props.requirements.find(row => row.id === targetId) ?? null

  const triage = triageRequirementChange({
    description,
    target: selectedTarget,
    tracks: props.tracks,
    projectKind: props.projectKind,
    tasks: props.tasks,
  })

  const effectiveLevel: ChangeTriageLevel = manualLevel !== null
    && isTriageLevelAllowed(manualLevel, selectedTarget).allowed
    ? manualLevel
    : triage.level
  const effectiveEligibility = isTriageLevelAllowed(effectiveLevel, selectedTarget)
  const effectiveImpact = docImpactForLevel(effectiveLevel)
  const effectiveAction = actionKindForLevel(effectiveLevel)

  const selectableLevels: readonly ChangeTriageLevel[] = selectedTarget?.state === 'draft'
    ? ['draft', 'S', 'M', 'L']
    : ['S', 'M', 'L']

  const handleConfirm = async (): Promise<void> => {
    if (busy || description.trim() === '' || !effectiveEligibility.allowed) return
    setBusy(true)
    setFailure(null)
    try {
      const answer = await props.onConfirm({
        targetId: selectedTarget?.id ?? null,
        description: description.trim(),
        level: effectiveLevel,
        actionKind: effectiveAction,
        recommendedLevel: triage.level,
      })
      if (!answer.ok) setFailure(answer.message)
    } catch (cause: unknown) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal.Root state={overlayState}>
      <Modal.Backdrop isDismissable variant="transparent" className="glass-modal-backdrop">
        <Modal.Container placement="center" size="lg" className="glass-modal">
          <Modal.Dialog className="glass-modal-panel triage-modal-panel" data-testid="change-triage-modal">
            <Modal.Header className="triage-modal-header">
              <Modal.Heading>{t('triage.modalTitle')}</Modal.Heading>
              <Modal.CloseTrigger data-testid="change-triage-close" aria-label={t('triage.close')} />
            </Modal.Header>
            <Modal.Body className="triage-modal-body">
              <div className="triage-container">
                <div className="triage-form">
                  <div className="triage-field">
                    <label className="triage-field-label" htmlFor="change-triage-target-select">
                      {t('triage.targetLabel')}
                    </label>
                    <select
                      id="change-triage-target-select"
                      className="triage-target-select"
                      data-testid="change-triage-target"
                      aria-label={t('triage.targetLabel')}
                      value={selectedTarget?.id ?? ''}
                      onChange={(event) => {
                        setTargetId(event.target.value)
                        setManualLevel(null)
                      }}
                    >
                      <option value="">{t('triage.targetStandalone')}</option>
                      {props.requirements.map(row => (
                        <option key={row.id} value={row.id}>
                          {t('triage.targetOption', {
                            id: row.id,
                            title: row.title ?? row.id,
                            state: requirementStateLabel(row.state),
                          })}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="triage-field">
                    <label className="triage-field-label" htmlFor="change-triage-desc-input">
                      {t('triage.descriptionLabel')}
                    </label>
                    <textarea
                      id="change-triage-desc-input"
                      className="triage-desc-input"
                      data-testid="change-triage-description"
                      aria-label={t('triage.descriptionLabel')}
                      rows={3}
                      value={description}
                      placeholder={t('triage.descriptionPlaceholder')}
                      onChange={(event) => {
                        setDescription(event.target.value)
                        setManualLevel(null)
                      }}
                    />
                    <p className="triage-field-hint">{t('triage.descriptionHint')}</p>
                  </div>
                </div>

                <Card className="triage-suggestion-card" data-testid="change-triage-suggestion">
                  <div className="triage-suggestion-head">
                    <span className="triage-suggestion-title">{t('triage.suggestionHeading')}</span>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={LEVEL_CHIP_COLOR[effectiveLevel]}
                      data-testid="change-triage-recommended-level"
                      data-level={triage.level}
                      data-effective-level={effectiveLevel}
                    >
                      {t(LEVEL_LABEL_KEY[effectiveLevel])}
                    </Chip>
                  </div>
                  <Separator />
                  <div className="triage-suggestion-body">
                    <div className="triage-reasons" data-testid="change-triage-reasons">
                      <span className="triage-block-title">{t('triage.reasonsHeading')}</span>
                      <ul className="triage-bullet-list">
                        {triage.reasons.map(key => (
                          <li key={key}>{t(key)}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="triage-impact" data-testid="change-triage-doc-impact">
                      <span className="triage-block-title">{t('triage.docImpactTitle')}</span>
                      <div className="triage-impact-grid">
                        <div className="triage-impact-col" data-testid="change-triage-impact-update">
                          <span className="triage-impact-label triage-impact-label-update">{t('triage.willUpdateTitle')}</span>
                          <ul className="triage-bullet-list muted">
                            {effectiveImpact.willUpdate.map(key => (
                              <li key={key}>{t(key)}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="triage-impact-col" data-testid="change-triage-impact-keep">
                          <span className="triage-impact-label triage-impact-label-keep">{t('triage.willKeepTitle')}</span>
                          <ul className="triage-bullet-list muted">
                            {effectiveImpact.willKeep.map(key => (
                              <li key={key}>{t(key)}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="triage-override-bar">
                      <button
                        type="button"
                        className="triage-override-toggle"
                        data-testid="change-triage-override-toggle"
                        aria-expanded={overrideOpen}
                        onClick={() => { setOverrideOpen(current => !current) }}
                      >
                        <span>{overrideOpen ? t('triage.overrideClose') : t('triage.overrideOpen')}</span>
                        {overrideOpen
                          ? <ChevronUp size={14} aria-hidden="true" />
                          : <ChevronDown size={14} aria-hidden="true" />}
                      </button>
                      {manualLevel !== null && manualLevel !== triage.level && (
                        <button
                          type="button"
                          className="triage-override-reset"
                          data-testid="change-triage-override-reset"
                          onClick={() => { setManualLevel(null) }}
                        >
                          {t('triage.overrideReset')}
                        </button>
                      )}
                    </div>

                    {overrideOpen && (
                      <div className="triage-level-section">
                        <span className="triage-block-title">{t('triage.levelSwitchLabel')}</span>
                        <div
                          className="triage-level-grid"
                          role="radiogroup"
                          aria-label={t('triage.levelSwitchLabel')}
                        >
                          {selectableLevels.map((level) => {
                            const eligibility = isTriageLevelAllowed(level, selectedTarget)
                            const isSelected = effectiveLevel === level
                            const isRecommended = triage.level === level
                            const disabledReason = eligibility.reasonKey === undefined ? undefined : t(eligibility.reasonKey)
                            return (
                              <button
                                key={level}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                disabled={!eligibility.allowed}
                                data-testid={`change-triage-level-${level}`}
                                title={disabledReason}
                                className={isSelected ? 'intake-mode-card selected triage-level-card' : 'intake-mode-card triage-level-card'}
                                onClick={() => {
                                  if (eligibility.allowed) setManualLevel(level)
                                }}
                              >
                                <span className="intake-mode-text">
                                  <span className="triage-level-head">
                                    <span className="intake-mode-title">{t(LEVEL_LABEL_KEY[level])}</span>
                                    {isRecommended && (
                                      <Chip size="sm" variant="soft" color="accent" data-testid="change-triage-recommended-badge">
                                        {t('triage.recommendedBadge')}
                                      </Chip>
                                    )}
                                  </span>
                                  <span className="intake-mode-desc">
                                    {disabledReason !== undefined ? disabledReason : t(LEVEL_DESC_KEY[level])}
                                  </span>
                                </span>
                                <Check className="intake-mode-check" size={16} aria-hidden="true" />
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                {!effectiveEligibility.allowed && effectiveEligibility.reasonKey !== undefined && (
                  <p className="problem triage-alert" data-testid="change-triage-blocked">{t(effectiveEligibility.reasonKey)}</p>
                )}
                {failure !== null && <p className="problem triage-alert" data-testid="change-triage-error">{failure}</p>}

                <div className="triage-actions">
                  <Button variant="secondary" data-testid="change-triage-cancel" isDisabled={busy} onPress={props.onClose}>
                    {t('triage.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    data-testid="change-triage-confirm"
                    isDisabled={busy || description.trim() === '' || !effectiveEligibility.allowed}
                    onPress={() => { void handleConfirm() }}
                  >
                    <Sparkles size={16} aria-hidden="true" />
                    {busy ? t('triage.submitting') : t('triage.confirm')}
                  </Button>
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}
