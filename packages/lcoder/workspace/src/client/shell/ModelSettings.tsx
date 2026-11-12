/**
 * 设置弹窗里的「模型服务」面板：provider 行表 + 行内编辑 + 手加路线表单。
 *
 * 所有数据都从 {@link ModelSettingsFace} 来，组件本身不碰 ctx；行内草稿只留在
 * 本地状态里，保存后由 face 重新加载快照。密钥输入只在本组件与 `credentials.set`
 * 之间流动，保存后立刻清空，页面上没有回显路径。
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LcoderWorkspaceKey } from '../locales.ts'
import css from './Shell.module.css'
import type {
  DefaultModelOption, ModelProviderRow, ModelSettingsFace, ModelSettingsSnapshot, ProfilePatch,
} from './model-settings.ts'
import { parseModelIds, validBaseURL, validRouteName, defaultModelOptions } from './model-settings.ts'

/** 面板 props。 */
export interface ModelSettingsProps {
  /** 装配层注入的读取与写入面。 */
  readonly face: ModelSettingsFace
  /** 当前会话；没有会话时「设为默认」不可用。 */
  readonly sessionId: SessionId | undefined
  /** 本包词典。 */
  readonly t: (key: LcoderWorkspaceKey) => string
  /** 一次写入成功后通知外壳重查模型可用性。 */
  readonly onChanged?: () => void
}

/** 一次行内编辑的提交状态。 */
type Busy = 'key' | 'profile' | 'delete' | 'discover' | 'default' | undefined

/** 把宿主或本地代码翻成一句可显示的话。 */
function failureText(code: string, t: ModelSettingsProps['t']): string {
  if (code === 'settings/conflict') return t('shell.modelSettingsConflict')
  if (code === 'invalid-name') return t('shell.modelNameInvalid')
  if (code === 'no-models') return t('shell.modelNeedModels')
  if (code === 'bad-base-url') return t('shell.modelBadBaseURL')
  if (code === 'name-taken') return t('shell.modelNameTaken')
  return code
}

/** 补词典占位符。 */
function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), text)
}

/** 行状态：文案键与配色类。 */
function rowStatus(row: ModelProviderRow): { key: LcoderWorkspaceKey; className?: string | undefined } {
  if (row.account) {
    return row.accountAvailable
      ? { key: 'shell.modelSignedIn', className: css.tagOk }
      : { key: 'shell.modelSignInNeeded', className: css.tagWarn }
  }
  if (row.error !== undefined) return { key: 'shell.modelBroken', className: css.tagDanger }
  if (row.settingsNs === '') return { key: 'shell.modelActiveOnly', className: css.pill }
  if (!row.active) return { key: 'shell.modelInactive', className: css.tagWarn }
  if (row.apiKeyConfigured) return { key: 'shell.modelConfigured', className: css.tagOk }
  if (row.apiKeyEnv === undefined && row.nativeConfigured) return { key: 'shell.modelNativeAuth', className: css.tagOk }
  return { key: 'shell.modelNotConfigured', className: css.pill }
}

/** 候选在下拉里的稳定键。 */
function optionKey(option: DefaultModelOption): string {
  return `${option.provider}\u0000${option.model}`
}

/** 候选的展示名：服务商 · 模型。 */
function optionLabel(option: DefaultModelOption, t: ModelSettingsProps['t']): string {
  return fill(t('shell.modelDefaultOption'), { provider: option.providerName, model: option.modelName })
}

/** 顶部默认模型区 props。 */
interface DefaultSectionProps {
  rows: readonly ModelProviderRow[]
  defaultSelection: { provider: string; model: string } | undefined
  face: ModelSettingsFace
  sessionId: SessionId | undefined
  t: ModelSettingsProps['t']
  onChanged: () => void
}

/**
 * 顶部「默认模型」区：从快照摊平候选，选中一个再写入当前会话与全局默认。
 * @param props - 行表、当前默认、数据面、会话、词典与保存回调。
 * @returns 当前默认、候选下拉与「设为默认」按钮。
 */
