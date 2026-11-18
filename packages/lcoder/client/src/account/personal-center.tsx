/** 个人中心：账号资料、余额、token 预估与最近用量。 */

import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Translate } from '../locale.ts'
import { cloudErrorKey, cloudFace, type CloudErrorInfo, type CloudState, type CloudUsageItem } from './cloud.ts'
import { estimateRange, estimateReasonKey, stamp, statusKey, usageStatusKey, usd, usdPrecise } from './format.ts'

/** 个人中心属性。 */
export interface PersonalCenterProps {
  readonly state: CloudState | null
  readonly t: Translate
  readonly onBack: () => void
}

/** 每页流水条数；与云端默认一致。 */
const USAGE_PAGE_SIZE = 20

/** 一行「标签 - 值」。 */
function Row({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="pc-row">
      <span className="pc-label">{label}</span>
      <span className="pc-value">{value}</span>
    </div>
  )
}

/**
 * 个人中心整页。
 * @param props - 云端状态、词典与返回回调。
 * @returns 账号、余额、预估与用量。
 */
export function PersonalCenter({ state, t, onBack }: PersonalCenterProps): JSX.Element {
  const signedIn = state?.signedIn === true
  const user = state?.user ?? null
  const quota = state?.quota ?? null
  const estimate = state?.estimate ?? null
  const available = estimate !== null && estimate.available

  const [items, setItems] = useState<readonly CloudUsageItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<CloudErrorInfo | null>(null)
  /** 同一时刻只发一页；连点不会重复请求同一个游标。 */
  const flight = useRef(false)

  const loadPage = async (next: string | undefined): Promise<void> => {
    if (flight.current) return
    flight.current = true
    setLoading(true)
    setError(null)
    try {
      const answer = await cloudFace.usage({ limit: USAGE_PAGE_SIZE, ...next === undefined ? {} : { cursor: next } })
      if (answer.ok) {
        setItems(previous => next === undefined ? answer.value.items : [...previous, ...answer.value.items])
        setCursor(answer.value.nextCursor)
        setLoaded(true)
      } else {
        setError(answer.error)
      }
    } finally {
      flight.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    setItems([])
    setCursor(null)
    setLoaded(false)
    setError(null)
    if (signedIn) void loadPage(undefined)
    // 登录状态切换才重置流水；翻页由按钮触发。
  }, [signedIn])

  return (
    <section className="page" data-testid="page-account">
      <header className="page-head">
        <div>
          <h2>{t('account.pageTitle')}</h2>
          <p className="page-sub">{user?.displayName ?? user?.phoneMasked ?? t('account.signedIn')}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="pill" data-testid="account-back" onClick={onBack}>← {t('account.back')}</button>
        </div>
      </header>

      <div className="pc-grid">
        <section className="pc-card">
          <h4>{t('account.profile')}</h4>
          {signedIn && user !== null ? (
            <>
              <Row label={t('account.displayName')} value={user.displayName ?? '—'} />
              <Row label={t('account.phone')} value={user.phoneMasked ?? '—'} />
              <Row label={t('account.status')} value={t(statusKey(user.status))} />
              <Row label={t('account.createdAt')} value={stamp(user.createdAt)} />
              <Row label={t('account.lastLogin')} value={stamp(user.lastLoginAt)} />
            </>
          ) : <p className="pc-muted">{t('account.profileUnavailable')}</p>}
        </section>

        <section className="pc-card">
          <h4>{t('account.balance')}</h4>
          {signedIn && quota !== null ? (
            <>
              <Row label={t('account.granted')} value={usd(quota.grantedMicroUsd)} />
              <Row label={t('account.spent')} value={usd(quota.spentMicroUsd)} />
              <Row label={t('account.available')} value={usd(quota.availableMicroUsd)} />
              <Row label={t('account.reserved')} value={usd(quota.reservedMicroUsd)} />
            </>
          ) : <p className="pc-muted">{t('account.balanceUnavailable')}</p>}
        </section>

        <section className="pc-card">
          <h4>{t('account.estimate')}</h4>
          <p className={available ? 'pc-estimate' : 'pc-estimate pc-muted'}>{estimateRange(estimate, t)}</p>
          {estimate !== null && estimate.available ? (
            <>
              <p className="pc-muted">{t('account.estimateAssumption', { ratio: estimate.inputOutputRatio })}</p>
              <p className="pc-muted">{t('account.estimateModel', { model: estimate.model, amount: usd(estimate.availableMicroUsd) })}</p>
              {estimate.price === null ? null : (
                <p className="pc-muted">
                  {t('account.estimatePrice', {
                    input: estimate.price.inputMicroUsdPerMtok,
                    cached: estimate.price.cachedInputMicroUsdPerMtok,
                    output: estimate.price.outputMicroUsdPerMtok,
                  })}
                </p>
              )}
            </>
          ) : <p className="pc-muted">{t(estimateReasonKey(estimate?.unavailableReason ?? null))}</p>}
        </section>
      </div>

      <section className="pc-card" data-testid="account-usage">
        <h4>{t('account.usage')}</h4>
        {!signedIn ? <p className="pc-muted">{t('account.signedIn')}</p> : (
          <>
            {error === null ? null : (
              <p className="notice" role="alert">{t(cloudErrorKey(error.code), { code: error.code })}</p>
            )}
            {items.length === 0 && loaded && error === null ? <p className="pc-muted" data-testid="account-usage-empty">{t('account.usageEmpty')}</p> : (
              <ul className="pc-usage">
                {items.map(item => (
                  <li key={item.requestId} className="pc-usage-item" data-testid="account-usage-row">
                    <span className="pc-usage-time">{stamp(item.createdAt)}</span>
                    <span className="pc-usage-model">{item.model}</span>
                    <span className="pc-usage-tokens">
                      {t('account.usageTokens', { prompt: item.promptTokens, cached: item.cachedTokens, completion: item.completionTokens })}
                    </span>
                    <span className="pc-usage-cost">{usdPrecise(item.costMicroUsd)}</span>
                    <span className="pc-usage-status">
                      {t(item.source === 'guest' ? 'account.usageGuest' : 'account.usageUser')}
                      {' · '}
                      {t(usageStatusKey(item.status))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {cursor === null ? null : (
              <div className="pc-actions">
                <button type="button" className="pill" disabled={loading} onClick={() => { void loadPage(cursor) }}>
                  {loading ? t('account.usageLoading') : t('account.usageMore')}
                </button>
              </div>
            )}
            {loading && items.length === 0 && error === null ? <p className="pc-muted">{t('account.usageLoading')}</p> : null}
          </>
        )}
      </section>
    </section>
  )
}
