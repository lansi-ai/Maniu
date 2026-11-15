/** 全屏登录页：验证码、密码与注册三个页签。 */

import { useEffect, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import type { MessageKey, Translate } from '../locale.ts'
import { cloudErrorKey, cloudFace, type CloudErrorInfo } from './cloud.ts'
import { PaperWater } from '../theme/paper-water.tsx'
import { useRefractionFilter } from '../theme/refraction-glass.tsx'

/** 登录页签。 */
type LoginTab = 'sms' | 'password' | 'register'

/** 可校验字段。 */
type LoginField = 'phone' | 'code' | 'password'

/** 每个字段的就地提示。 */
type FieldErrors = Partial<Record<LoginField, 'login.invalidPhone' | 'login.invalidCode' | 'login.invalidPassword'>>

/**
 * 报错文案按页签区分：`invalid_credentials` 在短信登录里是「手机号未注册或验证码不对」，
 * 只有密码页签才是「手机号或密码不正确」；注册页签一律按验证码问题提示。
 * @param tab - 当前页签。
 * @param code - 云端业务错误码。
 * @returns 该页签使用的词典键。
 */
function loginErrorKey(tab: LoginTab, code: string): MessageKey {
  if (tab === 'register'
    && (code === 'invalid_credentials' || code === 'invalid_code' || code === 'validation_failed')) {
    return 'login.errorCode'
  }
  if (tab === 'sms' && code === 'invalid_credentials') return 'login.errorSmsCredentials'
  return cloudErrorKey(code)
}

/** 中国大陆手机号。 */
const PHONE_PATTERN = /^1[3-9][0-9]{9}$/

/** 六位数字验证码。 */
const CODE_PATTERN = /^[0-9]{6}$/

/** 英雄区示例代码：稳定节奏，每一步先验证再推进；注释走词典。 */
const HERO_CODE = [
  'const pace = steady(work)',
  'for (const step of plan) {',
  '  verify(step); advance(step)',
  '}',
]

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

/**
 * 把指针位置归一化后写进根元素的 --login-px / --login-py（-0.5～0.5）。
 * pointermove 只更新目标值，统一在 rAF 里写样式；减少动态效果时不跟随并清零。
 * @param root - 登录主区元素。
 */
function usePointerFollow(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current
    if (element === null) return
    const reduced = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    let frame = 0
    let nextX = 0
    let nextY = 0
    const flush = (): void => {
      frame = 0
      element.style.setProperty('--login-px', nextX.toFixed(3))
      element.style.setProperty('--login-py', nextY.toFixed(3))
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(flush)
    }
    const onMove = (event: PointerEvent): void => {
      if (reduced?.matches === true) return
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      nextX = (event.clientX - rect.left) / rect.width - 0.5
      nextY = (event.clientY - rect.top) / rect.height - 0.5
      schedule()
    }
    const reset = (): void => {
      nextX = 0
      nextY = 0
      schedule()
    }
    const onReduced = (): void => {
      if (reduced?.matches === true) reset()
    }
    element.addEventListener('pointermove', onMove, { passive: true })
    element.addEventListener('pointerleave', reset)
    reduced?.addEventListener('change', onReduced)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', reset)
      reduced?.removeEventListener('change', onReduced)
    }
  }, [root])
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
  /** 指针跟随只写主区上的 CSS 变量，各层用 transform 消费。 */
  const rootRef = useRef<HTMLElement | null>(null)
  usePointerFollow(rootRef)
  /** 卡面用边缘折射，页签、输入框与按钮沿用轻量 backdrop-filter。 */
  const refraction = useRefractionFilter({ blur: 8, strength: 1 })
  const [tab, setTab] = useState<LoginTab>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [countdown, setCountdown] = useState(0)
  /** 本期只做可交互的协议勾选，不参与校验与提交。 */
  const [agreed, setAgreed] = useState(false)
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

  const tabLabel = tab === 'register' ? t('login.registerTab') : t('login.title')
  const cardTitle = tab === 'register' ? t('login.cardTitleRegister') : t('login.cardTitle')
  const cardSubtitle = tab === 'register' ? t('login.cardSubtitleRegister') : t('login.cardSubtitle')
  const errorKey = error === null ? null : loginErrorKey(tab, error.code)

  return (
    <main className="login-screen" data-testid="login-screen" ref={rootRef}>
      <PaperWater />

      <div className="login-stage">
        <section className="login-hero" data-testid="login-hero">
          <div className="login-hero-kicker">
            <span className="login-hero-kicker-rule" aria-hidden="true" />
            <span className="login-hero-kicker-label">{t('login.kicker')}</span>
          </div>
          <h1 className="login-hero-title">{t('app.name')}</h1>
          <p className="login-hero-slogan">{t('welcome.slogan')}</p>
          <div className="login-hero-code" data-testid="login-ambient" aria-hidden="true">
            {HERO_CODE.map(line => <span key={line} className="login-hero-code-line">{line}</span>)}
            <span className="login-hero-code-line login-hero-code-note">{`// ${t('login.codeNote')}`}</span>
          </div>
        </section>

        <section
          className="login-card lg-glass"
          data-testid="login-card"
          ref={refraction.ref}
          style={refraction.style}
        >
          {refraction.defs}
          <div className="login-card-head">
            <span className="login-card-mark" aria-hidden="true"><span /></span>
            <div className="login-card-heading">
              <h2 className="login-card-title">{cardTitle}</h2>
              <p className="login-card-subtitle">{cardSubtitle}</p>
            </div>
          </div>

          <div className="login-tabs" role="tablist" aria-label={tabLabel}>
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
                <div className={fieldErrors.password === undefined ? 'login-control' : 'login-control invalid'}>
                  <input
                    id="lcoder-login-password"
                    data-testid="login-password"
                    className="login-entry"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    aria-invalid={fieldErrors.password !== undefined}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      clearFieldError('password')
                    }}
                  />
                </div>
                {fieldErrors.password === undefined ? null : <p className="login-field-error">{t(fieldErrors.password)}</p>}
              </div>
            )}

            {tab !== 'password' && (
              <div className="login-field">
                <label htmlFor="lcoder-login-code">{t('login.code')}</label>
                <div className="login-code-row">
                  <div className={fieldErrors.code === undefined ? 'login-control' : 'login-control invalid'}>
                    <input
                      id="lcoder-login-code"
                      data-testid="login-code"
                      className="login-entry"
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
                  </div>
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
                <div className={fieldErrors.password === undefined ? 'login-control' : 'login-control invalid'}>
                  <input
                    id="lcoder-login-new-password"
                    data-testid="login-new-password"
                    className="login-entry"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    aria-invalid={fieldErrors.password !== undefined}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      clearFieldError('password')
                    }}
                  />
                </div>
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

            <div className="login-agree">
              <input
                type="checkbox"
                className="login-agree-box"
                data-testid="login-agree"
                checked={agreed}
                onChange={(event) => { setAgreed(event.target.checked) }}
              />
              <span className="login-agree-text">
                {t('login.agreeLead')}
                <span className="login-agree-link">{t('login.agreeTerms')}</span>
                {t('login.agreeJoin')}
                <span className="login-agree-link">{t('login.agreePrivacy')}</span>
              </span>
            </div>

            <button type="submit" className="pill pill-accent lg-lift lg-sheen login-submit" data-testid="login-submit" disabled={busy !== undefined}>
              {busy === 'submit'
                ? t('login.submitting')
                : tab === 'register' ? t('login.submitRegister') : t('login.submitLogin')}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
