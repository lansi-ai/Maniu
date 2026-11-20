/** 立项向导与结果页：选择档位、发送并在结果里查看新需求。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Modal, Separator, useOverlayState } from '@heroui/react'
import { Check, FileSearch, FolderGit2, Rocket, Sparkles, UserCheck } from 'lucide-react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import { buildIntakePrompt, type IntakeMode } from '../intake/prompts.ts'
import { hasIntakeWork } from '../intake/eligibility.ts'
import { loadBuiltinPresets } from '../talents/api.ts'
import { translate, type Translate } from '../locale.ts'

/** 立项会话的角色；人设是访谈纪律的唯一来源。 */
const INTAKE_PRESET = 'maniu-intake'

/** 工作台页面尚未全面接入词典，未传取词函数时沿用中文；新客户端可传入自己的取词函数。 */
const zhText: Translate = (key, params) => translate('zh', key, params)

/** 一次立项发送的结果；提到 App 级，供向导卸载后回看。 */
export interface IntakeResult {
  readonly message: string
  readonly sessionId: string
}

/** 立项向导属性。 */
export interface IntakeWizardProps {
  /** 受控开关；关闭时父级只收起弹层，App 级立项结果保留供回看。 */
  readonly isOpen: boolean
  readonly project: ProjectScope
  readonly projection: SpecProjection
  readonly result: IntakeResult | null
  readonly onClearResult: () => void
  readonly onClose: () => void
  readonly onStart: (prompt: string) => Promise<{ readonly ok: boolean; readonly message: string }>
  readonly onOpenRequirement: (id: string) => void
  readonly onReload: () => void
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
}

/**
 * 画立项向导。
 * @param props - 开关、项目、投影、提升到 App 的结果与发送回调。
 * @returns 受 isOpen 控制的居中 Modal。
 */
