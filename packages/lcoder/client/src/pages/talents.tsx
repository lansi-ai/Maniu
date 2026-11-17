/** 人才库页：全局（内置角色在前）与项目两库、表单、权限分支与引用拦截。 */

import { useState } from 'react'
import type { JSX } from 'react'
import type { MessageKey, Translate } from '../locale.ts'
import type { SessionSummary } from '../store.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import { currentPresetId, pluginPackageOf, presetIdOf, type BuiltinPresetView, type TalentRow } from '../talents/model.ts'
import { personaSummaryKeyOf, toolCopyKeyOf } from '../talents/detail-copy.ts'
import type { BuiltinDetailState, TalentsHandle } from '../talents/use-talents.ts'
import { TalentForm, type TalentFormValue } from './talent-form.tsx'
import { DetailDrawer } from './detail-drawer.tsx'

/** 人才库页属性。 */
export interface TalentsPageProps {
  readonly t: Translate
  readonly signedIn: boolean
  readonly userId: string | null
  readonly project: ProjectScope | null
  readonly sessions: readonly SessionSummary[]
  readonly talents: TalentsHandle
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
  const [builtinOpen, setBuiltinOpen] = useState<string | null>(null)
  const [personaOpen, setPersonaOpen] = useState(false)

  const sessionsOfPreset = (presetId: string): number =>
    sessions.filter(session => session.agentPreset !== undefined && currentPresetId(session.agentPreset) === presetId).length

  const sessionsOf = (row: TalentRow): number => sessionsOfPreset(presetIdOf(row.id))

  const creatorOf = (row: TalentRow): string => row.ownerUserId === props.userId
    ? t('talents.creatorSelf')
    : t('talents.creatorOther', { id: row.ownerUserId.slice(0, 8) })

