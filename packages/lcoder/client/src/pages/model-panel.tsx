/** 设置页的模型服务面板：默认模型、provider 行与密钥状态。 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { Translate } from '../locale.ts'
import {
  loadModelSettings, removeKey, rowStatus, saveKey, setDefaultModel, writeErrorKey,
  type ModelSnapshot, type ProviderRow,
} from '../settings/model-settings.ts'

/** 面板属性。 */
export interface ModelPanelProps {
  readonly t: Translate
  /** 当前会话；没有时「设为默认」会先建一个空白会话。 */
  readonly sessionId: string | null
  /** 一次写入成功后通知外壳重查模型可用性。 */
  readonly onChanged?: () => void
}

/** 行内提交状态。 */
type Busy = 'key' | 'delete' | 'default' | undefined

function optionKey(provider: string, model: string): string {
  return `${encodeURIComponent(provider)}|${encodeURIComponent(model)}`
}

/**
 * 模型服务面板。
 * @param props - 词典、会话与变更回调。
 * @returns 默认模型区与分组行表。
 */
export function ModelPanel({ t, sessionId, onChanged }: ModelPanelProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<ModelSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pick, setPick] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const next = await loadModelSettings()
    setSnapshot(next)
    setLoadError(next.status === 'error' ? next.error : null)
  }, [])

  useEffect(() => { void reload() }, [reload])

  // 宿主写入设置、凭据或模型目录后即时重读，不必手动刷新页面。
  useEffect(() => window.lcoder.onEvent((event) => {
    if (event.name === 'credentials/reference-updated' || event.name === 'llm/models-updated'
      || event.name === 'llm/adapters-updated' || event.name === 'settings/document-updated') {
      void reload()
    }
  }), [reload])

  const options = useMemo(() => (snapshot?.rows ?? []).flatMap(row =>
    row.models.map(model => ({ provider: row.provider, model: model.id, label: `${row.displayName} · ${model.name}`, key: optionKey(row.provider, model.id) }))),
  [snapshot])

  const current = snapshot?.defaultSelection
  const currentLabel = current === undefined
    ? undefined
    : options.find(option => option.provider === current.provider && option.model === current.model)?.label
      ?? `${current.provider} · ${current.model}`
  const selectedKey = pick !== '' && options.some(option => option.key === pick) ? pick : options[0]?.key ?? ''

  const applyDefault = async (): Promise<void> => {
    const option = options.find(item => item.key === selectedKey)
    if (option === undefined || busy) return
    setBusy(true)
    setFailure(null)
    const error = await setDefaultModel(sessionId, option.provider, option.model)
    setBusy(false)
    if (error !== undefined) {
      const key = writeErrorKey(error)
      setFailure(key === undefined ? error : t(key))
      return
    }
    setPick('')
    await reload()
    onChanged?.()
  }

  const groups = [
    { id: 'official', title: t('settings.official'), rows: (snapshot?.rows ?? []).filter(row => row.group === 'official') },
    { id: 'other', title: t('settings.others'), rows: (snapshot?.rows ?? []).filter(row => row.group === 'other') },
    { id: 'custom', title: t('settings.custom'), rows: (snapshot?.rows ?? []).filter(row => row.group === 'custom') },
  ].filter(group => group.rows.length > 0)

  return (
    <section className="model-section lg-glass-card" aria-label={t('settings.models')} data-testid="settings-models">
      <header className="settings-section-head">
        <div>
          <h3>{t('settings.models')}</h3>
          <p>{t('settings.modelsHint')}</p>
        </div>
      </header>

      {loadError !== null ? <p className="notice" data-testid="settings-models-error">{t('settings.loadError', { detail: loadError })}</p> : null}
      {snapshot === null && loadError === null ? <p className="settings-muted">{t('settings.loading')}</p> : null}

      {snapshot !== null && snapshot.status === 'ready' ? (
        <>
          {snapshot.credentialError !== null ? (
            <p className="settings-muted">{t('settings.credentialsError', { detail: snapshot.credentialError })}</p>
          ) : null}
          {!snapshot.writable ? <p className="settings-muted">{t('settings.readOnly')}</p> : null}

          <div className="model-default" data-testid="settings-default-model">
            <div>
              <h4>{t('settings.defaultModel')}</h4>
              <p className="settings-muted">
                {currentLabel === undefined ? t('settings.defaultUnset') : t('settings.defaultCurrent', { model: currentLabel })}
              </p>
            </div>
            {options.length === 0 ? <p className="settings-muted">{t('settings.defaultNoModels')}</p> : (
              <div className="model-default-row">
                <select
                  className="settings-select"
                  value={selectedKey}
                  aria-label={t('settings.defaultModel')}
                  disabled={busy}
                  onChange={(event) => { setPick(event.target.value); setFailure(null) }}
                >
                  {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <button
                  type="button"
                  className="pill pill-accent"
                  data-testid="settings-set-default"
                  disabled={busy}
                  onClick={() => { void applyDefault() }}
                >
                  {busy ? t('settings.saving') : t('settings.setDefault')}
                </button>
              </div>
            )}
            {sessionId === null ? <p className="settings-muted">{t('settings.setDefaultNoSession')}</p> : null}
            {failure !== null ? <p className="notice" data-testid="settings-default-error">{failure}</p> : null}
          </div>

          {groups.length === 0 ? <p className="settings-muted" data-testid="settings-no-providers">{t('settings.noProviders')}</p> : null}
          {groups.map(group => (
            <div key={group.id} className="model-group">
              <div className="model-group-title">{group.title}</div>
              {group.rows.map(row => (
                <ProviderRowView key={`${row.provider}:${row.revision}`} row={row} writable={snapshot.writable} t={t} onReload={reload} onChanged={onChanged} />
              ))}
            </div>
          ))}
        </>
      ) : null}
    </section>
  )
}

