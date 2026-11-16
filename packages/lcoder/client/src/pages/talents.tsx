/** 人才库页：全局与项目两库、表单、权限分支、引用拦截与从人才开会话。 */

import { useState } from 'react'
import type { JSX } from 'react'
import type { MessageKey, Translate } from '../locale.ts'
import type { SessionSummary } from '../store.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { TalentRow } from '../talents/model.ts'
import { presetIdOf } from '../talents/model.ts'
import type { TalentsHandle } from '../talents/use-talents.ts'
import { TalentForm, type TalentFormValue } from './talent-form.tsx'

/** 人才库页属性。 */
export interface TalentsPageProps {
  readonly t: Translate
  readonly userId: string | null
  readonly project: ProjectScope | null
  readonly sessions: readonly SessionSummary[]
  readonly talents: TalentsHandle
  readonly onStartSession: (presetId: string) => Promise<{ readonly ok: boolean; readonly message: string }>
}

interface Editing {
  readonly scope: 'global' | 'project'
  readonly row: TalentRow | null
}

/** 去掉一条键；动态删除属性会拖慢对象，集中在这里用重建代替。 */
function without<Value>(record: Readonly<Record<string, Value>>, key: string): Record<string, Value> {
  const next: Record<string, Value> = {}
  for (const [name, value] of Object.entries(record)) {
    if (name !== key) next[name] = value
  }
  return next
}

/**
 * 人才库页。
 * @param props - 词典、当前账号、项目、会话与运行面。
 * @returns 两库列表与表单。
 */
