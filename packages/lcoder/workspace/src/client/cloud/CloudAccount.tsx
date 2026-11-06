/**
 * 顶栏账号入口与登录/账户弹窗。
 *
 * 登录弹窗只负责收集输入与展示失败；领取匿名授权、刷新令牌与落盘都在宿主。
 * 同一时刻只允许一个提交，倒计时结束前发送按钮不可用。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CloudErrorInfo, CloudGuestView, CloudState,
} from '@lcoder/kernel/src/cloud/types.ts'
import type { LcoderWorkspaceKey } from '../locales.ts'
import { cloudErrorAction, cloudErrorKey } from './errors.ts'
import type { CloudFace } from './face.ts'
import css from '../shell/Shell.module.css'

/** 弹窗模式。 */
export type CloudDialogMode = 'login' | 'account'

/** 顶栏账号入口 props。 */
export interface CloudAccountButtonProps {
  readonly state: CloudState | null
  readonly loading: boolean
  readonly t: (key: LcoderWorkspaceKey) => string
  readonly onClick: () => void
}

/** 登录/账户弹窗 props。 */
export interface CloudDialogProps {
  readonly mode: CloudDialogMode
  readonly face: CloudFace | undefined
  readonly state: CloudState | null
  readonly sessionId: SessionId | undefined
  readonly t: (key: LcoderWorkspaceKey) => string
  readonly onClose: () => void
  readonly onChanged: () => void | Promise<void>
}

/** 登录页签。 */
type LoginTab = 'sms' | 'password' | 'register'

/** 补词典占位符。 */
function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), text)
}

