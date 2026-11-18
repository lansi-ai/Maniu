/** 项目信息页：`.spec/project.yaml` 的事实、流程配置、项目运行时与本机密码揭示。 */

import { useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, ListBox, Select, Separator, Switch } from '@heroui/react'
import type { Translate } from '../locale.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { FlowNodeRow } from '../spec/rows.ts'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { BUILTIN_FLOW_PRESETS, flowNodesOf, flowRoleLabel, flowSaveLine } from '../flow/config.ts'

/** 项目信息页属性。 */
export interface ProjectInfoPageProps {
  readonly t: Translate
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly loading: boolean
  readonly error: string | null
  readonly onReload: () => void
  /** preset 名册显示名；流程配置节的岗位名优先取它，读不到回退词典。 */
  readonly presetNames?: Readonly<Record<string, string>>
}

/**
 * 项目信息页。
 *
 * 密码值只取投影里已读进内存的 `.spec/local.yaml` 结果，点击眼睛才显示；
 * 不写日志、不进模型、不落渲染端持久存储。
 * @param props - 词典、项目与投影。
 * @returns 页面。
 */
export function ProjectInfoPage(props: ProjectInfoPageProps): JSX.Element {
  const info = props.projection.project
  const [revealed, setRevealed] = useState<Readonly<Record<string, boolean>>>({})
  const toggleReveal = (envId: string): void => {
    setRevealed(current => ({ ...current, [envId]: current[envId] !== true }))
  }

  return (
    <section className="page" data-testid="page-project-info">
      <header className="page-head">
        <div>
          <h2>项目信息</h2>
          <p className="page-sub">{props.project?.path ?? '未选择项目'}</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" data-testid="project-info-reload" onPress={props.onReload}>
            {props.loading ? '读取中…' : '刷新'}
          </Button>
        </div>
      </header>

      {props.project === null && <p className="empty" data-testid="project-info-no-project">先在「切换项目」里打开一个仓库。</p>}
      {props.error !== null && <pre className="problem" data-testid="project-info-problems">{props.error}</pre>}

      {props.project !== null && (
        <div className="info-grid">
          <Card className="info-card">
            <Card.Header><Card.Title>仓库</Card.Title></Card.Header>
            <Card.Content>
              <dl className="kv">
                <dt>项目</dt><dd>{props.project.title}</dd>
                <dt>路径</dt><dd className="mono">{props.project.path}</dd>
                <dt>作用域会话</dt><dd className="mono">{props.project.scopeSessionId}</dd>
                <dt>类型</dt><dd>{info?.kind ?? '—'}</dd>
                <dt>分支</dt><dd>{info?.branch ?? '—'}</dd>
                <dt>远端</dt><dd className="mono">{info === null || info.repoUrl === '' ? '—' : info.repoUrl}</dd>
              </dl>
            </Card.Content>
          </Card>

          <Card className="info-card">
            <Card.Header><Card.Title>文档入口</Card.Title></Card.Header>
            <Card.Content>
              <dl className="kv">
                <dt>产品</dt><dd className="mono">{docsOf(info, 'product')}</dd>
                <dt>架构</dt><dd className="mono">{docsOf(info, 'architecture')}</dd>
                <dt>测试</dt><dd className="mono">{docsOf(info, 'tests')}</dd>
              </dl>
              <Separator className="info-divider" />
              <h4 className="info-subtitle">轨</h4>
              <p className="detail-line">
                {info === null || info.tracks.length === 0 ? '未追加轨' : info.tracks.map(track => `${track.name}（${track.id}）`).join('、')}
              </p>
            </Card.Content>
          </Card>

          <FlowConfigSection
            t={props.t}
            project={props.project}
            projection={props.projection}
            onReload={props.onReload}
            {...(props.presetNames === undefined ? {} : { presetNames: props.presetNames })}
          />

          <Card className="info-card wide">
            <Card.Header><Card.Title>环境</Card.Title></Card.Header>
            <Card.Content>
              {(info?.environments ?? []).length === 0 && <p className="empty">`.spec/project.yaml` 没有声明环境。</p>}
              <ul className="plain-list">
                {(info?.environments ?? []).map((env) => {
                  const database = env.database
                  const shown = revealed[env.id] === true
                  const secret = database === undefined ? undefined : props.projection.secrets[database.passwordRef]
                  return (
                    <li key={env.id}>
                      <strong>{env.label}</strong>
                      {env.server !== undefined && <span>服务器：{env.server}</span>}
                      {database !== undefined && (
                        <span>
                          数据库：{database.user}@{database.host}
                          {database.port === undefined ? '' : `:${database.port}`}/{database.name}
                        </span>
                      )}
                      {database !== undefined && (
                        <span className="secret-row">
                          <span>{props.t('project.password')}</span>
                          <code className="secret-value" data-testid="project-secret-value" data-env={env.id}>
                            {shown ? (secret ?? props.t('project.passwordUnset')) : '••••••'}
                          </code>
                          <Button
                            size="sm"
                            variant="secondary"
                            data-testid="project-secret-toggle"
                            data-env={env.id}
                            aria-pressed={shown}
                            onPress={() => { toggleReveal(env.id) }}
                          >
                            {shown ? props.t('project.hidePassword') : props.t('project.revealPassword')}
                          </Button>
                        </span>
                      )}
                      {database !== undefined && (
                        <em>
                          {props.t('project.passwordRef')} {database.passwordRef} · {props.t('project.secretNote')}
                        </em>
                      )}
                      {env.note !== undefined && <em>{env.note}</em>}
                    </li>
                  )
                })}
              </ul>
            </Card.Content>
          </Card>
        </div>
      )}
    </section>
  )
}

