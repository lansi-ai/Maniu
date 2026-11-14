/** 专家与角色看板：宿主 preset 名册、项目岗位与各自会话。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { SpecProjection } from '../spec/load.ts'
import type { SessionSummary } from '../store.ts'

/** 宿主声明的一个 preset。 */
interface PresetRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
  readonly broken: string
}

/** 角色看板属性。 */
export interface RolesPageProps {
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly reloadToken: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 角色看板。
 * @param props - 投影、会话与重读令牌。
 * @returns 页面。
 */
export function RolesPage(props: RolesPageProps): JSX.Element {
  const [presets, setPresets] = useState<readonly PresetRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    void window.lcoder.call('agentPresets', 'list', {}).then((answer) => {
      if (disposed) return
      if (!answer.ok) {
        setError(`${answer.error.code}: ${answer.error.message}`)
        return
      }
      const value = answer.value
      const list = isRecord(value) && Array.isArray(value.presets) ? value.presets : []
      setPresets(list.flatMap((entry): PresetRow[] => {
        if (!isRecord(entry) || typeof entry.id !== 'string') return []
        return [{
          id: entry.id,
          name: typeof entry.name === 'string' ? entry.name : entry.id,
          description: typeof entry.description === 'string' ? entry.description : '',
          isDefault: entry.isDefault === true,
          broken: typeof entry.broken === 'string' ? entry.broken : '',
        }]
      }))
    }).catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { disposed = true }
  }, [props.reloadToken])

  const sessionsOf = (preset: string): readonly SessionSummary[] =>
    props.sessions.filter(session => session.agentPreset === preset)

  return (
    <section className="page" data-testid="page-roles">
      <header className="page-head">
        <div>
          <h2>角色</h2>
          <p className="page-sub">{presets.length} 个宿主 preset · {props.projection.roles.length} 个项目岗位</p>
        </div>
      </header>

      {error !== null && <pre className="problem" data-testid="roles-error">{error}</pre>}

      <div className="info-grid" data-testid="preset-list">
        {presets.map((preset) => {
          const bound = sessionsOf(preset.id)
          return (
            <section key={preset.id} className="info-card lg-glass-card" data-testid="preset-card" data-preset-id={preset.id}>
              <div className="detail-drawer-head">
                <h3>{preset.name}</h3>
                {preset.isDefault && <span className="tag">默认</span>}
              </div>
              <p className="mono">{preset.id}</p>
              {preset.description !== '' && <p className="detail-line">{preset.description}</p>}
              {preset.broken !== '' && <p className="problem">激活失败：{preset.broken}</p>}
              <p className="detail-line">会话 {bound.length} 条{bound.some(session => session.running) ? ' · 有运行中' : ''}</p>
              {bound.length > 0 && (
                <ul className="plain-list compact">
                  {bound.slice(0, 5).map(session => (
                    <li key={session.sessionId}>
                      <strong className="mono">{session.sessionId.slice(0, 8)}</strong>
                      <span>{session.cwd ?? '—'}</span>
                      <em>{session.running ? '运行中' : '空闲'}</em>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <section className="info-card lg-glass-card" data-testid="project-roles">
        <h3>项目岗位（`.spec/roles.yaml`）</h3>
        {props.projection.roles.length === 0
          ? <p className="empty">没有自定岗位；实施按内置角色分配。</p>
          : (
            <ul className="plain-list">
              {props.projection.roles.map(role => (
                <li key={role.id} data-testid="project-role" data-role-id={role.id}>
                  <strong>{role.name}（{role.id}）</strong>
                  <span>继承：{role.inherits}</span>
                  {role.persona !== undefined && <span>{role.persona}</span>}
                  {role.signals !== undefined && (
                    <em>
                      信号：{[...role.signals.strong, ...role.signals.medium, ...role.signals.preferredPaths].join('、')}
                    </em>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>
    </section>
  )
}
