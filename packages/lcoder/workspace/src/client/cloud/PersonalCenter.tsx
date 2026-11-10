/**
 * 个人中心：账号资料、余额、token 预估与最近用量。
 *
 * 页面只做展示与分页取数；折算在云端完成，这里不出现任何单价换算。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  CloudErrorInfo, CloudState, CloudUsageItem,
} from '@lcoder/kernel/src/cloud/types.ts'
import type { LcoderWorkspaceKey } from '../locales.ts'
import { cloudErrorKey } from './errors.ts'
import { activeEstimate, estimateRange, estimateReasonKey, fill, usd, usdPrecise } from './estimate.ts'
import type { CloudTranslate } from './estimate.ts'
import type { CloudFace } from './face.ts'
import css from '../shell/Shell.module.css'

/** 个人中心 props。 */
export interface PersonalCenterProps {
  readonly face: CloudFace | undefined
  readonly state: CloudState | null
  readonly t: CloudTranslate
  readonly onBack: () => void
}

/** 每页流水条数；与云端默认一致。 */
const USAGE_PAGE_SIZE = 20

/** 账号状态的词典键。 */
function statusKey(status: string): LcoderWorkspaceKey {
  switch (status) {
    case 'active': return 'shell.cloudStatusActive'
    case 'banned': return 'shell.cloudStatusBanned'
    case 'deleted': return 'shell.cloudStatusDeleted'
    default: return 'shell.cloudStatusUnknown'
  }
}

/** 流水状态的词典键。 */
function usageStatusKey(status: CloudUsageItem['status']): LcoderWorkspaceKey {
  switch (status) {
    case 'reserved': return 'shell.cloudUsageReserved'
    case 'settled': return 'shell.cloudUsageSettled'
    case 'released': return 'shell.cloudUsageReleased'
    case 'failed': return 'shell.cloudUsageFailed'
  }
}