function DefaultModelSection({ rows, defaultSelection, face, sessionId, t, onChanged }: DefaultSectionProps): ReactNode {
  const options = useMemo(() => defaultModelOptions(rows), [rows])
  const currentKey = defaultSelection === undefined ? null : `${defaultSelection.provider}\u0000${defaultSelection.model}`
  const [pick, setPick] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const keys = new Set(options.map(optionKey))
  const selectedKey = pick !== null && keys.has(pick)
    ? pick
    : currentKey !== null && keys.has(currentKey) ? currentKey : options[0] === undefined ? '' : optionKey(options[0])
  const selected = options.find(option => optionKey(option) === selectedKey)
  const current = currentKey !== null && keys.has(currentKey)
    ? options.find(option => optionKey(option) === currentKey)
    : undefined
  const currentLabel = defaultSelection === undefined
    ? undefined
    : current === undefined
      ? fill(t('shell.modelDefaultOption'), { provider: defaultSelection.provider, model: defaultSelection.model })
      : optionLabel(current, t)

  const apply = async (): Promise<void> => {
    if (sessionId === undefined || selected === undefined) return
    setBusy(true); setFailure(null)
    const outcome = await face.setDefault(sessionId, selected.provider, selected.model)
    setBusy(false)
    if (outcome !== undefined) { setFailure(outcome); return }
    setPick(null)
    onChanged()
  }

  return (
    <div className={css.modelDefaultSection}>
      <div>
        <div className={css.modelGroupTitle}>{t('shell.modelDefaultModel')}</div>
        <p className={css.modelHint}>{t('shell.modelSetDefaultHint')}</p>
      </div>
      <p className={css.modelDefaultCurrent}>
        {currentLabel === undefined
          ? t('shell.modelDefaultUnset')
          : fill(t('shell.modelDefaultCurrent'), { model: currentLabel })}
      </p>
      {options.length === 0
        ? <p className={css.modelNotice}>{t('shell.modelDefaultNoModels')}</p>
        : (
          <div className={css.modelInline}>
            <select
              className={css.modelInput}
              value={selectedKey}
              aria-label={t('shell.modelDefaultModel')}
              disabled={busy}
              onChange={(event) => { setPick(event.target.value); setFailure(null) }}
            >
              {options.map(option => (
                <option key={optionKey(option)} value={optionKey(option)}>{optionLabel(option, t)}</option>
              ))}
            </select>
            <button
              type="button"
              className={css.primaryBtn}
              disabled={busy || sessionId === undefined}
              onClick={() => { void apply() }}
            >
              {busy ? t('shell.modelSaving') : t('shell.modelSetDefault')}
            </button>
          </div>
        )}
      {sessionId === undefined ? <p className={css.modelNotice}>{t('shell.modelSetDefaultNoSession')}</p> : null}
      {failure !== null ? <p className={css.modelError}>{failure}</p> : null}
    </div>
  )
}

/**
 * 模型服务面板。
 * @param props - 数据面、会话、词典与变更回调。
 * @returns 分组行表、行内编辑与添加表单。
 */
