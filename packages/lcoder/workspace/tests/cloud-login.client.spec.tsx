// @vitest-environment jsdom
/**
 * 登录门禁、错误码映射与全屏登录页的交互。
 *
 * 数据面全部用记录器替身；这里只断言界面发出的调用、重复点击的幂等与可见文案。
 * 桌面端已去匿名：登录页不弹窗、不含关闭按钮，成功只回调外壳重新读状态。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { CloudAuthValue } from '@lcoder/kernel/src/cloud/types.ts'
import { CloudLoginScreen } from '../src/client/cloud/CloudAccount.tsx'
import { cloudErrorAction, cloudErrorKey } from '../src/client/cloud/errors.ts'
import type { CloudFace } from '../src/client/cloud/face.ts'
import { gateEntry } from '../src/client/cloud/gate.ts'
import type { CloudGateFacts } from '../src/client/cloud/gate.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

/** 一套登录/云端事实。 */
function facts(overrides: Partial<CloudGateFacts> = {}): CloudGateFacts {
  return { signedIn: false, loading: false, cloudUnavailable: false, ...overrides }
}

describe('登录门禁', () => {
  it('所有入口在未登录时都要登录，匿名立项不再放行', () => {
    for (const entry of [
      'onboarding', 'onboardingFollowup', 'newSession', 'taskConversation',
      'contractSign', 'proposalApprove', 'flowBatch', 'modelSettings',
    ] as const) {
      expect(gateEntry(entry, facts())).toEqual({ kind: 'login', reason: entry })
    }
  })

  it('登录后所有入口放行；加载中与云端未装配分别阻断', () => {
    for (const entry of ['newSession', 'taskConversation', 'contractSign', 'proposalApprove', 'flowBatch', 'modelSettings', 'onboarding', 'onboardingFollowup'] as const) {
      expect(gateEntry(entry, facts({ signedIn: true }))).toEqual({ kind: 'allow' })
    }
    expect(gateEntry('onboarding', facts({ loading: true }))).toEqual({ kind: 'blocked', reason: 'loading' })
    expect(gateEntry('newSession', facts({ loading: true }))).toEqual({ kind: 'blocked', reason: 'loading' })
    expect(gateEntry('newSession', facts({ cloudUnavailable: true }))).toEqual({ kind: 'blocked', reason: 'cloud-unavailable' })
  })
})

describe('错误码映射', () => {
  it('验收涉及的码都有独立文案与下一步', () => {
    expect(cloudErrorKey('quota_exhausted')).toBe('shell.cloudErrorQuota')
    expect(cloudErrorKey('banned')).toBe('shell.cloudErrorBanned')
    expect(cloudErrorKey('token_expired')).toBe('shell.cloudErrorTokenExpired')
    expect(cloudErrorKey('upstream_unavailable')).toBe('shell.cloudErrorUpstream')
    expect(cloudErrorKey('offline')).toBe('shell.cloudOffline')
    expect(cloudErrorKey('unknown_future_code')).toBe('shell.cloudErrorGeneric')
    expect(cloudErrorAction('quota_exhausted')).toBe('own-key')
    expect(cloudErrorAction('banned')).toBe('none')
    expect(cloudErrorAction('upstream_unavailable')).toBe('retry')
    expect(cloudErrorAction('sms_rate_limited')).toBe('countdown')
  })
})

/** 登录页用的替身面。 */
function faceOf(overrides: Partial<CloudFace> = {}): CloudFace {
  return {
    available: true,
    state: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        signedIn: false, needsLogin: false, user: null, quota: null, estimate: null, guest: null, guestExpired: false, lastError: null,
      },
    }),
    sendSms: vi.fn().mockResolvedValue({ ok: true, value: { requestId: 'r1', resendAfterSeconds: 60, expiresInSeconds: 300 } }),
    register: vi.fn(),
    loginSms: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        user: { id: 'u1', displayName: null, phoneMasked: '+861****0000', status: 'active' },
        quota: {
          grantedMicroUsd: 20_000_000, reservedMicroUsd: 0, spentMicroUsd: 0, availableMicroUsd: 20_000_000, currency: 'USD',
        },
        expiresIn: 900,
      },
    }),
    loginPassword: vi.fn(),
    refresh: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    usage: vi.fn(),
    selectRoute: vi.fn().mockResolvedValue({ ok: true, value: { provider: 'lcoder-cloud', model: 'deepseek-flash' } }),
    ...overrides,
  }
}