export function IntakeWizard(props: IntakeWizardProps): JSX.Element {
  const t = props.t ?? zhText
  const overlayState = useOverlayState({
    isOpen: props.isOpen,
    onOpenChange: (open) => { if (!open) props.onClose() },
  })
  const [mode, setMode] = useState<IntakeMode>('fresh')
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [rosterName, setRosterName] = useState<string | null>(null)

  // 显示名以人才库名册为准；读不到时回退词典，不把角色名写死在界面里。
  useEffect(() => {
    let live = true
    void loadBuiltinPresets().then((answer) => {
      if (!live || !answer.ok) return
      const name = answer.value.find(row => row.id === INTAKE_PRESET)?.name?.trim()
      if (name !== undefined && name !== '') setRosterName(name)
    })
    return () => { live = false }
  }, [])

  const start = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const answer = await props.onStart(buildIntakePrompt({
        name: props.project.title,
        path: props.project.path,
        branch: props.projection.project?.branch ?? '—',
        docs: {
          product: props.projection.project?.docs.product ?? '',
          architecture: props.projection.project?.docs.architecture ?? '',
          tests: props.projection.project?.docs.tests ?? '',
        },
      }, mode, idea))
      if (!answer.ok) setFailure(answer.message)
    } finally {
      setBusy(false)
    }
  }

  const selectMode = (key: IntakeMode): void => {
    setMode(key)
  }

  const started = props.result
  const blocked = hasIntakeWork(props.projection)
  const latest = props.projection.requirements[props.projection.requirements.length - 1]

  return (
    <Modal.Root state={overlayState}>
      <Modal.Backdrop isDismissable variant="transparent" className="glass-modal-backdrop">
        <Modal.Container placement="center" size="lg" className="glass-modal">
          <Modal.Dialog className="glass-modal-panel" data-testid="intake-wizard">
            <Modal.Header>
              <Modal.Heading>{t('intake.title')}</Modal.Heading>
              <Modal.CloseTrigger data-testid="intake-close" aria-label={t('intake.close')} />
            </Modal.Header>
            <Modal.Body>
              <div className="intake-container">
                <div className="intake-role-row" data-testid="intake-role">
                  <span className="intake-role-avatar" aria-hidden="true"><UserCheck size={18} /></span>
                  <div className="intake-role-body">
                    <span className="intake-role-name">{rosterName ?? t('intake.roleName')}</span>
                    <span className="intake-role-creator">{t('intake.creatorLabel', { creator: t('intake.creatorBuiltin') })}</span>
                  </div>
                </div>

                {started === null && blocked && (
                  <Card className="intake-section" data-testid="intake-blocked">
                    <Card.Header><Card.Title>{t('intake.blockedTitle')}</Card.Title></Card.Header>
                    <Separator />
                    <Card.Content>
                      <p className="detail-line">{t('intake.blocked')}</p>
                      <div className="detail-drawer-head">
                        <Button variant="secondary" data-testid="intake-blocked-open" onPress={props.onClose}>
                          {t('intake.blockedOpen')}
                        </Button>
                      </div>
                    </Card.Content>
                  </Card>
                )}

                {started === null && !blocked && (
                  <>
                    <Card className="intake-section intake-project-card">
                      <Card.Content>
                        <div className="intake-project-row">
                          <span className="intake-project-icon" aria-hidden="true"><FolderGit2 size={18} /></span>
                          <div className="intake-project-meta">
                            <span className="intake-project-name">{props.project.title}</span>
                            <span className="intake-project-path mono">{props.project.path}</span>
                          </div>
                        </div>
                      </Card.Content>
                    </Card>

                    <Card className="intake-section">
                      <Card.Header><Card.Title>{t('intake.levelTitle')}</Card.Title></Card.Header>
                      <Separator />
                      <Card.Content>
                        <div className="intake-mode-grid" role="radiogroup" aria-label={t('intake.levelGroupLabel')}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={mode === 'fresh'}
                            data-testid="intake-mode-fresh"
                            className={mode === 'fresh' ? 'intake-mode-card selected' : 'intake-mode-card'}
                            onClick={() => { selectMode('fresh') }}
                          >
                            <span className="intake-mode-icon" aria-hidden="true"><Rocket size={18} /></span>
                            <span className="intake-mode-text">
                              <span className="intake-mode-title">{t('intake.modeFreshTitle')}</span>
                              <span className="intake-mode-desc">{t('intake.modeFreshDesc')}</span>
                            </span>
                            <Check className="intake-mode-check" size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={mode === 'onboarding'}
                            data-testid="intake-mode-onboarding"
                            className={mode === 'onboarding' ? 'intake-mode-card selected' : 'intake-mode-card'}
                            onClick={() => { selectMode('onboarding') }}
                          >
                            <span className="intake-mode-icon" aria-hidden="true"><FileSearch size={18} /></span>
                            <span className="intake-mode-text">
                              <span className="intake-mode-title">{t('intake.modeOnboardingTitle')}</span>
                              <span className="intake-mode-desc">{t('intake.modeOnboardingDesc')}</span>
                            </span>
                            <Check className="intake-mode-check" size={16} aria-hidden="true" />
                          </button>
                        </div>
                        <p className="intake-mode-hint">{t('intake.modeFlowHint')}</p>
                      </Card.Content>
                    </Card>

                    {mode === 'fresh' && (
                      <Card className="intake-section" data-testid="intake-idea-section">
                        <Card.Header><Card.Title>{t('intake.ideaLabel')}</Card.Title></Card.Header>
                        <Separator />
                        <Card.Content>
                          <p className="intake-idea-hint">{t('intake.ideaHint')}</p>
                          <textarea
                            className="intake-idea-input"
                            data-testid="intake-idea-input"
                            rows={3}
                            value={idea}
                            placeholder={t('intake.ideaPlaceholder')}
                            onChange={(event) => { setIdea(event.target.value) }}
                          />
                        </Card.Content>
                      </Card>
                    )}

                    {failure !== null && <p className="problem" data-testid="intake-error">{failure}</p>}
                    <div className="intake-actions">
                      <Button variant="primary" data-testid="intake-start" isDisabled={busy || (mode === 'fresh' && idea.trim() === '')} onPress={() => { void start() }}>
                        <Sparkles size={16} aria-hidden="true" />
                        {busy ? t('intake.sending') : t('intake.start')}
                      </Button>
                    </div>
                  </>
                )}

                {started !== null && (
                  <Card className="intake-section" data-testid="intake-result">
                    <Card.Header><Card.Title>{t('intake.resultTitle')}</Card.Title></Card.Header>
                    <Separator />
                    <Card.Content>
                      <p className="detail-line" data-testid="intake-result-message">{started.message}</p>
                      <div className="detail-drawer-head">
                        <Button variant="secondary" data-testid="intake-result-refresh" onPress={props.onReload}>{t('intake.refresh')}</Button>
                        {blocked ? null : (
                          <Button variant="secondary" data-testid="intake-restart" onPress={props.onClearResult}>{t('intake.restart')}</Button>
                        )}
                      </div>
                      {latest === undefined
                        ? <p className="empty" data-testid="intake-result-empty">{t('intake.resultEmpty')}</p>
                        : (
                          <ul className="plain-list compact" data-testid="intake-result-requirements">
                            {props.projection.requirements.slice(-3).reverse().map(row => (
                              <li key={row.id}>
                                <button type="button" className="link-button" data-testid="intake-result-requirement" data-requirement-id={row.id} onClick={() => { props.onOpenRequirement(row.id) }}>
                                  <span className="mono">{row.id}</span> {row.title ?? row.id}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      <p className="detail-note">{t('intake.resultBackground')}</p>
                    </Card.Content>
                  </Card>
                )}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}