export function TalentsPage(props: TalentsPageProps): JSX.Element {
  const { t, talents, sessions } = props
  const [editing, setEditing] = useState<Editing | null>(null)
  const [blocked, setBlocked] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [actionErrors, setActionErrors] = useState<Readonly<Record<string, string>>>({})

  const sessionsOf = (row: TalentRow): number =>
    sessions.filter(session => session.agentPreset === presetIdOf(row.id)).length

  const creatorOf = (row: TalentRow): string => row.ownerUserId === props.userId
    ? t('talents.creatorSelf')
    : t('talents.creatorOther', { id: row.ownerUserId.slice(0, 8) })

  const start = async (row: TalentRow): Promise<void> => {
    const answer = await props.onStartSession(presetIdOf(row.id))
    if (!answer.ok) setActionErrors(current => ({ ...current, [row.id]: answer.message }))
  }

  const askDelete = async (row: TalentRow): Promise<void> => {
    setActionErrors(current => without(current, row.id))
    const refs = await talents.checkRefs(row.id)
    if (!refs.ok) {
      setActionErrors(current => ({ ...current, [row.id]: refs.message }))
      return
    }
    if (refs.sessionIds.length > 0) {
      setBlocked(current => ({ ...current, [row.id]: refs.sessionIds }))
      setConfirming(null)
      return
    }
    setBlocked(current => without(current, row.id))
    setConfirming(row.id)
  }

  const confirmDelete = async (row: TalentRow): Promise<void> => {
    const failure = await talents.remove(row.id)
    setConfirming(null)
    if (failure !== null) setActionErrors(current => ({ ...current, [row.id]: failure }))
  }

  const save = async (scope: 'global' | 'project', row: TalentRow | null, value: TalentFormValue): Promise<string | null> => {
    const failure = row === null
      ? await talents.create({
        scope,
        ...scope === 'project' && talents.project?.projectId !== null && talents.project?.projectId !== undefined
          ? { projectId: talents.project.projectId }
          : {},
        name: value.name,
        description: value.description,
        config: value.config,
      })
      : await talents.update({
        id: row.id,
        name: value.name,
        description: value.description,
        config: value.config,
        expectedRevision: row.revision,
      })
    if (failure === null) setEditing(null)
    return failure
  }

  const card = (row: TalentRow): JSX.Element => {
    const applyError = talents.applyErrors[row.id]
    const actionError = actionErrors[row.id]
    const refs = blocked[row.id]
    const model = row.config.model === undefined
      ? t('talents.modelFollow')
      : `${row.config.model.provider}/${row.config.model.modelId}`
    const ready = talents.applied.has(row.id)
    return (
      <article
        key={row.id}
        className="info-card lg-glass-card talent-card"
        data-testid="talent-card"
        data-talent-id={row.id}
        data-scope={row.scope}
      >
        <div className="detail-drawer-head">
          <h3>{row.name}</h3>
          <span className="tag">{row.createdBy === 'ai' ? t('talents.sourceAi') : t('talents.sourceUser')}</span>
        </div>
        {row.description === '' ? null : <p className="detail-line">{row.description}</p>}
        <dl className="talent-meta">
          <div><dt>{t('talents.creator')}</dt><dd>{creatorOf(row)}</dd></div>
          <div><dt>{t('talents.model')}</dt><dd>{model}</dd></div>
          <div><dt>{t('talents.sessions')}</dt><dd>{String(sessionsOf(row))}</dd></div>
        </dl>
        {!ready && applyError === undefined ? <p className="empty">{t('talents.applying')}</p> : null}
        {applyError === undefined ? null : <p className="problem">{t('talents.applyFailed', { detail: applyError })}</p>}
        {actionError === undefined ? null : <p className="problem">{actionError}</p>}
        {refs === undefined ? null : (
          <p className="problem" data-testid="talent-delete-blocked">
            {t('talents.deleteReferenced', { count: refs.length, sessions: refs.slice(0, 3).join('、') })}
          </p>
        )}
        {confirming === row.id ? (
          <div className="talent-actions">
            <span className="detail-line">{t('talents.deleteConfirm')}</span>
            <button type="button" className="pill" data-testid="talent-delete-cancel" onClick={() => { setConfirming(null) }}>
              {t('talents.cancel')}
            </button>
            <button
              type="button"
              className="pill pill-accent"
              data-testid="talent-delete-confirm"
              disabled={talents.busy}
              onClick={() => { void confirmDelete(row) }}
            >
              {t('talents.delete')}
            </button>
          </div>
        ) : (
          <div className="talent-actions">
            <button
              type="button"
              className="pill pill-accent"
              data-testid="talent-start"
              disabled={!ready}
              onClick={() => { void start(row) }}
            >
              {t('talents.start')}
            </button>
            {row.canManage ? (
              <>
                <button
                  type="button"
                  className="pill"
                  data-testid="talent-edit"
                  onClick={() => { setEditing({ scope: row.scope, row }) }}
                >
                  {t('talents.edit')}
                </button>
                <button
                  type="button"
                  className="pill"
                  data-testid="talent-delete"
                  disabled={talents.busy}
                  onClick={() => { void askDelete(row) }}
                >
                  {t('talents.delete')}
                </button>
              </>
            ) : (
              <span className="settings-muted" data-testid="talent-cannot-manage">{t('talents.cannotManage')}</span>
            )}
          </div>
        )}
      </article>
    )
  }

  const group = (scope: 'global' | 'project', rows: readonly TalentRow[]): JSX.Element => (
    <section className="talent-group" data-testid={scope === 'global' ? 'talent-group-global' : 'talent-group-project'}>
      <header className="talent-group-head">
        <div>
          <h3>{scope === 'global' ? t('talents.global') : t('talents.project')}</h3>
          <p className="page-sub">{scope === 'global' ? t('talents.globalHint') : t('talents.projectHint')}</p>
        </div>
        <button
          type="button"
          className="pill pill-accent"
          data-testid={scope === 'global' ? 'talent-create-global' : 'talent-create-project'}
          disabled={talents.catalog === null}
          onClick={() => { setEditing({ scope, row: null }) }}
        >
          {scope === 'global' ? t('talents.createGlobal') : t('talents.createProject')}
        </button>
      </header>
      {rows.length === 0
        ? <p className="empty" data-testid="talent-empty">{scope === 'global' ? t('talents.emptyGlobal') : t('talents.emptyProject')}</p>
        : <div className="info-grid" data-testid={scope === 'global' ? 'talent-list-global' : 'talent-list-project'}>
          {rows.map(card)}
        </div>}
    </section>
  )

  const label = (key: MessageKey): string => t(key)
  const projectReady = props.project !== null
  const identity = talents.project
  const hasProjectId = identity !== null && identity.state === 'ready' && identity.projectId !== null

  return (
    <section className="page" data-testid="page-talents">
      <header className="page-head">
        <div>
          <h2>{t('talents.title')}</h2>
          <p className="page-sub">
            {t('talents.subtitle', { count: talents.global.length + talents.projectTalents.length })}
            {props.project === null ? '' : ` · ${props.project.title}`}
          </p>
        </div>
        <button type="button" className="pill" data-testid="talent-reload" onClick={() => { talents.reload() }}>
          {t('talents.reload')}
        </button>
      </header>

      {talents.error === null ? null : (
        <pre className="problem" data-testid="talents-error">{label('talents.loadFailed')} {talents.error}</pre>
      )}
      {talents.loading ? <p className="empty" data-testid="talents-loading">{t('talents.loading')}</p> : null}
      {talents.catalogError === null ? null : (
        <p className="problem" data-testid="talents-catalog-error">
          {t('talents.catalogFailed', { detail: talents.catalogError })}
        </p>
      )}

      {editing !== null && talents.catalog !== null ? (
        <TalentForm
          t={t}
          catalog={talents.catalog}
          scope={editing.scope}
          initial={editing.row}
          busy={talents.busy}
          onCancel={() => { setEditing(null) }}
          onSave={value => save(editing.scope, editing.row, value)}
        />
      ) : null}

      {group('global', talents.global)}

      <section className="talent-group" data-testid="talent-group-project">
        <header className="talent-group-head">
          <div>
            <h3>{t('talents.project')}</h3>
            <p className="page-sub">{t('talents.projectHint')}</p>
          </div>
          {hasProjectId ? (
            <button
              type="button"
              className="pill pill-accent"
              data-testid="talent-create-project"
              disabled={talents.catalog === null}
              onClick={() => { setEditing({ scope: 'project', row: null }) }}
            >
              {t('talents.createProject')}
            </button>
          ) : null}
        </header>
        {!projectReady ? <p className="empty" data-testid="talent-project-missing">{t('talents.projectMissing')}</p> : null}
        {projectReady && talents.projectError !== null ? (
          <p className="problem">{t('talents.projectFailed', { detail: talents.projectError })}</p>
        ) : null}
        {projectReady && talents.projectError === null && identity === null
          ? <p className="empty">{t('talents.loading')}</p> : null}
        {projectReady && identity !== null && identity.state === 'missing-project' ? (
          <p className="problem" data-testid="talent-project-unregistered">
            {t('talents.projectUnregistered', { path: identity.detail ?? props.project.path })}
          </p>
        ) : null}
        {projectReady && identity !== null && identity.state === 'invalid' ? (
          <p className="problem" data-testid="talent-project-invalid">
            {t('talents.projectInvalid', { detail: identity.detail ?? '' })}
          </p>
        ) : null}
        {projectReady && identity !== null && identity.state === 'unbound' ? (
          <p className="empty" data-testid="talent-project-pending">{t('talents.loading')}</p>
        ) : null}
        {hasProjectId ? (
          talents.projectTalents.length === 0
            ? <p className="empty" data-testid="talent-empty-project">{t('talents.emptyProject')}</p>
            : <div className="info-grid" data-testid="talent-list-project">{talents.projectTalents.map(card)}</div>
        ) : null}
      </section>
    </section>
  )
}