function docsOf(info: SpecProjection['project'], key: 'product' | 'architecture' | 'tests'): string {
  const value = info?.docs[key] ?? ''
  return value === '' ? '—' : value
}

/** 交换两个位置的岗位；越界时原样返回。 */
function swapRoles(roles: readonly string[], a: number, b: number): readonly string[] {
  const left = roles[a]
  const right = roles[b]
  if (left === undefined || right === undefined) return roles
  const next = [...roles]
  next[a] = right
  next[b] = left
  return next
}

/** 流程配置节属性。 */
interface FlowConfigSectionProps {
  readonly t: Translate
  readonly project: ProjectScope
  readonly projection: SpecProjection
  readonly onReload: () => void
  readonly presetNames?: Readonly<Record<string, string>>
}

/**
 * 流程配置节：四节点岗位多选、排序、自动衔接开关与恢复预制；保存走 `/flow_save` 人机命令。
 * @param props - 词典、项目、投影与刷新回调。
 * @returns 配置节。
 */
function FlowConfigSection(props: FlowConfigSectionProps): JSX.Element {
  const t = props.t
  const [edited, setEdited] = useState<readonly FlowNodeRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CommandOutcome | null>(null)
  const nodes = edited ?? flowNodesOf(props.projection.flow)
  const configured = props.projection.flow !== null && props.projection.flow !== undefined
  const labelCtx = {
    ...(props.presetNames === undefined ? {} : { presetNames: props.presetNames }),
    roster: props.projection.roles,
    t,
  }
  const candidates = [
    ...BUILTIN_FLOW_PRESETS.map(id => ({ id, label: flowRoleLabel(id, labelCtx) })),
    ...props.projection.roles.map(role => ({ id: role.id, label: role.name })),
  ]
  const emptyRoles = nodes.some(node => node.roles.length === 0)

  const update = (kind: FlowNodeRow['node'], change: (node: FlowNodeRow) => FlowNodeRow): void => {
    setEdited(nodes.map(node => node.node === kind ? change(node) : node))
  }

  const execute = async (line: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const outcome = await runCommand(props.project.scopeSessionId, line)
      setResult(outcome)
      if (outcome.ok) {
        setEdited(null)
        props.onReload()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="info-card wide" data-testid="flow-config-section">
      <Card.Header><Card.Title>{t('flow.sectionTitle')}</Card.Title></Card.Header>
      <Card.Content>
        <p className="detail-note" data-testid="flow-source" data-configured={configured ? 'true' : 'false'}>
          {t(configured ? 'flow.sourceFile' : 'flow.sourcePreset')}
        </p>
        {nodes.map(node => (
          <div key={node.node} className="flow-node" data-testid="flow-node" data-node={node.node}>
            <h4>{t(`flow.node.${node.node}`)}</h4>
            <p className="detail-line">{t('flow.roles')}</p>
            <ol className="plain-list compact">
              {node.roles.map((role, index) => (
                <li key={`${role}-${String(index)}`} data-testid="flow-role-item" data-role={role}>
                  <span>{flowRoleLabel(role, labelCtx)}</span>
                  <span className="row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="flow-role-up"
                      isDisabled={busy || index === 0}
                      onPress={() => {
                        update(node.node, current => ({ ...current, roles: swapRoles(current.roles, index, index - 1) }))
                      }}
                    >
                      {t('flow.roleUp')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="flow-role-down"
                      isDisabled={busy || index === node.roles.length - 1}
                      onPress={() => {
                        update(node.node, current => ({ ...current, roles: swapRoles(current.roles, index, index + 1) }))
                      }}
                    >
                      {t('flow.roleDown')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="flow-role-remove"
                      isDisabled={busy}
                      onPress={() => {
                        update(node.node, current => ({ ...current, roles: current.roles.filter((_, i) => i !== index) }))
                      }}
                    >
                      {t('flow.roleRemove')}
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="row-actions">
              <Select
                className="flow-role-select"
                data-testid="flow-role-add"
                value=""
                isDisabled={busy}
                placeholder={t('flow.addPlaceholder')}
                aria-label={t('flow.addRole')}
                onChange={(key) => {
                  if (typeof key !== 'string' || key === '') return
                  update(node.node, current => ({ ...current, roles: [...current.roles, key] }))
                }}
              >
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {candidates.filter(candidate => !node.roles.includes(candidate.id)).map(candidate => (
                      <ListBox.Item key={candidate.id} id={candidate.id} textValue={`${candidate.label}（${candidate.id}）`}>
                        {candidate.label}（{candidate.id}）
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <span className="flow-auto-wrap" title={t('flow.autoHint')}>
                <Switch
                  className="flow-auto"
                  isSelected={node.auto}
                  isDisabled={busy}
                  onChange={(selected) => {
                    update(node.node, current => ({ ...current, auto: selected }))
                  }}
                >
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  <Switch.Content data-testid="flow-auto">{t('flow.auto')}</Switch.Content>
                </Switch>
              </span>
            </div>
          </div>
        ))}
        {emptyRoles && <p className="detail-note" data-testid="flow-empty-roles">{t('flow.emptyRoles')}</p>}
        <div className="action-row">
          <Button
            variant="primary"
            data-testid="flow-save"
            isDisabled={busy || emptyRoles}
            onPress={() => { void execute(flowSaveLine(nodes)) }}
          >
            {busy ? t('flow.saving') : t('flow.save')}
          </Button>
          <Button
            variant="secondary"
            data-testid="flow-reset"
            isDisabled={busy}
            onPress={() => { void execute('/flow_save preset') }}
          >
            {t('flow.reset')}
          </Button>
        </div>
        {result !== null && (
          <p className={result.ok ? 'detail-line' : 'problem'} data-testid="flow-result" data-ok={result.ok ? 'true' : 'false'}>
            {result.text}
          </p>
        )}
      </Card.Content>
    </Card>
  )
}
