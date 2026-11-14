/** 项目信息页：`.spec/project.yaml` 的事实、项目运行时与本机密码揭示。 */

import { useState } from 'react'
import type { JSX } from 'react'
import type { Translate } from '../locale.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'

/** 项目信息页属性。 */
export interface ProjectInfoPageProps {
  readonly t: Translate
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly loading: boolean
  readonly error: string | null
  readonly onReload: () => void
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
          <button type="button" className="pill" data-testid="project-info-reload" onClick={props.onReload}>
            {props.loading ? '读取中…' : '刷新'}
          </button>
        </div>
      </header>

      {props.project === null && <p className="empty" data-testid="project-info-no-project">先在「切换项目」里打开一个仓库。</p>}
      {props.error !== null && <pre className="problem" data-testid="project-info-problems">{props.error}</pre>}

      {props.project !== null && (
        <div className="info-grid">
          <section className="info-card lg-glass-card">
            <h3>仓库</h3>
            <dl className="kv">
              <dt>项目</dt><dd>{props.project.title}</dd>
              <dt>路径</dt><dd className="mono">{props.project.path}</dd>
              <dt>作用域会话</dt><dd className="mono">{props.project.scopeSessionId}</dd>
              <dt>类型</dt><dd>{info?.kind ?? '—'}</dd>
              <dt>分支</dt><dd>{info?.branch ?? '—'}</dd>
              <dt>远端</dt><dd className="mono">{info === null || info.repoUrl === '' ? '—' : info.repoUrl}</dd>
            </dl>
          </section>

          <section className="info-card lg-glass-card">
            <h3>文档入口</h3>
            <dl className="kv">
              <dt>产品</dt><dd className="mono">{docsOf(info, 'product')}</dd>
              <dt>架构</dt><dd className="mono">{docsOf(info, 'architecture')}</dd>
              <dt>测试</dt><dd className="mono">{docsOf(info, 'tests')}</dd>
            </dl>
            <h3>轨</h3>
            <p className="detail-line">
              {info === null || info.tracks.length === 0 ? '未追加轨' : info.tracks.map(track => `${track.name}（${track.id}）`).join('、')}
            </p>
          </section>

          <section className="info-card lg-glass-card wide">
            <h3>环境</h3>
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
                        <button
                          type="button"
                          className="pill"
                          data-testid="project-secret-toggle"
                          data-env={env.id}
                          aria-pressed={shown}
                          onClick={() => { toggleReveal(env.id) }}
                        >
                          {shown ? props.t('project.hidePassword') : props.t('project.revealPassword')}
                        </button>
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
          </section>
        </div>
      )}
    </section>
  )
}

function docsOf(info: SpecProjection['project'], key: 'product' | 'architecture' | 'tests'): string {
  const value = info?.docs[key] ?? ''
  return value === '' ? '—' : value
}
