/** 顶栏账号入口与账户摘要弹窗。 */

import { useState } from 'react'
import type { JSX } from 'react'
import type { Translate } from '../locale.ts'
import { cloudErrorKey, cloudFace, type CloudErrorInfo, type CloudState } from './cloud.ts'
import { estimateRange, usd } from './format.ts'

/** 账号入口属性。 */
export interface AccountMenuProps {
  readonly state: CloudState | null
  readonly t: Translate
  readonly onPersonalCenter: () => void
  /** 刷新或退出后通知外壳重读状态。 */
  readonly onChanged: () => void | Promise<void>
}

/**
 * 顶栏账号入口；只在已登录时渲染。
 * @param props - 云端状态、词典与动作回调。
 * @returns 头像按钮与弹出的账户摘要。
 */
export function AccountMenu({ state, t, onPersonalCenter, onChanged }: AccountMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'refresh' | 'logout' | undefined>(undefined)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [error, setError] = useState<CloudErrorInfo | null>(null)
  const user = state?.user ?? null
  const quota = state?.quota ?? null
  const name = user?.displayName ?? user?.phoneMasked ?? t('account.signedIn')
  const initial = (name.replace(/^\+/, '') || 'L').slice(0, 1).toUpperCase()

  const refresh = async (): Promise<void> => {
    if (busy !== undefined) return
    setBusy('refresh')
    setError(null)
    const answer = await cloudFace.refresh()
    setBusy(undefined)
    if (!answer.ok) { setError(answer.error); return }
    await onChanged()
  }

  const logout = async (): Promise<void> => {
    if (busy !== undefined) return
    setBusy('logout')
    setError(null)
    const answer = await cloudFace.logout()
    setBusy(undefined)
    setConfirmLogout(false)
    if (!answer.ok) { setError(answer.error); return }
    setOpen(false)
    await onChanged()
  }

  return (
    <div className="account-entry">
      <button
        type="button"
        className="account-button lg-sheen"
        data-testid="account-button"
        aria-expanded={open}
        aria-label={t('account.menuTitle')}
        onClick={() => { setOpen(value => !value); setConfirmLogout(false); setError(null) }}
      >
        <span className="account-avatar" aria-hidden="true">{initial}</span>
        <span className="account-button-text">
          <span className="account-button-name">{name}</span>
          <span className="account-button-meta">
            {quota === null ? t('account.signedIn') : `${t('account.remaining')} ${usd(quota.availableMicroUsd)}`}
          </span>
        </span>
      </button>

      {open && (
        <>
          <div className="account-scrim" onClick={() => { setOpen(false) }} />
          <section className="account-pop lg-glass" data-testid="account-menu">
            <header className="account-pop-head">
              <strong>{name}</strong>
              <span>{quota === null ? t('account.signedIn') : `${t('account.remaining')} ${usd(quota.availableMicroUsd)}`}</span>
            </header>
            <p className="account-pop-estimate">
              {t('account.estimate')}: {estimateRange(state?.estimate ?? null, t)}
            </p>
            {state?.lastError === null || state?.lastError === undefined ? null : (
              <p className="notice">{t(cloudErrorKey(state.lastError.code), { code: state.lastError.code })}</p>
            )}
            {error === null ? null : <p className="notice">{t(cloudErrorKey(error.code), { code: error.code })}</p>}
            <div className="account-pop-actions">
              <button
                type="button"
                className="pill"
                data-testid="account-personal-center"
                onClick={() => { setOpen(false); onPersonalCenter() }}
              >
                {t('account.personalCenter')}
              </button>
              <button type="button" className="pill" data-testid="account-refresh" disabled={busy !== undefined} onClick={() => { void refresh() }}>
                {busy === 'refresh' ? t('account.refreshing') : t('account.refresh')}
              </button>
              {confirmLogout ? (
                <>
                  <button type="button" className="pill" onClick={() => { setConfirmLogout(false) }}>{t('account.cancel')}</button>
                  <button type="button" className="pill danger" data-testid="account-logout-confirm" disabled={busy !== undefined} onClick={() => { void logout() }}>
                    {busy === 'logout' ? t('account.loggingOut') : t('account.confirmLogout')}
                  </button>
                </>
              ) : (
                <button type="button" className="pill danger" data-testid="account-logout" disabled={busy !== undefined} onClick={() => { setConfirmLogout(true) }}>
                  {t('account.logout')}
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