/** 已登录会话的授权结果，注册与登录成功都复用它。 */
function authSession(): CloudAuthValue {
  return {
    user: { id: 'u1', displayName: null, phoneMasked: '+861****0000', status: 'active' },
    quota: {
      grantedMicroUsd: 20_000_000, reservedMicroUsd: 0, spentMicroUsd: 0, availableMicroUsd: 20_000_000, currency: 'USD',
    },
    expiresIn: 900,
  }
}

/** 渲染全屏登录页；回调可替换。 */
function renderLogin(
  face: CloudFace | undefined,
  options: { readonly loading?: boolean; readonly error?: Parameters<typeof CloudLoginScreen>[0]['error'] } = {},
): { readonly onAuthenticated: ReturnType<typeof vi.fn>; readonly onRetry: ReturnType<typeof vi.fn> } {
  const onAuthenticated = vi.fn()
  const onRetry = vi.fn()
  render(
    <CloudLoginScreen
      face={face}
      loading={options.loading ?? false}
      error={options.error ?? null}
      t={t}
      onRetry={onRetry}
      onAuthenticated={onAuthenticated}
    />,
  )
  return { onAuthenticated, onRetry }
}

/** 手机号输入框；前缀固定 +86，只收 11 位数字。 */
function phoneInput(): HTMLInputElement {
  return screen.getByLabelText(/手机号/) as HTMLInputElement
}

