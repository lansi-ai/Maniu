/** 全屏登录页：验证码、密码与注册三个页签。 */

import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Translate } from '../locale.ts'
import { cloudErrorKey, cloudFace, type CloudErrorInfo } from './cloud.ts'

/** 登录页签。 */
type LoginTab = 'sms' | 'password' | 'register'

/** 可校验字段。 */
type LoginField = 'phone' | 'code' | 'password'

/** 每个字段的就地提示。 */
type FieldErrors = Partial<Record<LoginField, 'login.invalidPhone' | 'login.invalidCode' | 'login.invalidPassword'>>

/** 中国大陆手机号。 */
const PHONE_PATTERN = /^1[3-9][0-9]{9}$/

/** 六位数字验证码。 */
const CODE_PATTERN = /^[0-9]{6}$/

/**
 * 密码规则与云端一致：10–128 位，且同时含字母与数字。
 * @param value - 输入原文。
 * @returns 是否满足注册与密码登录的要求。
 */
function validPassword(value: string): boolean {
  return value.length >= 10 && value.length <= 128 && /[A-Za-z]/.test(value) && /[0-9]/.test(value)
}

/**
 * 只保留数字并截到 11 位；国家码由固定前缀承担。
 * @param value - 输入框原文。
 * @returns 过滤后的数字串。
 */
function phoneDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11)
}

/** 登录页属性。 */
export interface LoginScreenProps {
  readonly t: Translate
  /** 登录成功后通知外壳重读状态。 */
  readonly onAuthenticated: () => void | Promise<void>
}

/**
 * 登录页。
 * @param props - 词典与登录成功回调。
 * @returns 品牌区与表单。
 */
