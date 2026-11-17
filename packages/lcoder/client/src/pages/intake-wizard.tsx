/** 立项向导与结果页：选择档位、预览指令、发送并在结果里查看新需求。 */

import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import { buildIntakePrompt, type IntakeMode } from '../intake/prompts.ts'
import { hasIntakeWork } from '../intake/eligibility.ts'
import { loadBuiltinPresets } from '../talents/api.ts'
import { translate, type Translate } from '../locale.ts'
import { DetailDrawer } from './detail-drawer.tsx'

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
 * @param props - 项目、投影、提升到 App 的结果与发送回调。
 * @returns 向导抽屉。
 */
export function IntakeWizard(props: IntakeWizardProps): JSX.Element {
  const t = props.t ?? zhText
  const [mode, setMode] = useState<IntakeMode>('fresh')
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

  const prompt = useMemo(() => buildIntakePrompt({
    name: props.project.title,
    path: props.project.path,
    branch: props.projection.project?.branch ?? '—',
    docs: {
      product: props.projection.project?.docs.product ?? '',
      architecture: props.projection.project?.docs.architecture ?? '',
      tests: props.projection.project?.docs.tests ?? '',
    },
  }, mode), [mode, props.project.path, props.project.title, props.projection.project])

  const start = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const answer = await props.onStart(prompt)
      if (!answer.ok) setFailure(answer.message)
    } finally {
      setBusy(false)
    }
  }

  const started = props.result
  const blocked = hasIntakeWork(props.projection)
  const latest = props.projection.requirements[props.projection.requirements.length - 1]

  return (
    <DetailDrawer
      testId="intake-wizard"
      closeTestId="intake-close"
      onClose={props.onClose}
      head={<h3>立项向导</h3>}
    >
      <p className="detail-note intake-role" data-testid="intake-role">
        {t('intake.roleLabel', { name: rosterName ?? t('intake.roleName') })}
      </p>

      {started === null && blocked && (
        <section className="detail-section" data-testid="intake-blocked">
          <h4>项目已有内容</h4>
          <p className="detail-line">{t('intake.blocked')}</p>
          <div className="detail-drawer-head">
            <button type="button" className="pill" data-testid="intake-blocked-open" onClick={props.onClose}>
              {t('intake.blockedOpen')}
            </button>
          </div>
        </section>
      )}

      {started === null && !blocked && (
        <>
          <section className="detail-section">
            <h4>项目</h4>
            <dl className="kv">
              <dt>名称</dt><dd>{props.project.title}</dd>
              <dt>路径</dt><dd className="mono">{props.project.path}</dd>
            </dl>
          </section>

          <section className="detail-section">
            <h4>档位</h4>
            <div className="segmented" role="group" aria-label="立项档位">
              <button type="button" data-testid="intake-mode-fresh" className={mode === 'fresh' ? 'active' : undefined} onClick={() => { setMode('fresh') }}>全新项目</button>
              <button type="button" data-testid="intake-mode-onboarding" className={mode === 'onboarding' ? 'active' : undefined} onClick={() => { setMode('onboarding') }}>已有资料</button>
            </div>
            <p className="detail-note">指令会发送到一条新的需求分析师会话；模型先做 7 问访谈，出《项目需求概要》等你回复「确认需求」后才落盘。</p>
          </section>

          <section className="detail-section">
            <h4>指令预览</h4>
            <pre className="prompt-preview" data-testid="intake-prompt">{prompt}</pre>
          </section>

          {failure !== null && <p className="problem" data-testid="intake-error">{failure}</p>}
          <div className="detail-drawer-head">
            <button type="button" className="pill pill-accent" data-testid="intake-start" disabled={busy} onClick={() => { void start() }}>
              {busy ? '发送中…' : '开始立项'}
            </button>
          </div>
        </>
      )}

      {started !== null && (
        <section className="detail-section" data-testid="intake-result">
          <h4>结果</h4>
          <p className="detail-line" data-testid="intake-result-message">{started.message}</p>
          <div className="detail-drawer-head">
            <button type="button" className="pill" data-testid="intake-result-refresh" onClick={props.onReload}>刷新需求</button>
            {blocked ? null : (
              <button type="button" className="pill" data-testid="intake-restart" onClick={props.onClearResult}>重新立项</button>
            )}
          </div>
          {latest === undefined
            ? <p className="empty" data-testid="intake-result-empty">还没有需求；等模型落盘后点「刷新需求」。</p>
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
        </section>
      )}
    </DetailDrawer>
  )
}
