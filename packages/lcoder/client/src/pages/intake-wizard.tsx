/** 立项向导与结果页：选择档位、预览指令、发送并在结果里查看新需求。 */

import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Chip, Separator, Tabs } from '@heroui/react'
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

  const selectMode = (key: unknown): void => {
    if (key !== 'fresh' && key !== 'onboarding') return
    setMode(key)
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
      <div className="intake-role-row" data-testid="intake-role">
        <Chip variant="soft" color="accent" size="sm">{t('intake.roleName')}</Chip>
        <span className="detail-note">{t('intake.roleLabel', { name: rosterName ?? t('intake.roleName') })}</span>
      </div>

      {started === null && blocked && (
        <Card className="intake-section" data-testid="intake-blocked">
          <Card.Header><Card.Title>项目已有内容</Card.Title></Card.Header>
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
          <Card className="intake-section">
            <Card.Header><Card.Title>项目</Card.Title></Card.Header>
            <Separator />
            <Card.Content>
              <dl className="kv">
                <dt>名称</dt><dd>{props.project.title}</dd>
                <dt>路径</dt><dd className="mono">{props.project.path}</dd>
              </dl>
            </Card.Content>
          </Card>

          <Card className="intake-section">
            <Card.Header><Card.Title>档位</Card.Title></Card.Header>
            <Separator />
            <Card.Content>
              <Tabs
                className="intake-mode-tabs"
                selectedKey={mode}
                onSelectionChange={selectMode}
                aria-label="立项档位"
              >
                <Tabs.List>
                  <Tabs.Tab key="fresh" id="fresh" data-testid="intake-mode-fresh">全新项目</Tabs.Tab>
                  <Tabs.Tab key="onboarding" id="onboarding" data-testid="intake-mode-onboarding">已有资料</Tabs.Tab>
                </Tabs.List>
              </Tabs>
              <p className="detail-note">指令会发送到一条新的需求分析师会话；模型先做 7 问访谈，出《项目需求概要》等你回复「确认需求」后才落盘。</p>
            </Card.Content>
          </Card>

          <Card className="intake-section">
            <Card.Header><Card.Title>指令预览</Card.Title></Card.Header>
            <Separator />
            <Card.Content>
              <pre className="prompt-preview" data-testid="intake-prompt">{prompt}</pre>
            </Card.Content>
          </Card>

          {failure !== null && <p className="problem" data-testid="intake-error">{failure}</p>}
          <div className="detail-drawer-head">
            <Button variant="primary" data-testid="intake-start" isDisabled={busy} onPress={() => { void start() }}>
              {busy ? '发送中…' : '开始立项'}
            </Button>
          </div>
        </>
      )}

      {started !== null && (
        <Card className="intake-section" data-testid="intake-result">
          <Card.Header><Card.Title>结果</Card.Title></Card.Header>
          <Separator />
          <Card.Content>
            <p className="detail-line" data-testid="intake-result-message">{started.message}</p>
            <div className="detail-drawer-head">
              <Button variant="secondary" data-testid="intake-result-refresh" onPress={props.onReload}>刷新需求</Button>
              {blocked ? null : (
                <Button variant="secondary" data-testid="intake-restart" onPress={props.onClearResult}>重新立项</Button>
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
          </Card.Content>
        </Card>
      )}
    </DetailDrawer>
  )
}