describe('全屏登录页', () => {
  it('整屏渲染且没有遮罩、关闭按钮与取消按钮', () => {
    renderLogin(faceOf())
    expect(screen.getByRole('heading', { name: zh['shell.cloudSignIn'], level: 2 })).toBeTruthy()
    expect(screen.getByRole('tab', { name: zh['shell.cloudTabSms'] })).toBeTruthy()
    expect(document.querySelector('[class*="modalBackdrop"]')).toBeNull()
    expect(screen.queryByRole('button', { name: '✕' })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['shell.cancel'] })).toBeNull()
  })

  it('读取登录状态时只显示加载态，不渲染表单', () => {
    renderLogin(faceOf(), { loading: true })
    expect(screen.getByText(zh['shell.loginChecking'])).toBeTruthy()
    expect(screen.queryByLabelText(/手机号/)).toBeNull()
  })

  it('读不到登录状态时就地报错并可重试，不放行到表单', () => {
    const { onRetry } = renderLogin(undefined, { error: { code: 'cloud_unavailable', message: 'not mounted' } })
    expect(screen.getByText(zh['shell.loginUnavailable'])).toBeTruthy()
    expect(screen.queryByLabelText(/手机号/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['shell.loginRetry'] }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('连点发送验证码只发一次，并进入倒计时', async () => {
    const sendSms = vi.fn().mockResolvedValue({ ok: true, value: { requestId: 'r1', resendAfterSeconds: 60, expiresInSeconds: 300 } })
    renderLogin(faceOf({ sendSms }))
    fireEvent.change(phoneInput(), { target: { value: '15550100000' } })
    const send = screen.getByRole('button', { name: zh['shell.cloudSendCode'] })
    fireEvent.click(send)
    fireEvent.click(send)
    await waitFor(() => { expect(sendSms).toHaveBeenCalledTimes(1) })
    expect(sendSms).toHaveBeenCalledWith({ phone: '+8615550100000', purpose: 'login' })
    await waitFor(() => { expect(screen.getAllByText(/60/).length).toBeGreaterThan(0) })
  })

  it('登录成功只通知外壳重新读状态，不关闭任何弹窗', async () => {
    const loginSms = vi.fn().mockResolvedValue({ ok: true, value: authSession() })
    const { onAuthenticated } = renderLogin(faceOf({ loginSms }))
    fireEvent.change(phoneInput(), { target: { value: '15550100000' } })
    fireEvent.change(screen.getByLabelText(zh['shell.cloudCode']), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: zh['shell.cloudLoginSubmit'] }))
    await waitFor(() => {
      expect(loginSms).toHaveBeenCalledWith({ phone: '+8615550100000', code: '123456' })
      expect(onAuthenticated).toHaveBeenCalledTimes(1)
    })
  })

  it('验证码发送太频繁时就地显示映射文案并给出倒计时', async () => {
    const sendSms = vi.fn().mockResolvedValue({ ok: false, error: { code: 'sms_rate_limited', message: 'slow down', retryAfterSeconds: 30 } })
    renderLogin(faceOf({ sendSms }))
    fireEvent.change(phoneInput(), { target: { value: '15550100000' } })
    fireEvent.click(screen.getByRole('button', { name: zh['shell.cloudSendCode'] }))
    await waitFor(() => { expect(screen.getByText(zh['shell.cloudErrorSmsRateLimited'])).toBeTruthy() })
    expect(screen.getByText(/30/)).toBeTruthy()
  })

  it('注册页签标题为「注册 LCoder」，切回登录页签恢复登录标题', () => {
    renderLogin(faceOf())
    expect(screen.getByRole('heading', { name: zh['shell.cloudSignIn'], level: 2 })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh['shell.cloudTabRegister'] }))
    expect(screen.getByRole('heading', { name: zh['shell.cloudRegisterTitle'], level: 2 })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: zh['shell.cloudSignIn'], level: 2 })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: zh['shell.cloudTabSms'] }))
    expect(screen.getByRole('heading', { name: zh['shell.cloudSignIn'], level: 2 })).toBeTruthy()
  })

  it('注册页没有显示名输入，提交只传手机号、验证码与密码', async () => {
    const register = vi.fn().mockResolvedValue({ ok: true, value: authSession() })
    const { onAuthenticated } = renderLogin(faceOf({ register }))
    fireEvent.click(screen.getByRole('tab', { name: zh['shell.cloudTabRegister'] }))
    expect(screen.queryByLabelText(/显示名/)).toBeNull()
    fireEvent.change(phoneInput(), { target: { value: '15550100000' } })
    fireEvent.change(screen.getByLabelText(zh['shell.cloudCode']), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText(zh['shell.cloudPassword']), { target: { value: 'abc1234567' } })
    fireEvent.click(screen.getByRole('button', { name: zh['shell.cloudRegisterSubmit'] }))
    await waitFor(() => {
      expect(register).toHaveBeenCalledWith({ phone: '+8615550100000', code: '123456', password: 'abc1234567' })
      expect(onAuthenticated).toHaveBeenCalledTimes(1)
    })
  })

  it('手机号只保留数字并限 11 位', () => {
    renderLogin(faceOf())
    fireEvent.change(phoneInput(), { target: { value: '1555-010-0000123x' } })
    expect(phoneInput().value).toBe('15550100000')
    fireEvent.change(phoneInput(), { target: { value: '+86 15550100000' } })
    expect(phoneInput().value).toBe('86155501000')
  })

  it('手机号不合法时点发送验证码给出字段提示且不发请求', () => {
    const sendSms = vi.fn()
    renderLogin(faceOf({ sendSms }))
    fireEvent.change(phoneInput(), { target: { value: '12345' } })
    const send = screen.getByRole('button', { name: zh['shell.cloudSendCode'] }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(screen.getByText(zh['shell.cloudPhoneInvalid'])).toBeTruthy()
    expect(phoneInput().getAttribute('aria-invalid')).toBe('true')
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('空表单提交逐字段报错，改动字段后只清除该字段的提示', () => {
    renderLogin(faceOf())
    fireEvent.click(screen.getByRole('tab', { name: zh['shell.cloudTabRegister'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['shell.cloudRegisterSubmit'] }))
    expect(screen.getByText(zh['shell.cloudPhoneInvalid'])).toBeTruthy()
    expect(screen.getByText(zh['shell.cloudCodeInvalid'])).toBeTruthy()
    expect(screen.getByText(zh['shell.cloudPasswordInvalid'])).toBeTruthy()
    fireEvent.change(screen.getByLabelText(zh['shell.cloudCode']), { target: { value: '123456' } })
    expect(screen.queryByText(zh['shell.cloudCodeInvalid'])).toBeNull()
    expect(screen.getByText(zh['shell.cloudPhoneInvalid'])).toBeTruthy()
    expect(screen.getByText(zh['shell.cloudPasswordInvalid'])).toBeTruthy()
  })
})
