/** 设置页的模型服务面板：只读展示 provider 目录、默认模型与密钥状态。 */

import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Translate } from '../locale.ts'
import { loadModelSettings, rowStatus, type ModelSnapshot, type ProviderRow } from '../settings/model-settings.ts'

/** 面板属性。 */
export interface ModelPanelProps {
  readonly t: Translate
}

function defaultLabelOf(snapshot: ModelSnapshot): string | undefined {
  const selection = snapshot.defaultSelection
  if (selection === undefined) return undefined
  const row = snapshot.rows.find(item => item.provider === selection.provider)
  const model = row?.models.find(item => item.id === selection.model)
  return row === undefined ? `${selection.provider} · ${selection.model}` : `${row.displayName} · ${model?.name ?? selection.model}`
}

/**
 * 模型服务面板：首版只读，写入能力仍在宿主与 `model-settings.ts` 里。
 * @param props - 词典。
 * @returns 默认模型摘要与分组行表。
 */
export function ModelPanel({ t }: ModelPanelProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<ModelSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  const groups = snapshot === null
    ? []
    : [
      { id: 'official', title: t('settings.official'), rows: snapshot.rows.filter(row => row.group === 'official') },
      { id: 'other', title: t('settings.others'), rows: snapshot.rows.filter(row => row.group === 'other') },
      { id: 'custom', title: t('settings.custom'), rows: snapshot.rows.filter(row => row.group === 'custom') },
    ].filter(group => group.rows.length > 0)

  const currentLabel = snapshot === null ? undefined : defaultLabelOf(snapshot)

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
          <p className="settings-muted" data-testid="settings-models-readonly">{t('settings.readOnly')}</p>

          <div className="model-default" data-testid="settings-default-model">
            <div>
              <h4>{t('settings.defaultModel')}</h4>
              <p className="settings-muted">
                {currentLabel === undefined ? t('settings.defaultUnset') : t('settings.defaultCurrent', { model: currentLabel })}
              </p>
            </div>
          </div>

          {groups.length === 0 ? <p className="settings-muted" data-testid="settings-no-providers">{t('settings.noProviders')}</p> : null}
          {groups.map(group => (
            <div key={group.id} className="model-group">
              <div className="model-group-title">{group.title}</div>
              {group.rows.map(row => (
                <ProviderRowView key={`${row.provider}:${row.revision}`} row={row} t={t} />
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
  readonly t: Translate
}

/** 一行 provider：摘要按钮与展开后的账号说明与模型列表。 */
function ProviderRowView({ row, t }: RowProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const status = rowStatus(row)

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

          {row.models.length === 0 ? <p className="settings-muted">{t('settings.modelsEmpty')}</p> : (
            <ul className="model-model-list">
              {row.models.map(model => (
                <li key={model.id} className="model-model-row">
                  <span className="model-name">{model.name}</span>
                  <span className="model-id">{model.id}</span>
                  {row.defaultModel === model.id ? (
                    <span className="model-tag model-tag-ok">{t('settings.isDefault', { model: model.name })}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
