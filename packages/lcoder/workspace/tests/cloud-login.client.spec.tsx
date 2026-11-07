// @vitest-environment jsdom
/**
 * 匿名门禁、错误码映射与登录弹窗的交互。
 *
 * 数据面全部用记录器替身；这里只断言界面发出的调用、重复点击的幂等与可见文案。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { CloudDialog } from '../src/client/cloud/CloudAccount.tsx'
import { cloudErrorAction, cloudErrorKey } from '../src/client/cloud/errors.ts'
import type { CloudFace } from '../src/client/cloud/face.ts'
import { gateEntry } from '../src/client/cloud/gate.ts'
import type { CloudGateFacts } from '../src/client/cloud/gate.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

/** 一套匿名/登录事实。 */
function facts(overrides: Partial<CloudGateFacts> = {}): CloudGateFacts {
  return { signedIn: false, loading: false, cloudUnavailable: false, onboardingSession: false, ...overrides }
}

describe('匿名门禁', () => {
  it('立项可用，其余入口在匿名状态弹登录', () => {
    expect(gateEntry('onboarding', facts())).toEqual({ kind: 'allow' })
    expect(gateEntry('newSession', facts())).toEqual({ kind: 'login', reason: 'newSession' })
    expect(gateEntry('taskConversation', facts())).toEqual({ kind: 'login', reason: 'taskConversation' })
    expect(gateEntry('contractSign', facts())).toEqual({ kind: 'login', reason: 'contractSign' })
    expect(gateEntry('flowBatch', facts())).toEqual({ kind: 'login', reason: 'flowBatch' })
    expect(gateEntry('modelSettings', facts())).toEqual({ kind: 'login', reason: 'modelSettings' })
  })

  it('匿名立项会话内的追问仍然可用', () => {
    expect(gateEntry('onboardingFollowup', facts({ onboardingSession: true }))).toEqual({ kind: 'allow' })
    expect(gateEntry('onboardingFollowup', facts())).toEqual({ kind: 'login', reason: 'onboardingFollowup' })
  })

  it('登录后所有入口放行；加载中与云端未装配分别阻断', () => {
    for (const entry of ['newSession', 'taskConversation', 'contractSign', 'proposalApprove', 'flowBatch', 'modelSettings', 'onboardingFollowup'] as const) {
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
    expect(cloudErrorKey('guest_quota_exhausted')).toBe('shell.cloudErrorGuestQuota')
    expect(cloudErrorKey('upstream_unavailable')).toBe('shell.cloudErrorUpstream')
    expect(cloudErrorKey('offline')).toBe('shell.cloudOffline')
    expect(cloudErrorKey('unknown_future_code')).toBe('shell.cloudErrorGeneric')
    expect(cloudErrorAction('quota_exhausted')).toBe('own-key')
    expect(cloudErrorAction('banned')).toBe('none')
    expect(cloudErrorAction('upstream_unavailable')).toBe('retry')
    expect(cloudErrorAction('sms_rate_limited')).toBe('countdown')
  })
})

/** 登录弹窗用的替身面。 */
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
    claimGuest: vi.fn(),
    usage: vi.fn(),
    selectRoute: vi.fn().mockResolvedValue({ ok: true, value: { provider: 'lcoder-cloud', model: 'deepseek-flash' } }),
    ...overrides,
  }
}

describe('登录弹窗', () => {
  it('连点发送验证码只发一次，并进入倒计时', async () => {
    const sendSms = vi.fn().mockResolvedValue({ ok: true, value: { requestId: 'r1', resendAfterSeconds: 60, expiresInSeconds: 300 } })
    const face = faceOf({ sendSms })
    render(
      <CloudDialog
        mode="login"
        face={face}
        state={null}
        sessionId={SessionId('s-1')}
        t={t}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/手机号/), { target: { value: '+8615550100000' } })
    const send = screen.getByRole('button', { name: zh['shell.cloudSendCode'] })
    fireEvent.click(send)
    fireEvent.click(send)
    await waitFor(() => { expect(sendSms).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.getAllByText(/60/).length).toBeGreaterThan(0) })
  })

  it('登录成功切当前会话到用户路由并关闭弹窗', async () => {
    const loginSms = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        user: { id: 'u1', displayName: null, phoneMasked: '+861****0000', status: 'active' },
        quota: {
          grantedMicroUsd: 20_000_000, reservedMicroUsd: 0, spentMicroUsd: 0, availableMicroUsd: 20_000_000, currency: 'USD',
        },
        expiresIn: 900,
      },
    })
    const selectRoute = vi.fn().mockResolvedValue({ ok: true, value: { provider: 'lcoder-cloud', model: 'deepseek-flash' } })
    const face = faceOf({ loginSms, selectRoute })
    const onClose = vi.fn()
    const onChanged = vi.fn()
    render(
      <CloudDialog
        mode="login"
        face={face}
        state={null}
        sessionId={SessionId('s-1')}
        t={t}
        onClose={onClose}
        onChanged={onChanged}
      />,
    )
    fireEvent.change(screen.getByLabelText(/手机号/), { target: { value: '+8615550100000' } })
    fireEvent.change(screen.getByLabelText(zh['shell.cloudCode']), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: zh['shell.cloudLoginSubmit'] }))
    await waitFor(() => {
      expect(loginSms).toHaveBeenCalledWith({ phone: '+8615550100000', code: '123456' })
      expect(selectRoute).toHaveBeenCalledWith('s-1', 'user')
      expect(onChanged).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('验证码发送太频繁时就地显示映射文案并给出倒计时', async () => {
    const sendSms = vi.fn().mockResolvedValue({ ok: false, error: { code: 'sms_rate_limited', message: 'slow down', retryAfterSeconds: 30 } })
    const face = faceOf({ sendSms })
    render(
      <CloudDialog mode="login" face={face} state={null} sessionId={SessionId('s-1')} t={t} onClose={() => {}} onChanged={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText(/手机号/), { target: { value: '+8615550100000' } })
    fireEvent.click(screen.getByRole('button', { name: zh['shell.cloudSendCode'] }))
    await waitFor(() => { expect(screen.getByText(zh['shell.cloudErrorSmsRateLimited'])).toBeTruthy() })
    expect(screen.getByText(/30/)).toBeTruthy()
  })
})
