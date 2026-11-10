/**
 * 顶栏账号入口与登录/账户弹窗。
 *
 * 登录弹窗只负责收集输入与展示失败；领取匿名授权、刷新令牌与落盘都在宿主。
 * 同一时刻只允许一个提交，倒计时结束前发送按钮不可用。字段校验在失焦提交时
 * 就地报错，改动该字段即清除它的提示。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloudErrorInfo, CloudState } from '@lcoder/kernel/src/cloud/types.ts'
import type { LcoderWorkspaceKey } from '../locales.ts'
import { cloudErrorAction, cloudErrorKey } from './errors.ts'
import { activeEstimate, estimateRange, fill, usd } from './estimate.ts'
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
  /** 账户弹窗里进入个人中心；缺省时不显示入口。 */
  readonly onOpenPersonalCenter?: () => void
}

/** 登录页签。 */
type LoginTab = 'sms' | 'password' | 'register'

/** 可校验的输入字段。 */
type LoginField = 'phone' | 'code' | 'password'

/** 每个字段的就地提示；缺省表示该字段没有错误。 */
type FieldErrors = Partial<Record<LoginField, LcoderWorkspaceKey>>

/** 中国大陆手机号：只收 11 位数字，1 开头，第二位 3–9。 */
const PHONE_PATTERN = /^1[3-9][0-9]{9}$/

/** 验证码：6 位数字。 */
const CODE_PATTERN = /^[0-9]{6}$/

/**
 * 密码规则与云端一致：10 到 128 位，且同时含字母与数字。
 * @param value - 用户输入的密码原文。
 * @returns 是否满足注册与密码登录的要求。
 */
function validPassword(value: string): boolean {
  return value.length >= 10 && value.length <= 128 && /[A-Za-z]/.test(value) && /[0-9]/.test(value)
}

/**
 * 只保留手机号里的数字并截到 11 位；国家码由固定前缀承担。
 * @param value - 输入框的原始文本。
 * @returns 过滤后的 11 位以内的数字串。
 */
function phoneDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11)
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

/**
 * 登录或账户弹窗。
 * @param props - 模式、云端面、当前状态与回调。
 * @returns 登录表单或账户摘要。
 */