export function LoginScreen({ t, onAuthenticated }: LoginScreenProps): JSX.Element {
  const [tab, setTab] = useState<LoginTab>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState<'send' | 'submit' | undefined>(undefined)
  const [error, setError] = useState<CloudErrorInfo | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  /** 同一 tick 的连点也要挡住；`busy` 要下一次渲染才生效。 */
  const busyRef = useRef(false)

  const begin = (kind: 'send' | 'submit'): boolean => {
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
    if (countdown <= 0) return
    const timer = setInterval(() => { setCountdown(value => Math.max(0, value - 1)) }, 1_000)
    return () => { clearInterval(timer) }
  }, [countdown])

  const clearFieldError = (field: LoginField): void => {
    setFieldErrors(current => current[field] === undefined ? current : { ...current, [field]: undefined })
  }

  const fullPhone = `+86${phone}`

  const sendCode = async (): Promise<void> => {
    if (countdown > 0 || busyRef.current) return
    if (!PHONE_PATTERN.test(phone)) {
      setFieldErrors(errors => ({ ...errors, phone: 'login.invalidPhone' }))
      return
    }
    if (!begin('send')) return
    setError(null); setHint(null)
    const answer = await cloudFace.sendSms({ phone: fullPhone, purpose: tab === 'register' ? 'register' : 'login' })
    end()
    if (!answer.ok) {
      setError(answer.error)
      if (answer.error.retryAfterSeconds !== undefined) setCountdown(answer.error.retryAfterSeconds)
      return
    }
    setCountdown(answer.value.resendAfterSeconds)
    setHint(t('login.codeSent', { seconds: answer.value.resendAfterSeconds }))
  }

  const submit = async (): Promise<void> => {
    if (busyRef.current) return
    const problems: FieldErrors = {}
    if (!PHONE_PATTERN.test(phone)) problems.phone = 'login.invalidPhone'
    if (tab !== 'password' && !CODE_PATTERN.test(code)) problems.code = 'login.invalidCode'
    if (tab !== 'sms' && !validPassword(password)) problems.password = 'login.invalidPassword'
    setFieldErrors(problems)
    if (Object.keys(problems).length > 0) return
    if (!begin('submit')) return
    setError(null); setHint(null)
    const answer = tab === 'sms'
      ? await cloudFace.loginSms({ phone: fullPhone, code })
      : tab === 'password'
        ? await cloudFace.loginPassword({ phone: fullPhone, password })
        : await cloudFace.register({ phone: fullPhone, code, password })
    end()
    if (!answer.ok) { setError(answer.error); return }
    setCode('')
    setPassword('')
    await onAuthenticated()
  }

  const title = tab === 'register' ? t('login.registerTab') : t('login.title')
  const errorKey = error === null ? null : cloudErrorKey(error.code)

  return (
    <main className="center" data-testid="login-screen">
      <section className="login-card lg-glass" data-testid="login-card">
        <header className="login-brand">
          <span className="login-mark" aria-hidden="true">L</span>
          <div>
            <h1>{t('app.name')}</h1>
            <p>{t('welcome.slogan')}</p>
          </div>
        </header>

        <div className="login-tabs" role="tablist" aria-label={title}>
          {(['sms', 'password', 'register'] as const).map(item => (
            <button
              key={item}
              type="button"
              role="tab"
              data-testid={`login-tab-${item}`}
              aria-selected={tab === item}
              className={tab === item ? 'login-tab active' : 'login-tab'}
              onClick={() => { setTab(item); setError(null); setHint(null); setFieldErrors({}) }}
            >
              {t(item === 'sms' ? 'login.smsTab' : item === 'password' ? 'login.passwordTab' : 'login.registerTab')}
            </button>
          ))}
        </div>

        <form
          className="login-form"
          onSubmit={(event) => { event.preventDefault(); void submit() }}
        >
          <div className="login-field">
            <label htmlFor="lcoder-login-phone">{t('login.phone')}</label>
            <div className={fieldErrors.phone === undefined ? 'login-phone' : 'login-phone invalid'}>
              <span className="login-prefix">+86</span>
              <input
                id="lcoder-login-phone"
                data-testid="login-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                spellCheck={false}
                autoFocus
                value={phone}
                placeholder={t('login.phonePlaceholder')}
                aria-invalid={fieldErrors.phone !== undefined}
                onChange={(event) => {
                  setPhone(phoneDigits(event.target.value))
                  clearFieldError('phone')
                }}
              />
            </div>
            {fieldErrors.phone === undefined ? null : <p className="login-field-error">{t(fieldErrors.phone)}</p>}
          </div>

          {tab === 'password' && (
            <div className="login-field">
              <label htmlFor="lcoder-login-password">{t('login.password')}</label>
              <input
                id="lcoder-login-password"
                data-testid="login-password"
                className={fieldErrors.password === undefined ? 'login-input' : 'login-input invalid'}
                type="password"
                autoComplete="current-password"
                value={password}
                aria-invalid={fieldErrors.password !== undefined}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearFieldError('password')
                }}
              />
              {fieldErrors.password === undefined ? null : <p className="login-field-error">{t(fieldErrors.password)}</p>}
            </div>
          )}

          {tab !== 'password' && (
            <div className="login-field">
              <label htmlFor="lcoder-login-code">{t('login.code')}</label>
              <div className="login-code-row">
                <input
                  id="lcoder-login-code"
                  data-testid="login-code"
                  className={fieldErrors.code === undefined ? 'login-input' : 'login-input invalid'}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  aria-invalid={fieldErrors.code !== undefined}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, ''))
                    clearFieldError('code')
                  }}
                />
                <button
                  type="button"
                  className="pill"
                  data-testid="login-send-code"
                  disabled={busy !== undefined || countdown > 0}
                  onClick={() => { void sendCode() }}
                >
                  {busy === 'send'
                    ? t('login.sendingCode')
                    : countdown > 0 ? t('login.resendIn', { seconds: countdown }) : t('login.sendCode')}
                </button>
              </div>
              {fieldErrors.code === undefined ? null : <p className="login-field-error">{t(fieldErrors.code)}</p>}
            </div>
          )}

          {tab === 'register' && (
            <div className="login-field">
              <label htmlFor="lcoder-login-new-password">{t('login.password')}</label>
              <input
                id="lcoder-login-new-password"
                data-testid="login-new-password"
                className={fieldErrors.password === undefined ? 'login-input' : 'login-input invalid'}
                type="password"
                autoComplete="new-password"
                value={password}
                aria-invalid={fieldErrors.password !== undefined}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearFieldError('password')
                }}
              />
              <span className="login-hint">{t('login.passwordHint')}</span>
              {fieldErrors.password === undefined ? null : <p className="login-field-error">{t(fieldErrors.password)}</p>}
            </div>
          )}

          {hint === null ? null : <p className="login-hint" data-testid="login-hint">{hint}</p>}
          {error === null || errorKey === null ? null : (
            <div className="login-error" role="alert" data-testid="login-error">
              <strong>{t(errorKey, { code: error.code })}</strong>
              {error.requestId === undefined ? null : <span>{t('login.requestId')}: {error.requestId}</span>}
            </div>
          )}

          <button type="submit" className="pill pill-accent login-submit" data-testid="login-submit" disabled={busy !== undefined}>
            {busy === 'submit'
              ? t('login.submitting')
              : tab === 'register' ? t('login.submitRegister') : t('login.submitLogin')}
          </button>
        </form>
      </section>
    </main>
  )
}
