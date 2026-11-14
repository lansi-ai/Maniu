/** 项目信息页：`.spec/project.yaml` 的事实与项目运行时。 */

import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'

/** 项目信息页属性。 */
export interface ProjectInfoPageProps {
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly loading: boolean
  readonly error: string | null
  readonly onReload: () => void
}

/**
 * 项目信息页。
 * @param props - 项目与投影。
 * @returns 页面。
 */
export function ProjectInfoPage(props: ProjectInfoPageProps): JSX.Element {
  const info = props.projection.project
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
              {(info?.environments ?? []).map(env => (
                <li key={env.id}>
                  <strong>{env.label}</strong>
                  {env.server !== undefined && <span>服务器：{env.server}</span>}
                  {env.database !== undefined && (
                    <span>
                      数据库：{env.database.user}@{env.database.host}
                      {env.database.port === undefined ? '' : `:${env.database.port}`}/{env.database.name}
                      {' '}· 密码引用 {env.database.passwordRef}
                    </span>
                  )}
                  {env.note !== undefined && <em>{env.note}</em>}
                </li>
              ))}
            </ul>
            <p className="detail-note">本机敏感值只从 `.spec/local.yaml` 读取，当前只展示引用名。</p>
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