export function CloudDialog({ mode, face, state, sessionId, t, onClose, onChanged, onOpenPersonalCenter }: CloudDialogProps): ReactNode {
  const [tab, setTab] = useState<LoginTab>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
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
    setFieldErrors({})
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
  const title = mode === 'login'
    ? tab === 'register' ? t('shell.cloudRegisterTitle') : t('shell.cloudSignIn')
    : t('shell.cloudAccount')
  const subtitle = mode === 'login'
    ? null
    : user === null ? t('shell.cloudSignedIn') : user.phoneMasked ?? user.displayName ?? user.id

  /** 只清除被改动字段的提示，别的字段保持原样。 */
  const clearFieldError = (field: LoginField): void => {
    setFieldErrors(current => current[field] === undefined ? current : { ...current, [field]: undefined })
  }

  /** 手机号以固定 +86 前缀组合成 E.164 再交给宿主。 */
  const fullPhone = `+86${phone}`

  const sendCode = async (): Promise<void> => {
    if (face === undefined || countdown > 0) return
    if (!PHONE_PATTERN.test(phone)) {
      setFieldErrors(errors => ({ ...errors, phone: 'shell.cloudPhoneInvalid' }))
      return
    }
    if (!begin('send')) return
    setError(null); setHint(null)
    const answer = await face.sendSms({ phone: fullPhone, purpose: tab === 'register' ? 'register' : 'login' })
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
    const problems: FieldErrors = {}
    if (!PHONE_PATTERN.test(phone)) problems.phone = 'shell.cloudPhoneInvalid'
    if (tab !== 'password' && !CODE_PATTERN.test(code)) problems.code = 'shell.cloudCodeInvalid'
    if (tab !== 'sms' && !validPassword(password)) problems.password = 'shell.cloudPasswordInvalid'
    setFieldErrors(problems)
    if (Object.keys(problems).length > 0) return
    if (!begin('submit')) return
    setError(null); setHint(null)
    const answer = tab === 'sms'
      ? await face.loginSms({ phone: fullPhone, code })
      : tab === 'password'
        ? await face.loginPassword({ phone: fullPhone, password })
        : await face.register({ phone: fullPhone, code, password })
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
      <p className={css.cloudGuestLine}>
        {t('shell.cloudEstimateDialogLabel')}
        {': '}
        {estimateRange(activeEstimate(state), t)}
      </p>
      {state?.lastError === null || state?.lastError === undefined ? null : <ErrorBox error={state.lastError} t={t} />}
      {error === null ? null : <ErrorBox error={error} t={t} />}
      <div className={css.cloudActions}>
        {onOpenPersonalCenter === undefined ? null : (
          <button
            type="button"
            className={css.secondaryBtn}
            disabled={busy !== undefined}
            onClick={() => { onOpenPersonalCenter() }}
          >
            {t('shell.cloudOpenPersonalCenter')}
          </button>
        )}
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
            onClick={() => { setTab(item); setError(null); setHint(null); setFieldErrors({}) }}
          >
            {t(item === 'sms' ? 'shell.cloudTabSms' : item === 'password' ? 'shell.cloudTabPassword' : 'shell.cloudTabRegister')}
          </button>
        ))}
      </div>
      <form
        className={css.cloudForm}
        onSubmit={(event) => { event.preventDefault(); void submit() }}
      >
        <div className={css.field}>
          <label htmlFor="lcoder-cloud-phone">{t('shell.cloudPhone')}</label>
          <div className={`${css.cloudPhoneRow} ${fieldErrors.phone === undefined ? '' : css.cloudFieldInvalid}`}>
            <span className={css.cloudPhonePrefix}>+86</span>
            <input
              ref={phoneRef}
              id="lcoder-cloud-phone"
              className={css.cloudPhoneInput}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              spellCheck={false}
              value={phone}
              placeholder={t('shell.cloudPhonePlaceholder')}
              aria-invalid={fieldErrors.phone !== undefined}
              aria-describedby={fieldErrors.phone === undefined ? undefined : 'lcoder-cloud-phone-error'}
              onChange={(event) => {
                setPhone(phoneDigits(event.target.value))
                clearFieldError('phone')
              }}
            />
          </div>
          {fieldErrors.phone === undefined
            ? null
            : <p className={css.cloudFieldError} id="lcoder-cloud-phone-error">{t(fieldErrors.phone)}</p>}
        </div>
        {tab === 'password' ? (
          <div className={css.field}>
            <label htmlFor="lcoder-cloud-password">{t('shell.cloudPassword')}</label>
            <input
              id="lcoder-cloud-password"
              className={`${css.modelInput} ${fieldErrors.password === undefined ? '' : css.cloudFieldInvalid}`}
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={fieldErrors.password !== undefined}
              aria-describedby={fieldErrors.password === undefined ? undefined : 'lcoder-cloud-password-error'}
              onChange={(event) => {
                setPassword(event.target.value)
                clearFieldError('password')
              }}
            />
            {fieldErrors.password === undefined
              ? null
              : <p className={css.cloudFieldError} id="lcoder-cloud-password-error">{t(fieldErrors.password)}</p>}
          </div>
        ) : (
          <div className={css.field}>
            <label htmlFor="lcoder-cloud-code">{t('shell.cloudCode')}</label>
            <div className={css.cloudCodeRow}>
              <input
                id="lcoder-cloud-code"
                className={`${css.modelInput} ${fieldErrors.code === undefined ? '' : css.cloudFieldInvalid}`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                aria-invalid={fieldErrors.code !== undefined}
                aria-describedby={fieldErrors.code === undefined ? undefined : 'lcoder-cloud-code-error'}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, ''))
                  clearFieldError('code')
                }}
              />
              <button
                type="button"
                className={css.secondaryBtn}
                disabled={busy !== undefined || countdown > 0}
                onClick={() => { void sendCode() }}
              >
                {busy === 'send'
                  ? t('shell.cloudSending')
                  : countdown > 0 ? fill(t('shell.cloudResendIn'), { seconds: countdown }) : t('shell.cloudSendCode')}
              </button>
            </div>
            {fieldErrors.code === undefined
              ? null
              : <p className={css.cloudFieldError} id="lcoder-cloud-code-error">{t(fieldErrors.code)}</p>}
          </div>
        )}
        {tab === 'register' ? (
          <div className={css.field}>
            <label htmlFor="lcoder-cloud-password">{t('shell.cloudPassword')}</label>
            <input
              id="lcoder-cloud-password"
              className={`${css.modelInput} ${fieldErrors.password === undefined ? '' : css.cloudFieldInvalid}`}
              type="password"
              autoComplete="new-password"
              value={password}
              aria-invalid={fieldErrors.password !== undefined}
              aria-describedby={fieldErrors.password === undefined ? undefined : 'lcoder-cloud-password-error'}
              onChange={(event) => {
                setPassword(event.target.value)
                clearFieldError('password')
              }}
            />
            <span className={css.labelHint}>{t('shell.cloudPasswordHint')}</span>
            {fieldErrors.password === undefined
              ? null
              : <p className={css.cloudFieldError} id="lcoder-cloud-password-error">{t(fieldErrors.password)}</p>}
          </div>
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
    </>
  )

  return (
    <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={`${css.modal} ${css.cloudModal}`}>
        <div className={css.modalHead}>
          <div className={css.grow}>
            <h3>{title}</h3>
            {subtitle === null ? null : <p>{subtitle}</p>}
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