/** 微美元折成两位美元。 */
function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`
}

/** 手机号格式。 */
function validPhone(phone: string): boolean {
  return /^\+[1-9][0-9]{6,14}$/.test(phone.trim())
}

/** 顶栏账号入口。 */
export function CloudAccountButton({ state, loading, t, onClick }: CloudAccountButtonProps): ReactNode {
  const signedIn = state?.signedIn === true
  const user = state?.user ?? null
  const guest = state?.guest ?? null
  const name = user?.displayName ?? user?.phoneMasked ?? t('shell.cloudAccount')
  const initial = (name.replace(/^\+/, '') || 'L').slice(0, 1).toUpperCase()
  const quota = state?.quota ?? null
  const sub = signedIn
    ? quota === null
      ? t('shell.cloudSignedIn')
      : `${t('shell.cloudQuotaLeft')} ${usd(quota.availableMicroUsd)}`
    : state?.guestExpired === true
      ? t('shell.cloudGuestExpired')
      : guest !== null && guest.remainingRequests > 0
        ? fill(t('shell.cloudGuestRemaining'), { count: guest.remainingRequests })
        : t('shell.cloudSignInHint')
  return (
    <button
      type="button"
      className={`${css.cloudButton} ${signedIn ? css.cloudButtonSignedIn : ''}`}
      title={signedIn ? t('shell.cloudAccount') : t('shell.cloudSignIn')}
      onClick={onClick}
    >
      <span className={css.cloudAvatar}>{loading && state === null ? '…' : initial}</span>
      <span className={css.cloudButtonText}>
        <span className={css.cloudButtonName}>{loading && state === null ? t('shell.loading') : name}</span>
        <span className={css.cloudButtonMeta}>{sub}</span>
      </span>
    </button>
  )
}

/** 一处可复用的错误块。 */
function ErrorBox({ error, t }: { readonly error: CloudErrorInfo; readonly t: CloudDialogProps['t'] }): ReactNode {
  const action = cloudErrorAction(error.code)
  const key = cloudErrorKey(error.code)
  const text = fill(t(key), { code: error.code })
  return (
    <div className={css.cloudErrorBox} role="alert">
      <strong>{text}</strong>
      {error.requestId === undefined ? null : <span className={css.cloudRequestId}>{t('shell.cloudRequestId')}: {error.requestId}</span>}
      {action === 'login' ? <span>{t('shell.cloudNextLogin')}</span> : null}
      {action === 'retry' ? <span>{t('shell.cloudNextRetry')}</span> : null}
      {action === 'own-key' ? <span>{t('shell.cloudNextOwnKey')}</span> : null}
      {action === 'countdown' ? <span>{t('shell.cloudNextCountdown')}</span> : null}
    </div>
  )
}

/** 当前匿名剩余量的一行。 */
function GuestLine({ guest, expired, t }: {
  readonly guest: CloudGuestView | null
  readonly expired: boolean
  readonly t: CloudDialogProps['t']
}): ReactNode {
  if (expired) return <p className={css.cloudGuestLine}>{t('shell.cloudGuestExpired')}</p>
  if (guest === null) return <p className={css.cloudGuestLine}>{t('shell.cloudGuestAvailable')}</p>
  return (
    <p className={css.cloudGuestLine}>
      {fill(t('shell.cloudGuestRemaining'), { count: guest.remainingRequests })}
      {' · '}
      {fill(t('shell.cloudGuestCostLeft'), { amount: usd(guest.remainingCostMicroUsd) })}
    </p>
  )
}

/**
 * 登录或账户弹窗。
 * @param props - 模式、云端面、当前状态与回调。
 * @returns 登录表单或账户摘要。
 */
export function CloudDialog({ mode, face, state, sessionId, t, onClose, onChanged }: CloudDialogProps): ReactNode {
  const [tab, setTab] = useState<LoginTab>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [busy, setBusy] = useState<'send' | 'submit' | 'refresh' | 'logout' | undefined>(undefined)
  const [error, setError] = useState<CloudErrorInfo | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const phoneRef = useRef<HTMLInputElement | null>(null)
  /** 同一 tick 的连点也要挡住；`busy` 状态要等下一次渲染才生效。 */
  const busyRef = useRef(false)

  const begin = (kind: 'send' | 'submit' | 'refresh' | 'logout'): boolean => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(kind)
    return true
  }
  const end = (): void => {
    busyRef.current = false
    setBusy(undefined)
  }

  useEffect(() => {
    setError(null)
    setHint(null)
    if (mode === 'login') setTimeout(() => { phoneRef.current?.focus() }, 0)
  }, [mode])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => { setCountdown(value => Math.max(0, value - 1)) }, 1_000)
    return () => { clearInterval(timer) }
  }, [countdown])

  const guest = state?.guest ?? null
  const guestExpired = state?.guestExpired ?? false
  const quota = state?.quota ?? null
  const user = state?.user ?? null
  const title = mode === 'login' ? t('shell.cloudSignIn') : t('shell.cloudAccount')
  const subtitle = mode === 'login'
    ? t('shell.cloudLoginHint')
    : user === null ? t('shell.cloudSignedIn') : user.phoneMasked ?? user.displayName ?? user.id

  const sendCode = async (): Promise<void> => {
    if (face === undefined || countdown > 0) return
    if (!validPhone(phone)) { setError({ code: 'validation_failed', message: t('shell.cloudPhoneInvalid') }); return }
    if (!begin('send')) return
    setError(null); setHint(null)
    const answer = await face.sendSms({ phone: phone.trim(), purpose: tab === 'register' ? 'register' : 'login' })
    end()
    if (!answer.ok) {
      setError(answer.error)
      if (answer.error.retryAfterSeconds !== undefined) setCountdown(answer.error.retryAfterSeconds)
      return
    }
    setCountdown(answer.value.resendAfterSeconds)
    setHint(fill(t('shell.cloudCodeSent'), { seconds: answer.value.resendAfterSeconds }))
  }

  const submit = async (): Promise<void> => {
    if (face === undefined) return
    if (!validPhone(phone)) { setError({ code: 'validation_failed', message: t('shell.cloudPhoneInvalid') }); return }
    if (tab !== 'password' && !/^[0-9]{6}$/.test(code.trim())) {
      setError({ code: 'validation_failed', message: t('shell.cloudCodeInvalid') })
      return
    }
    if (tab !== 'sms' && password.length < 10) {
      setError({ code: 'validation_failed', message: t('shell.cloudPasswordTooShort') })
      return
    }
    if (!begin('submit')) return
    setError(null); setHint(null)
    const answer = tab === 'sms'
      ? await face.loginSms({ phone: phone.trim(), code: code.trim() })
      : tab === 'password'
        ? await face.loginPassword({ phone: phone.trim(), password })
        : await face.register({
          phone: phone.trim(),
          code: code.trim(),
          password,
          ...displayName.trim().length === 0 ? {} : { displayName: displayName.trim() },
        })
    end()
    if (!answer.ok) { setError(answer.error); return }
    await afterLogin()
  }

  /** 登录成功：切当前会话路由并关闭弹窗，不重开会话。 */
  const afterLogin = async (): Promise<void> => {
    if (face !== undefined && sessionId !== undefined) {
      const routed = await face.selectRoute(sessionId, 'user')
      if (!routed.ok) {
        setError(routed.error)
        await onChanged()
        return
      }
    }
    setCode(''); setPassword('')
    await onChanged()
    onClose()
  }

  const refresh = async (): Promise<void> => {
    if (face === undefined || !begin('refresh')) return
    setError(null)
    const answer = await face.refresh()
    end()
    if (!answer.ok) { setError(answer.error); return }
    await onChanged()
  }

  const logout = async (): Promise<void> => {
    if (face === undefined || !begin('logout')) return
    setError(null)
    const answer = await face.logout()
    end()
    setConfirmLogout(false)
    if (!answer.ok) { setError(answer.error); return }
    await onChanged()
    onClose()
  }

  const account = (
    <>
      <div className={css.cloudAccountGrid}>
        <div className={css.cloudMetric}>
          <span className={css.cloudMetricLabel}>{t('shell.cloudQuota')}</span>
          <span className={css.cloudMetricValue}>{quota === null ? '—' : usd(quota.availableMicroUsd)}</span>
          <span className={css.cloudMetricHint}>
            {quota === null ? '' : `${t('shell.cloudGranted')} ${usd(quota.grantedMicroUsd)}`}
          </span>
        </div>
        <div className={css.cloudMetric}>
          <span className={css.cloudMetricLabel}>{t('shell.cloudGuest')}</span>
          <span className={css.cloudMetricValue}>
            {guestExpired ? t('shell.cloudGuestExpiredShort') : guest === null ? '—' : String(guest.remainingRequests)}
          </span>
          <span className={css.cloudMetricHint}>
            {guest === null || guestExpired ? '' : fill(t('shell.cloudGuestCostLeft'), { amount: usd(guest.remainingCostMicroUsd) })}
          </span>
        </div>
      </div>
      <GuestLine guest={guest} expired={guestExpired} t={t} />
      {state?.lastError === null || state?.lastError === undefined ? null : <ErrorBox error={state.lastError} t={t} />}
      {error === null ? null : <ErrorBox error={error} t={t} />}
      <div className={css.cloudActions}>
        <button type="button" className={css.secondaryBtn} disabled={busy !== undefined} onClick={() => { void refresh() }}>
          {busy === 'refresh' ? t('shell.cloudRefreshing') : t('shell.cloudRefresh')}
        </button>
        {confirmLogout
          ? (
            <>
              <button type="button" className={css.secondaryBtn} disabled={busy !== undefined} onClick={() => { setConfirmLogout(false) }}>
                {t('shell.modelCancel')}
              </button>
              <button type="button" className={css.dangerBtn} disabled={busy !== undefined} onClick={() => { void logout() }}>
                {busy === 'logout' ? t('shell.modelSaving') : t('shell.cloudConfirmLogout')}
              </button>
            </>
          )
          : (
            <button type="button" className={css.dangerBtn} disabled={busy !== undefined} onClick={() => { setConfirmLogout(true) }}>
              {t('shell.cloudLogout')}
            </button>
          )}
      </div>
    </>
  )

  const login = (
    <>
      <div className={css.cloudTabs} role="tablist" aria-label={t('shell.cloudSignIn')}>
        {(['sms', 'password', 'register'] as const).map(item => (
          <button
            type="button"
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={`${css.cloudTab} ${tab === item ? css.cloudTabActive : ''}`}
            onClick={() => { setTab(item); setError(null); setHint(null) }}
          >
            {t(item === 'sms' ? 'shell.cloudTabSms' : item === 'password' ? 'shell.cloudTabPassword' : 'shell.cloudTabRegister')}
          </button>
        ))}
      </div>
      <form
        className={css.cloudForm}
        onSubmit={(event) => { event.preventDefault(); void submit() }}
      >
        <label className={css.field}>
          <span>{t('shell.cloudPhone')}</span>
          <input
            ref={phoneRef}
            id="lcoder-cloud-phone"
            className={css.modelInput}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            spellCheck={false}
            value={phone}
            placeholder="+8615550100000"
            onChange={(event) => { setPhone(event.target.value) }}
          />
          <span className={css.labelHint}>{t('shell.cloudPhoneHint')}</span>
        </label>
        {tab === 'password' ? (
          <label className={css.field}>
            <span>{t('shell.cloudPassword')}</span>
            <input
              className={css.modelInput}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => { setPassword(event.target.value) }}
            />
          </label>
        ) : (
          <label className={css.field}>
            <span>{t('shell.cloudCode')}</span>
            <div className={css.cloudCodeRow}>
              <input
                className={css.modelInput}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => { setCode(event.target.value.replace(/\D/g, '')) }}
              />
              <button
                type="button"
                className={css.secondaryBtn}
                disabled={busy !== undefined || countdown > 0 || !validPhone(phone)}
                onClick={() => { void sendCode() }}
              >
                {busy === 'send'
                  ? t('shell.cloudSending')
                  : countdown > 0 ? fill(t('shell.cloudResendIn'), { seconds: countdown }) : t('shell.cloudSendCode')}
              </button>
            </div>
          </label>
        )}
        {tab === 'register' ? (
          <>
            <label className={css.field}>
              <span>{t('shell.cloudPassword')}</span>
              <input
                className={css.modelInput}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => { setPassword(event.target.value) }}
              />
              <span className={css.labelHint}>{t('shell.cloudPasswordHint')}</span>
            </label>
            <label className={css.field}>
              <span>{t('shell.cloudDisplayName')}</span>
              <input
                className={css.modelInput}
                type="text"
                maxLength={40}
                value={displayName}
                onChange={(event) => { setDisplayName(event.target.value) }}
              />
            </label>
          </>
        ) : null}
        {hint === null ? null : <p className={css.cloudHint}>{hint}</p>}
        {error === null ? null : <ErrorBox error={error} t={t} />}
        <div className={css.cloudActions}>
          <button type="submit" className={css.primaryBtn} disabled={busy !== undefined}>
            {busy === 'submit'
              ? t('shell.cloudSubmitting')
              : tab === 'register' ? t('shell.cloudRegisterSubmit') : t('shell.cloudLoginSubmit')}
          </button>
          <button type="button" className={css.secondaryBtn} onClick={onClose}>{t('shell.cancel')}</button>
        </div>
      </form>
      <GuestLine guest={guest} expired={guestExpired} t={t} />
    </>
  )

  return (
    <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={`${css.modal} ${css.cloudModal}`}>
        <div className={css.modalHead}>
          <div className={css.grow}>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button type="button" className={css.iconBtn} onClick={onClose}>✕</button>
        </div>
        <div className={css.modalBody}>
          {mode === 'login' ? login : account}
        </div>
      </div>
    </div>
  )
}