export function ModelSettings({ face, sessionId, t, onChanged }: ModelSettingsProps): ReactNode {
  const [snapshot, setSnapshot] = useState<ModelSettingsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const reload = async (): Promise<void> => {
    try {
      const next = await face.load()
      setSnapshot(next)
      setLoadError(next.status === 'error' ? next.error : null)
    } catch (error: unknown) {
      setLoadError(String(error))
    }
  }

  useEffect(() => { void reload() }, [face])

  // 云端路由由登录令牌托管，地址与凭据都不交给用户改。
  const rows = (snapshot?.rows ?? []).filter(row => !row.provider.startsWith('lcoder-cloud'))
  const filtered = query.trim().length === 0
    ? rows
    : rows.filter(row => row.group === 'official'
      || row.provider.includes(query.trim().toLowerCase())
      || row.displayName.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = [
    { id: 'official', title: t('shell.modelOfficial'), rows: filtered.filter(row => row.group === 'official') },
    { id: 'other', title: t('shell.modelOthers'), rows: filtered.filter(row => row.group === 'other') },
    { id: 'custom', title: t('shell.modelCustom'), rows: filtered.filter(row => row.group === 'custom') },
  ].filter(group => group.rows.length > 0)
  const searchable = rows.filter(row => row.group !== 'official').length > 8
  const changed = (): void => {
    void reload()
    onChanged?.()
  }

  return (
    <section className={css.modelSection} aria-label={t('shell.modelServices')}>
      <div className={css.modelSectionHead}>
        <div className={css.grow}>
          <h4>{t('shell.modelServices')}</h4>
          <p>{t('shell.modelServicesHint')}</p>
        </div>
      </div>
      {loadError !== null ? <p className={css.modelError}>{fill(t('shell.modelLoadError'), { detail: loadError })}</p> : null}
      {snapshot === null && loadError === null ? <p className={css.modelHint}>{t('shell.loading')}</p> : null}
      {snapshot !== null && snapshot.status === 'ready' ? (
        <>
          {snapshot.credentialError !== null ? (
            <p className={css.modelNotice}>{fill(t('shell.modelCredentialError'), { detail: snapshot.credentialError })}</p>
          ) : null}
          {!snapshot.writable ? <p className={css.modelNotice}>{t('shell.modelReadOnly')}</p> : null}
          <DefaultModelSection
            rows={snapshot.rows}
            defaultSelection={snapshot.defaultSelection}
            face={face}
            sessionId={sessionId}
            t={t}
            onChanged={changed}
          />
          {searchable ? (
            <input
              className={css.modelInput}
              type="search"
              value={query}
              placeholder={t('shell.modelSearch')}
              aria-label={t('shell.modelSearch')}
              onChange={(event) => { setQuery(event.target.value) }}
            />
          ) : null}
          {groups.length === 0 ? <p className={css.modelHint}>{t('shell.modelNoProviders')}</p> : null}
          {groups.map(group => (
            <div key={group.id} className={css.modelGroup}>
              <div className={css.modelGroupTitle}>{group.title}</div>
              {group.rows.map(row => (
                <ProviderRowView
                  key={`${row.provider}:${row.revision}`}
                  row={row}
                  face={face}
                  sessionId={sessionId}
                  protocols={snapshot.protocols}
                  writable={snapshot.writable}
                  t={t}
                  onChanged={changed}
                />
              ))}
            </div>
          ))}
          {snapshot.piAiNs !== undefined && snapshot.protocols.length > 0
            ? <AddProviderForm face={face} snapshot={snapshot} t={t} onChanged={changed} />
            : null}
        </>
      ) : null}
    </section>
  )
}

/** 单行 props。 */
interface RowProps {
  row: ModelProviderRow
  face: ModelSettingsFace
  sessionId: SessionId | undefined
  protocols: readonly string[]
  writable: boolean
  t: ModelSettingsProps['t']
  onChanged: () => void
}

/** 一行 provider：摘要按钮 +（展开时）编辑卡。 */
function ProviderRowView({ row, face, sessionId, protocols, writable, t, onChanged }: RowProps): ReactNode {
  const [open, setOpen] = useState(false)
  const status = rowStatus(row)
  return (
    <div className={css.modelRow}>
      <button
        type="button"
        className={css.modelRowMain}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.modelRowName}>
          <span className={css.modelName}>{row.displayName}</span>
          <span className={css.modelId}>{row.provider}</span>
        </span>
        <span className={css.modelRowMeta}>
          {row.defaultModel !== undefined && row.models.length > 0
            ? <span className={`${css.pill} ${css.pillBrand}`}>{fill(t('shell.modelIsDefault'), { model: row.defaultModel })}</span>
            : null}
          {row.models.length > 0
            ? <span className={css.pill}>{fill(t('shell.modelModelCount'), { count: row.models.length })}</span>
            : null}
          <span className={`${css.pill} ${status.className ?? ''}`}>{t(status.key)}</span>
          <span className={css.modelChevron}>{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open
        ? (row.account
          ? <p className={css.modelHint}>{t('shell.modelAccountNote')}</p>
          : <ProviderEditor
            row={row}
            face={face}
            sessionId={sessionId}
            protocols={protocols}
            writable={writable}
            t={t}
            onChanged={onChanged}
          />)
        : null}
    </div>
  )
}