/** ISO 时间折成本地展示；解析失败时原样给出。 */
function stamp(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/** 一行「标签 - 值」。 */
function Row({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className={css.pcRow}>
      <span className={css.pcLabel}>{label}</span>
      <span className={css.pcValue}>{value}</span>
    </div>
  )
}

/** 预估区块；不可用时只给原因。 */
function EstimateCard({ state, t }: { readonly state: CloudState | null; readonly t: CloudTranslate }): ReactNode {
  const estimate = activeEstimate(state)
  const available = estimate !== null && estimate.available
  return (
    <section className={css.pcCard}>
      <h4 className={css.pcCardTitle}>{t('shell.cloudEstimateTitle')}</h4>
      <p className={`${css.pcEstimateRange} ${available ? '' : css.pcMuted}`}>{estimateRange(estimate, t)}</p>
      {available
        ? (
          <>
            <p className={css.pcMuted}>
              {fill(t('shell.cloudEstimateAssumption'), { ratio: estimate.inputOutputRatio })}
            </p>
            <p className={css.pcMuted}>
              {fill(t('shell.cloudEstimateModel'), { model: estimate.model, amount: usd(estimate.availableMicroUsd) })}
            </p>
            {estimate.price === null ? null : (
              <p className={css.pcMuted}>
                {fill(t('shell.cloudEstimatePrice'), {
                  input: estimate.price.inputMicroUsdPerMtok,
                  cached: estimate.price.cachedInputMicroUsdPerMtok,
                  output: estimate.price.outputMicroUsdPerMtok,
                })}
              </p>
            )}
          </>
        )
        : <p className={css.pcMuted}>{t(estimateReasonKey(estimate?.unavailableReason ?? null))}</p>}
    </section>
  )
}

/**
 * 个人中心整页。
 * @param props - 云端面、登录状态、词典与返回/登录回调。
 * @returns 账号、余额、预估与用量。
 */
export function PersonalCenter({ face, state, t, onBack }: PersonalCenterProps): ReactNode {
  const signedIn = state?.signedIn === true
  const user = state?.user ?? null
  const quota = state?.quota ?? null

  const [items, setItems] = useState<readonly CloudUsageItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<CloudErrorInfo | null>(null)
  /** 同一时刻只发一页；连点不会重复请求同一个游标。 */
  const flight = useRef(false)

  const loadPage = async (next: string | undefined): Promise<void> => {
    if (face === undefined || flight.current) return
    flight.current = true
    setLoading(true)
    setError(null)
    try {
      const answer = await face.usage({ limit: USAGE_PAGE_SIZE, ...next === undefined ? {} : { cursor: next } })
      if (answer.ok) {
        setItems(previous => next === undefined ? answer.value.items : [...previous, ...answer.value.items])
        setCursor(answer.value.nextCursor)
        setLoaded(true)
      } else {
        setError(answer.error)
      }
    } catch (failure: unknown) {
      setError({ code: 'cloud_unavailable', message: failure instanceof Error ? failure.message : String(failure) })
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
  }, [face, signedIn])

  const usage = (
    <section className={css.pcCard}>
      <h4 className={css.pcCardTitle}>{t('shell.cloudUsageTitle')}</h4>
      {!signedIn
        ? <p className={css.pcMuted}>{t('shell.cloudUsageSignIn')}</p>
        : (
          <>
            {error === null ? null : (
              <p className={css.pcNotice} role="alert">{fill(t(cloudErrorKey(error.code)), { code: error.code })}</p>
            )}
            {items.length === 0 && loaded && error === null
              ? <p className={css.pcMuted}>{t('shell.cloudUsageEmpty')}</p>
              : (
                <ul className={css.pcUsageList}>
                  {items.map(item => (
                    <li key={item.requestId} className={css.pcUsageItem}>
                      <span className={css.pcUsageTime}>{stamp(item.createdAt)}</span>
                      <span className={css.pcUsageModel}>{item.model}</span>
                      <span className={css.pcUsageTokens}>
                        {fill(t('shell.cloudUsageTokens'), {
                          prompt: item.promptTokens,
                          cached: item.cachedTokens,
                          completion: item.completionTokens,
                        })}
                      </span>
                      <span className={css.pcUsageCost}>{usdPrecise(item.costMicroUsd)}</span>
                      <span className={css.pcUsageStatus}>
                        {t(item.source === 'guest' ? 'shell.cloudUsageGuest' : 'shell.cloudUsageUser')}
                        {' · '}
                        {t(usageStatusKey(item.status))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            {cursor === null ? null : (
              <div className={css.pcActions}>
                <button
                  type="button"
                  className={css.secondaryBtn}
                  disabled={loading}
                  onClick={() => { void loadPage(cursor) }}
                >
                  {loading ? t('shell.cloudUsageLoading') : t('shell.cloudUsageMore')}
                </button>
              </div>
            )}
            {loading && items.length === 0 && error === null ? <p className={css.pcMuted}>{t('shell.cloudUsageLoading')}</p> : null}
          </>
        )}
    </section>
  )

  return (
    <div className={css.pcPage}>
      <header className={css.pcHead}>
        <button type="button" className={css.secondaryBtn} onClick={onBack}>← {t('shell.cloudBack')}</button>
        <div className={css.pcHeadText}>
          <h3 className={css.pcTitle}>{t('shell.cloudPersonalCenter')}</h3>
          <p className={css.pcSub}>
            {signedIn
              ? user?.displayName ?? user?.phoneMasked ?? t('shell.cloudSignedIn')
              : t('shell.cloudSignIn')}
          </p>
        </div>
      </header>

      <div className={css.pcGrid}>
        <section className={css.pcCard}>
          <h4 className={css.pcCardTitle}>{t('shell.cloudProfile')}</h4>
          {signedIn && user !== null
            ? (
              <>
                <Row label={t('shell.cloudDisplayNameShort')} value={user.displayName ?? '—'} />
                <Row label={t('shell.cloudPhone')} value={user.phoneMasked ?? '—'} />
                <Row label={t('shell.cloudStatus')} value={t(statusKey(user.status))} />
                <Row label={t('shell.cloudRegisteredAt')} value={stamp(user.createdAt)} />
                <Row label={t('shell.cloudLastLogin')} value={stamp(user.lastLoginAt)} />
              </>
            )
            : <p className={css.pcMuted}>{t('shell.cloudProfileUnavailable')}</p>}
        </section>

        <section className={css.pcCard}>
          <h4 className={css.pcCardTitle}>{t('shell.cloudBalance')}</h4>
          {signedIn && quota !== null
            ? (
              <>
                <Row label={t('shell.cloudGranted')} value={usd(quota.grantedMicroUsd)} />
                <Row label={t('shell.cloudSpent')} value={usd(quota.spentMicroUsd)} />
                <Row label={t('shell.cloudAvailable')} value={usd(quota.availableMicroUsd)} />
                <Row label={t('shell.cloudReserved')} value={usd(quota.reservedMicroUsd)} />
              </>
            )
            : <p className={css.pcMuted}>{t('shell.cloudBalanceUnavailable')}</p>}
        </section>

        <EstimateCard state={state} t={t} />
      </div>

      {usage}
    </div>
  )
}