  const openBuiltin = (presetId: string): void => {
    setBuiltinOpen(presetId)
    setPersonaOpen(false)
    talents.inspectBuiltin(presetId)
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
        {!talents.applied.has(row.id) && applyError === undefined
          ? <p className="empty">{t('talents.applying')}</p>
          : null}
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

  const builtinCard = (row: BuiltinPresetView): JSX.Element => {
    const actionError = actionErrors[row.id]
    return (
      <article
        key={row.id}
        className="info-card lg-glass-card talent-card builtin-card"
        data-testid="builtin-card"
        data-builtin-id={row.id}
        onClick={() => { openBuiltin(row.id) }}
      >
        <div className="detail-drawer-head">
          <h3>{row.name ?? row.id}</h3>
          <div className="builtin-tags">
            <span className="tag" data-testid="builtin-source">{t('talents.sourceBuiltin')}</span>
            {row.isDefault ? <span className="tag">{t('talents.defaultRole')}</span> : null}
          </div>
        </div>
        {row.description === undefined || row.description === '' ? null : <p className="detail-line">{row.description}</p>}
        <dl className="talent-meta">
          <div><dt>{t('talents.sessions')}</dt><dd data-testid="builtin-sessions">{String(sessionsOfPreset(row.id))}</dd></div>
          <div><dt>{t('talents.model')}</dt><dd>{t('talents.modelGlobal')}</dd></div>
        </dl>
        {row.broken === undefined ? null : (
          <p className="problem" data-testid="builtin-broken">{t('talents.builtinBroken', { detail: row.broken })}</p>
        )}
        {actionError === undefined ? null : <p className="problem">{actionError}</p>}
        <div className="talent-actions">
          <button
            type="button"
            className="pill"
            data-testid="builtin-detail-open"
            onClick={(event) => { event.stopPropagation(); openBuiltin(row.id) }}
          >
            {t('talents.detail')}
          </button>
        </div>
      </article>
    )
  }

  const builtinTags = (row: BuiltinPresetView): JSX.Element => (
    <div className="builtin-tags">
      <span className="tag">{t('talents.sourceBuiltin')}</span>
      {row.isDefault ? <span className="tag">{t('talents.defaultRole')}</span> : null}
    </div>
  )

  const builtinDrawer = (row: BuiltinPresetView): JSX.Element => {
    const detail: BuiltinDetailState | undefined = talents.builtinDetails[row.id]
    const summaryKey = personaSummaryKeyOf(row.id)
    const installed: ReadonlySet<string> | null = talents.catalog === null
      ? null
      : new Set(talents.catalog.plugins.map(plugin => plugin.name))
    return (
      <DetailDrawer
        t={t}
        testId="builtin-detail"
        closeTestId="builtin-detail-close"
        onClose={() => { setBuiltinOpen(null) }}
        attributes={{ 'data-builtin-id': row.id }}
        head={builtinTags(row)}
      >
        <h3>{row.name ?? row.id}</h3>
        {row.description === undefined || row.description === '' ? null : <p className="detail-line">{row.description}</p>}
        <dl className="talent-meta">
          <div><dt>{t('talents.presetId')}</dt><dd className="mono">{row.id}</dd></div>
          <div><dt>{t('talents.sessions')}</dt><dd>{String(sessionsOfPreset(row.id))}</dd></div>
          <div><dt>{t('talents.model')}</dt><dd>{t('talents.modelGlobal')}</dd></div>
        </dl>
        {row.broken === undefined ? null : (
          <p className="problem" data-testid="builtin-detail-broken">{t('talents.builtinBroken', { detail: row.broken })}</p>
        )}
        {detail === undefined || detail.loading ? (
          <p className="empty" data-testid="builtin-detail-loading">{t('talents.detailLoading')}</p>
        ) : (
          <>
            {detail.error === null ? null : (
              <p className="problem" data-testid="builtin-detail-error">{t('talents.detailFailed', { detail: detail.error })}</p>
            )}
            <section className="detail-section" data-testid="builtin-persona-section">
              <h4>{t('talents.personaSection')}</h4>
              {detail.error !== null
                ? null
                : detail.persona === null
                  ? <p className="empty">{t('talents.personaEmpty')}</p>
                  : (
                    <>
                      {summaryKey === undefined
                        ? (
                          <p className="detail-line" data-testid="builtin-persona-fallback">
                            {row.description === undefined || row.description === ''
                              ? t('talents.personaFallback')
                              : row.description}
                          </p>
                        )
                        : (
                          <ul className="builtin-persona-summary" data-testid="builtin-persona-summary">
                            {t(summaryKey).split('\n').map(line => <li key={line}>{line}</li>)}
                          </ul>
                        )}
                      <button
                        type="button"
                        className="pill"
                        data-testid="builtin-persona-toggle"
                        aria-expanded={personaOpen}
                        onClick={() => { setPersonaOpen(current => !current) }}
                      >
                        {personaOpen ? t('talents.personaHideFull') : t('talents.personaShowFull')}
                      </button>
                      {personaOpen ? <pre className="builtin-persona" data-testid="builtin-persona">{detail.persona}</pre> : null}
                    </>
                  )}
            </section>
            <section className="detail-section" data-testid="builtin-plugins-section">
              <h4>{t('talents.pluginsSection')}</h4>
              {detail.error !== null ? null : (
                <>
                  <p className="detail-line" data-testid="builtin-plugins-note">{t('talents.pluginsNote')}</p>
                  {detail.plugins.length === 0
                    ? <p className="empty">{t('talents.compositionEmpty')}</p>
                    : (
                      <ul className="plain-list compact" data-testid="builtin-plugins">
                        {detail.plugins.map((plugin, index) => {
                          const packageName = pluginPackageOf(plugin.name)
                          const unknown = installed !== null && packageName !== undefined && !installed.has(packageName)
                          return (
                            <li key={`${plugin.id ?? plugin.name}-${String(index)}`} className="builtin-plugin">
                              <strong>{plugin.id ?? plugin.name}</strong>
                              <span className="mono">{plugin.name}</span>
                              {plugin.group ? <span className="tag">{t('talents.pluginGroup')}</span> : null}
                              {plugin.disabled === 'yes' ? <span className="tag">{t('talents.pluginDisabled')}</span> : null}
                              {plugin.disabled === 'conditional'
                                ? <span className="tag">{t('talents.pluginConditional')}</span>
                                : null}
                              {unknown ? (
                                <span className="tag" data-testid="builtin-plugin-unknown">{t('talents.pluginUnknown')}</span>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                </>
              )}
              {detail.error === null && installed === null
                ? <p className="empty">{t('talents.pluginsUnchecked')}</p>
                : null}
            </section>
            <section className="detail-section" data-testid="builtin-tools-section">
              <h4>{t('talents.toolsSection')}</h4>
              {detail.toolsError !== null ? (
                <p className="problem" data-testid="builtin-tools-error">
                  {t('talents.toolsUnavailable', { detail: detail.toolsError })}
                </p>
              ) : detail.tools.length === 0
                ? <p className="empty">{t('talents.toolsEmpty')}</p>
                : (
                  <>
                    <p className="detail-line" data-testid="builtin-tools-hint">{t('talents.toolsHoverHint')}</p>
                    <ul className="builtin-tools" data-testid="builtin-tools">
                      {detail.tools.map((tool) => {
                        const copyKey = toolCopyKeyOf(tool.name)
                        const copy = copyKey === undefined ? tool.description : t(copyKey)
                        return (
                          <li key={tool.name}>
                            <span
                              className="tag builtin-tool"
                              data-testid="builtin-tool"
                              data-tool-name={tool.name}
                              title={copy === '' ? undefined : copy}
                            >
                              {tool.name}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
            </section>
          </>
        )}
      </DetailDrawer>
    )
  }

  const globalGroup = (): JSX.Element => {
    const rows = talents.global
    return (
      <section className="talent-group" data-testid="talent-group-global">
        <header className="talent-group-head">
          <div>
            <h3>{t('talents.global')}</h3>
          </div>
          <button
            type="button"
            className="pill pill-accent"
            data-testid="talent-create-global"
            disabled={!canCreate}
            onClick={() => { setEditing({ scope: 'global', row: null }) }}
          >
            {t('talents.createGlobal')}
          </button>
        </header>
        {talents.builtinsError === null ? null : (
          <p className="problem" data-testid="talents-builtin-error">
            {t('talents.builtinFailed', { detail: talents.builtinsError })}
          </p>
        )}
        {talents.builtinsLoading ? <p className="empty" data-testid="talents-builtin-loading">{t('talents.builtinLoading')}</p> : null}
        {!talents.builtinsLoading && talents.builtinsError === null && talents.builtins.length === 0
          ? <p className="empty" data-testid="talent-empty-builtin">{t('talents.builtinEmpty')}</p>
          : null}
        {talents.builtins.length + rows.length === 0
          ? null
          : <div className="info-grid" data-testid="talent-list-global">
            {talents.builtins.map(builtinCard)}
            {rows.map(card)}
          </div>}
        {rows.length === 0 ? <p className="empty" data-testid="talent-empty">{t('talents.emptyGlobal')}</p> : null}
      </section>
    )
  }

  const label = (key: MessageKey): string => t(key)
  const projectReady = props.project !== null
  const identity = talents.project
  const hasProjectId = identity !== null && identity.state === 'ready' && identity.projectId !== null
  const canCreate = talents.catalog !== null && props.signedIn
  const openBuiltinRow = builtinOpen === null
    ? undefined
    : talents.builtins.find(row => row.id === builtinOpen)

  return (
    <section className="page" data-testid="page-talents">
      <header className="page-head">
        <div>
          <h2>{t('talents.title')}</h2>
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

      {globalGroup()}

      <section className="talent-group" data-testid="talent-group-project">
        <header className="talent-group-head">
          <div>
            <h3>{t('talents.project')}</h3>
          </div>
          {hasProjectId ? (
            <button
              type="button"
              className="pill pill-accent"
              data-testid="talent-create-project"
              disabled={!canCreate}
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

      {openBuiltinRow === undefined ? null : builtinDrawer(openBuiltinRow)}
    </section>
  )
}