/** 行内编辑卡 props。 */
interface EditorProps {
  row: ModelProviderRow
  face: ModelSettingsFace
  sessionId: SessionId | undefined
  protocols: readonly string[]
  writable: boolean
  t: ModelSettingsProps['t']
  onChanged: () => void
}

/** 行内编辑卡：key、base URL、手加路线的协议与模型 id、默认模型、发现模型。 */
function ProviderEditor({ row, face, sessionId, protocols, writable, t, onChanged }: EditorProps): ReactNode {
  const [keyDraft, setKeyDraft] = useState('')
  const [baseDraft, setBaseDraft] = useState(row.baseURL ?? '')
  const [apiDraft, setApiDraft] = useState(row.api ?? protocols[0] ?? '')
  const [modelText, setModelText] = useState(row.modelIds.join('\n'))
  const [busy, setBusy] = useState<Busy>(undefined)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [discovered, setDiscovered] = useState<readonly { id: string; name?: string }[] | null>(null)
  const disabled = !writable || busy !== undefined
  const editable = row.settingsNs !== ''

  const fail = (code: string): void => { setFailure(failureText(code, t)) }

  const submitKey = async (): Promise<void> => {
    if (keyDraft.trim().length === 0) return
    setBusy('key'); setFailure(null)
    const outcome = await face.saveKey(row, keyDraft)
    setBusy(undefined)
    if (outcome !== undefined) { fail(outcome); return }
    setKeyDraft('')
    onChanged()
  }

  const removeKey = async (): Promise<void> => {
    setBusy('delete'); setFailure(null)
    const outcome = await face.removeKey(row)
    setBusy(undefined)
    setConfirmKey(false)
    if (outcome !== undefined) { fail(outcome); return }
    onChanged()
  }

  const submitProfile = async (): Promise<void> => {
    const base = baseDraft.trim()
    if (base.length > 0 && !validBaseURL(base)) { fail('bad-base-url'); return }
    const patch: ProfilePatch = { baseURL: base.length === 0 ? null : base }
    if (row.declared) {
      const modelIds = parseModelIds(modelText)
      if (modelIds.length === 0) { fail('no-models'); return }
      patch.api = apiDraft
      patch.modelIds = modelIds
    }
    setBusy('profile'); setFailure(null)
    const outcome = await face.saveProfile(row, patch)
    setBusy(undefined)
    if (outcome !== undefined) { fail(outcome); return }
    onChanged()
  }

  const removeProvider = async (): Promise<void> => {
    setBusy('delete'); setFailure(null)
    const outcome = await face.removeProvider(row)
    setBusy(undefined)
    setConfirmDelete(false)
    if (outcome !== undefined) { fail(outcome); return }
    onChanged()
  }

  const discover = async (): Promise<void> => {
    setBusy('discover'); setFailure(null); setDiscovered(null)
    const answer = await face.discover({
      settingsNs: row.settingsNs,
      provider: row.provider,
      ...baseDraft.trim().length === 0 ? {} : { baseURL: baseDraft.trim() },
      ...row.declared ? { api: apiDraft } : {},
      ...keyDraft.trim().length === 0 ? {} : { apiKey: keyDraft.trim() },
    })
    setBusy(undefined)
    if (answer.kind === 'refused') { setFailure(answer.message); return }
    setDiscovered(answer.models)
  }

  const setDefault = async (model: string): Promise<void> => {
    if (sessionId === undefined) return
    setBusy('default'); setFailure(null)
    const outcome = await face.setDefault(sessionId, row.provider, model)
    setBusy(undefined)
    if (outcome !== undefined) { fail(outcome); return }
    onChanged()
  }

  const status = rowStatus(row)
  return (
    <div className={css.modelEditor}>
      <div className={css.modelEditorHead}>
        <span className={css.modelName}>{row.displayName}</span>
        <span className={css.modelId}>{row.provider}</span>
        <span className={`${css.pill} ${status.className ?? ''}`}>{t(status.key)}</span>
        {row.error !== undefined ? <span className={css.modelErrorInline}>{row.error}</span> : null}
      </div>

      {row.keyRef !== undefined ? (
        <div className={css.modelField}>
          <label className={css.modelLabel} htmlFor={`${row.provider}-key`}>{t('shell.modelKey')}</label>
          <div className={css.modelInline}>
            <input
              id={`${row.provider}-key`}
              className={css.modelInput}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyDraft}
              placeholder={row.apiKeyConfigured ? t('shell.modelKeyPlaceholder') : t('shell.modelKeyPlaceholderNew')}
              aria-label={t('shell.modelKey')}
              disabled={disabled || !row.apiKeyWritable}
              onChange={(event) => { setKeyDraft(event.target.value) }}
            />
            <button
              type="button"
              className={css.secondaryBtn}
              disabled={disabled || keyDraft.trim().length === 0 || !row.apiKeyWritable}
              onClick={() => { void submitKey() }}
            >
              {busy === 'key' ? t('shell.modelSaving') : t('shell.modelSaveKey')}
            </button>
            {row.apiKeyConfigured && row.apiKeyWritable
              ? (confirmKey
                ? (
                  <>
                    <button type="button" className={css.secondaryBtn} onClick={() => { setConfirmKey(false) }}>{t('shell.modelCancel')}</button>
                    <button type="button" className={css.dangerBtn} disabled={disabled} onClick={() => { void removeKey() }}>
                      {busy === 'delete' ? t('shell.modelSaving') : t('shell.modelConfirmRemoveKey')}
                    </button>
                  </>
                )
                : (
                  <button type="button" className={css.secondaryBtn} disabled={disabled} onClick={() => { setConfirmKey(true) }}>
                    {t('shell.modelRemoveKey')}
                  </button>
                ))
              : null}
          </div>
          {row.apiKeyConfigured ? <p className={css.modelHint}>{t('shell.modelKeyConfigured')}</p> : null}
        </div>
      ) : null}

      {editable ? (
        <details className={css.modelDetails}>
          <summary className={css.modelSummary}>{t('shell.modelAdvanced')}</summary>
          <div className={css.modelDetailsBody}>
            <div className={css.modelField}>
              <label className={css.modelLabel} htmlFor={`${row.provider}-base`}>{t('shell.modelBaseURL')}</label>
              <input
                id={`${row.provider}-base`}
                className={css.modelInput}
                type="text"
                spellCheck={false}
                value={baseDraft}
                placeholder={row.defaultBaseURL ?? t('shell.modelBaseURLPlaceholder')}
                aria-label={t('shell.modelBaseURL')}
                disabled={disabled}
                onChange={(event) => { setBaseDraft(event.target.value) }}
              />
              <p className={css.modelHint}>
                {t('shell.modelBaseURLHint')}
                {row.baseURLEnv.length > 0 ? ` ${row.baseURLEnv.join(', ')}` : ''}
              </p>
            </div>
            {row.declared ? (
              <>
                <div className={css.modelField}>
                  <label className={css.modelLabel} htmlFor={`${row.provider}-api`}>{t('shell.modelProtocol')}</label>
                  <select
                    id={`${row.provider}-api`}
                    className={css.modelInput}
                    value={apiDraft}
                    aria-label={t('shell.modelProtocol')}
                    disabled={disabled}
                    onChange={(event) => { setApiDraft(event.target.value) }}
                  >
                    {protocols.map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}
                  </select>
                </div>
                <div className={css.modelField}>
                  <label className={css.modelLabel} htmlFor={`${row.provider}-models`}>{t('shell.modelModelIds')}</label>
                  <textarea
                    id={`${row.provider}-models`}
                    className={css.modelTextarea}
                    value={modelText}
                    placeholder={t('shell.modelModelIdsHint')}
                    aria-label={t('shell.modelModelIds')}
                    disabled={disabled}
                    onChange={(event) => { setModelText(event.target.value) }}
                  />
                </div>
              </>
            ) : null}
            <div className={css.modelInline}>
              <button type="button" className={css.secondaryBtn} disabled={disabled} onClick={() => { void submitProfile() }}>
                {busy === 'profile' ? t('shell.modelSaving') : t('shell.modelSave')}
              </button>
              {row.settingsPath.length > 0 ? (
                <>
                  <button type="button" className={css.secondaryBtn} disabled={disabled} onClick={() => { void discover() }}>
                    {busy === 'discover' ? t('shell.modelDiscovering') : t('shell.modelDiscover')}
                  </button>
                  <span className={css.modelHint}>{t('shell.modelDiscoverHint')}</span>
                </>
              ) : null}
            </div>
            {discovered !== null ? (
              <div className={css.modelDiscovered}>
                <p className={css.modelHint}>
                  {discovered.length === 0
                    ? t('shell.modelDiscoverEmpty')
                    : fill(t('shell.modelDiscovered'), { count: discovered.length })}
                </p>
                {discovered.length > 0
                  ? (
                    <ul className={css.modelModelList}>
                      {discovered.map(model => (
                        <li key={model.id} className={css.modelModelRow}>
                          <span className={css.modelName}>{model.name ?? model.id}</span>
                          <span className={css.modelId}>{model.id}</span>
                        </li>
                      ))}
                    </ul>
                  )
                  : null}
              </div>
            ) : null}
            {row.declared && row.removable ? (
              <div className={css.modelInline}>
                {confirmDelete
                  ? (
                    <>
                      <button type="button" className={css.secondaryBtn} onClick={() => { setConfirmDelete(false) }}>{t('shell.modelCancel')}</button>
                      <button type="button" className={css.dangerBtn} disabled={disabled} onClick={() => { void removeProvider() }}>
                        {busy === 'delete' ? t('shell.modelDeleting') : t('shell.modelDeleteProvider')}
                      </button>
                    </>
                  )
                  : (
                    <button type="button" className={css.dangerBtn} disabled={disabled} onClick={() => { setConfirmDelete(true) }}>
                      {t('shell.modelDeleteProvider')}
                    </button>
                  )}
                <span className={css.modelHint}>{fill(t('shell.modelDeleteConfirm'), { provider: row.displayName })}</span>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {row.models.length > 0 ? (
        <div className={css.modelField}>
          <div className={css.modelLabel}>{t('shell.modelDefaultModel')}</div>
          <p className={css.modelHint}>{t('shell.modelSetDefaultHint')}</p>
          {sessionId === undefined ? <p className={css.modelNotice}>{t('shell.modelSetDefaultNoSession')}</p> : null}
          <ul className={css.modelModelList}>
            {row.models.map(model => (
              <li key={model.id} className={css.modelModelRow}>
                <span className={css.modelName}>{model.name}</span>
                <span className={css.modelId}>{model.id}</span>
                {row.defaultModel === model.id
                  ? <span className={`${css.pill} ${css.pillBrand}`}>{t('shell.modelDefaultBadge')}</span>
                  : (
                    <button
                      type="button"
                      className={css.secondaryBtn}
                      disabled={disabled || sessionId === undefined}
                      onClick={() => { void setDefault(model.id) }}
                    >
                      {busy === 'default' ? t('shell.modelSaving') : t('shell.modelSetDefault')}
                    </button>
                  )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {failure !== null ? <p className={css.modelError}>{failure}</p> : null}
    </div>
  )
}

/** 添加表单 props。 */
interface AddProps {
  face: ModelSettingsFace
  snapshot: ModelSettingsSnapshot
  t: ModelSettingsProps['t']
  onChanged: () => void
}

/** 手加 provider 的折叠表单。 */
function AddProviderForm({ face, snapshot, t, onChanged }: AddProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState(snapshot.protocols[0] ?? '')
  const [modelText, setModelText] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const taken = useMemo(() => new Set(snapshot.rows.map(row => row.provider)), [snapshot.rows])
  const reset = (): void => {
    setName(''); setModelText(''); setBaseURL(''); setKeyDraft(''); setFailure(null)
  }

  const submit = async (): Promise<void> => {
    const route = name.trim()
    if (!validRouteName(route)) { setFailure(t('shell.modelNameInvalid')); return }
    if (taken.has(route)) { setFailure(t('shell.modelNameTaken')); return }
    const modelIds = parseModelIds(modelText)
    if (modelIds.length === 0) { setFailure(t('shell.modelNeedModels')); return }
    const url = baseURL.trim()
    if (url.length === 0) { setFailure(t('shell.modelNeedBaseURL')); return }
    if (!validBaseURL(url)) { setFailure(t('shell.modelBadBaseURL')); return }
    setBusy(true); setFailure(null)
    const outcome = await face.createProvider({ name: route, protocol, modelIds, baseURL: url, apiKey: keyDraft })
    setBusy(false)
    if (outcome !== undefined) { setFailure(failureText(outcome, t)); return }
    reset()
    setOpen(false)
    onChanged()
  }

  if (!open) {
    return (
      <button type="button" className={css.secondaryBtn} onClick={() => { setOpen(true) }}>
        {t('shell.modelAddProvider')}
      </button>
    )
  }
  return (
    <div className={css.modelAddForm}>
      <div className={css.modelGroupTitle}>{t('shell.modelAddProvider')}</div>
      <div className={css.modelField}>
        <label className={css.modelLabel} htmlFor="lcoder-model-add-name">{t('shell.modelProviderName')}</label>
        <input
          id="lcoder-model-add-name"
          className={css.modelInput}
          type="text"
          spellCheck={false}
          value={name}
          placeholder="acme-gateway"
          aria-label={t('shell.modelProviderName')}
          disabled={busy}
          onChange={(event) => { setName(event.target.value) }}
        />
        <p className={css.modelHint}>{t('shell.modelProviderNameHint')}</p>
      </div>
      <div className={css.modelField}>
        <label className={css.modelLabel} htmlFor="lcoder-model-add-protocol">{t('shell.modelProtocol')}</label>
        <select
          id="lcoder-model-add-protocol"
          className={css.modelInput}
          value={protocol}
          aria-label={t('shell.modelProtocol')}
          disabled={busy}
          onChange={(event) => { setProtocol(event.target.value) }}
        >
          {snapshot.protocols.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className={css.modelField}>
        <label className={css.modelLabel} htmlFor="lcoder-model-add-models">{t('shell.modelModelIds')}</label>
        <textarea
          id="lcoder-model-add-models"
          className={css.modelTextarea}
          value={modelText}
          placeholder={t('shell.modelModelIdsHint')}
          aria-label={t('shell.modelModelIds')}
          disabled={busy}
          onChange={(event) => { setModelText(event.target.value) }}
        />
      </div>
      <div className={css.modelField}>
        <label className={css.modelLabel} htmlFor="lcoder-model-add-base">{t('shell.modelBaseURL')}</label>
        <input
          id="lcoder-model-add-base"
          className={css.modelInput}
          type="text"
          spellCheck={false}
          value={baseURL}
          placeholder={t('shell.baseUrlPlaceholder')}
          aria-label={t('shell.modelBaseURL')}
          disabled={busy}
          onChange={(event) => { setBaseURL(event.target.value) }}
        />
      </div>
      <div className={css.modelField}>
        <label className={css.modelLabel} htmlFor="lcoder-model-add-key">{t('shell.modelKey')}</label>
        <input
          id="lcoder-model-add-key"
          className={css.modelInput}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={keyDraft}
          placeholder={t('shell.modelKeyPlaceholderNew')}
          aria-label={t('shell.modelKey')}
          disabled={busy}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
      </div>
      {failure !== null ? <p className={css.modelError}>{failure}</p> : null}
      <div className={css.modelInline}>
        <button type="button" className={css.primaryBtn} disabled={busy} onClick={() => { void submit() }}>
          {busy ? t('shell.modelCreating') : t('shell.modelCreate')}
        </button>
        <button
          type="button"
          className={css.secondaryBtn}
          disabled={busy}
          onClick={() => { reset(); setOpen(false) }}
        >
          {t('shell.modelCancel')}
        </button>
      </div>
    </div>
  )
}