/** 单行属性。 */
interface RowProps {
  readonly row: ProviderRow
  readonly writable: boolean
  readonly t: Translate
  readonly onReload: () => Promise<void>
  readonly onChanged?: (() => void) | undefined
}

/** 一行 provider：摘要按钮与展开后的密钥区。 */
function ProviderRowView({ row, writable, t, onReload, onChanged }: RowProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState<Busy>(undefined)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const status = rowStatus(row)

  const submitKey = async (): Promise<void> => {
    if (keyDraft.trim() === '' || busy !== undefined) return
    setBusy('key')
    setFailure(null)
    const error = await saveKey(row, keyDraft)
    setBusy(undefined)
    if (error !== undefined) {
      const key = writeErrorKey(error)
      setFailure(key === undefined ? error : t(key))
      return
    }
    setKeyDraft('')
    await onReload()
    onChanged?.()
  }

  const dropKey = async (): Promise<void> => {
    if (busy !== undefined) return
    setBusy('delete')
    setFailure(null)
    const error = await removeKey(row)
    setBusy(undefined)
    setConfirmRemove(false)
    if (error !== undefined) { setFailure(error); return }
    await onReload()
    onChanged?.()
  }

  const applyModel = async (model: string): Promise<void> => {
    if (busy !== undefined) return
    setBusy('default')
    setFailure(null)
    const error = await setDefaultModel(null, row.provider, model)
    setBusy(undefined)
    if (error !== undefined) { setFailure(error); return }
    await onReload()
    onChanged?.()
  }

  return (
    <div className="model-row" data-testid="settings-provider-row" data-provider={row.provider}>
      <button type="button" className="model-row-main" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className="model-row-name">
          <span className="model-name">{row.displayName}</span>
          <span className="model-id">{row.provider}</span>
        </span>
        <span className="model-row-meta">
          {row.defaultModel === undefined ? null : (
            <span className="model-tag model-tag-ok">{t('settings.isDefault', { model: row.defaultModel })}</span>
          )}
          {row.models.length === 0 ? null : <span className="model-tag">{t('settings.modelCount', { count: row.models.length })}</span>}
          <span className={status.className}>{t(status.key)}</span>
          <span className="model-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className="model-editor">
          {row.account ? <p className="settings-muted">{t('settings.accountNote')}</p> : null}
          {!row.account && row.keyRef !== undefined ? (
            <div className="model-field">
              <label className="model-label" htmlFor={`${row.provider}-key`}>{t('settings.key')}</label>
              <div className="model-key-row">
                <input
                  id={`${row.provider}-key`}
                  data-testid="settings-key-input"
                  className="settings-input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyDraft}
                  placeholder={t('settings.keyPlaceholder')}
                  aria-label={t('settings.key')}
                  disabled={busy !== undefined || !row.keyWritable || !writable}
                  onChange={(event) => { setKeyDraft(event.target.value) }}
                />
                <button
                  type="button"
                  className="pill"
                  data-testid="settings-key-save"
                  disabled={busy !== undefined || keyDraft.trim() === '' || !row.keyWritable || !writable}
                  onClick={() => { void submitKey() }}
                >
                  {busy === 'key' ? t('settings.saving') : t('settings.saveKey')}
                </button>
                {row.keyConfigured && row.keyWritable ? (
                  confirmRemove ? (
                    <>
                      <button type="button" className="pill" onClick={() => { setConfirmRemove(false) }}>{t('settings.cancel')}</button>
                      <button type="button" className="pill danger" data-testid="settings-key-remove-confirm" disabled={busy !== undefined || !writable} onClick={() => { void dropKey() }}>
                        {busy === 'delete' ? t('settings.saving') : t('settings.confirmRemoveKey')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="pill" data-testid="settings-key-remove" disabled={busy !== undefined || !writable} onClick={() => { setConfirmRemove(true) }}>
                      {t('settings.removeKey')}
                    </button>
                  )
                ) : null}
              </div>
              {row.keyConfigured ? <p className="model-hint" data-testid="settings-key-configured">{t('settings.keyConfigured')}</p> : null}
            </div>
          ) : null}

          {row.models.length === 0 ? <p className="settings-muted">{t('settings.modelsEmpty')}</p> : (
            <ul className="model-model-list">
              {row.models.map(model => (
                <li key={model.id} className="model-model-row">
                  <span className="model-name">{model.name}</span>
                  <span className="model-id">{model.id}</span>
                  {row.defaultModel === model.id ? (
                    <span className="model-tag model-tag-ok">{t('settings.isDefault', { model: model.name })}</span>
                  ) : (
                    <button type="button" className="pill" disabled={busy !== undefined} onClick={() => { void applyModel(model.id) }}>
                      {busy === 'default' ? t('settings.saving') : t('settings.setDefault')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {failure !== null ? <p className="notice">{failure}</p> : null}
        </div>
      )}
    </div>
  )
}
