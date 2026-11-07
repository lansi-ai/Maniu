// @vitest-environment jsdom
/**
 * 个人中心：区间直出云端数值、不可用分支、用量分页与空态。
 *
 * 云端面全部用记录器替身；这里断言可见文案与发出的查询参数，不重算任何单价。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  CloudQuota, CloudState, CloudTokenEstimate, CloudUsageItem, CloudUsagePage, CloudUsageQuery,
} from '@lcoder/kernel/src/cloud/types.ts'
import { PersonalCenter } from '../src/client/cloud/PersonalCenter.tsx'
import type { CloudFace } from '../src/client/cloud/face.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

const PRICE = {
  inputMicroUsdPerMtok: 260_000,
  cachedInputMicroUsdPerMtok: 8_000,
  outputMicroUsdPerMtok: 500_000,
}

/** 云端按 $20、8:2 折算出的固定区间；断言界面直出这两个数。 */
const ESTIMATE: CloudTokenEstimate = {
  available: true,
  unavailableReason: null,
  model: 'deepseek-flash',
  availableMicroUsd: 20_000_000,
  lowerBoundTokens: 64_935_064,
  upperBoundTokens: 187_969_924,
  inputOutputRatio: '8:2',
  price: PRICE,
}

const QUOTA: CloudQuota = {
  grantedMicroUsd: 20_000_000,
  reservedMicroUsd: 0,
  spentMicroUsd: 2_500_000,
  availableMicroUsd: 17_500_000,
  currency: 'USD',
}

/** 登录态；预估默认可用。 */
function signedIn(overrides: Partial<CloudState> = {}): CloudState {
  return {
    signedIn: true,
    needsLogin: false,
    user: {
      id: 'u1',
      displayName: '阿蓝',
      phoneMasked: '+861****0000',
      status: 'active',
      createdAt: '2026-11-01T08:00:00.000Z',
      lastLoginAt: '2026-11-07T09:30:00.000Z',
    },
    quota: QUOTA,
    estimate: ESTIMATE,
    guest: null,
    guestExpired: false,
    lastError: null,
    ...overrides,
  }
}

/** 一条用量流水。 */
function usageAt(index: number): CloudUsageItem {
  return {
    requestId: `req-${index}`,
    source: 'user',
    model: 'deepseek-flash',
    promptTokens: 1_000 + index,
    cachedTokens: 200 + index,
    completionTokens: 300 + index,
    costMicroUsd: 12_345 + index,
    status: 'settled',
    createdAt: '2026-11-07T10:00:00.000Z',
  }
}

/** 云端面替身：只关心 usage 的入参与分页结果。 */
function faceOf(usage: (query: CloudUsageQuery) => Promise<{ ok: true; value: CloudUsagePage }>): CloudFace {
  return {
    available: true,
    state: vi.fn(),
    sendSms: vi.fn(),
    register: vi.fn(),
    loginSms: vi.fn(),
    loginPassword: vi.fn(),
    refresh: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    claimGuest: vi.fn(),
    usage: vi.fn(usage),
    selectRoute: vi.fn(),
  }
}

/** 一页空流水。 */
function emptyPage() {
  return vi.fn(async () => ({ ok: true as const, value: { items: [] as readonly CloudUsageItem[], nextCursor: null } }))
}

/** 渲染个人中心；返回发出的 usage 记录器。 */
function renderCenter(state: CloudState | null, usage = emptyPage()) {
  const face = faceOf(usage)
  render(
    <PersonalCenter
      face={face}
      state={state}
      t={t}
      onBack={vi.fn()}
      onOpenLogin={vi.fn()}
    />,
  )
  return usage
}

describe('个人中心 · token 预估', () => {
  it('区间直出云端数值，不做本地换算', () => {
    renderCenter(signedIn())
    expect(screen.getByText('约可用 64935064 到 187969924 token')).toBeTruthy()
    expect(screen.getByText('按输入输出 8:2 估算；实际用量随上下文长度变化。')).toBeTruthy()
    expect(screen.getByText('模型 deepseek-flash；可折算余额 $20.00')).toBeTruthy()
  })

  it('四种不可用原因各有独立文案', () => {
    const reasons = [
      ['no_effective_price', zh['shell.cloudEstimateNoPrice']],
      ['zero_unit_price', zh['shell.cloudEstimateZeroPrice']],
      ['zero_balance', zh['shell.cloudEstimateZeroBalance']],
      ['estimate_overflow', zh['shell.cloudEstimateOverflow']],
    ] as const
    for (const [reason, text] of reasons) {
      const view = render(
        <PersonalCenter
          face={faceOf(vi.fn())}
          state={signedIn({ estimate: { ...ESTIMATE, available: false, unavailableReason: reason } })}
          t={t}
          onBack={vi.fn()}
          onOpenLogin={vi.fn()}
        />,
      )
      expect(screen.getByText(text)).toBeTruthy()
      expect(screen.queryByText('约可用 0 到 0 token')).toBeNull()
      view.unmount()
    }
  })

  it('未登录与云端缺价都显示不可用，不把 0 当作预估', async () => {
    renderCenter(null)
    expect(screen.getByText(zh['shell.cloudEstimateUnavailable'])).toBeTruthy()
    expect(screen.queryByText('约可用 0 到 0 token')).toBeNull()
    cleanup()

    const usage = renderCenter(signedIn({
      estimate: { ...ESTIMATE, available: false, unavailableReason: 'no_effective_price', price: null },
    }))
    expect(screen.getByText(zh['shell.cloudEstimateNoPrice'])).toBeTruthy()
    expect(screen.queryByText('约可用 0 到 0 token')).toBeNull()
    await waitFor(() => { expect(usage).toHaveBeenCalledTimes(1) })
  })

  it('匿名授权也展示云端给出的预估', () => {
    renderCenter({
      signedIn: false,
      needsLogin: false,
      user: null,
      quota: null,
      estimate: null,
      guest: {
        grantDate: '2026-11-07',
        expiresAt: '2026-11-08T00:00:00.000Z',
        remainingRequests: 12,
        remainingCostMicroUsd: 90_000,
        limits: { maxRequests: 20, maxCostMicroUsd: 150_000, dailyGrantLimit: 1 },
        model: 'deepseek-flash',
        scope: 'onboarding',
        revoked: false,
        estimate: { ...ESTIMATE, availableMicroUsd: 90_000, lowerBoundTokens: 292_207, upperBoundTokens: 846_100 },
      },
      guestExpired: false,
      lastError: null,
    })
    expect(screen.getByText('约可用 292207 到 846100 token')).toBeTruthy()
    expect(screen.getByText(zh['shell.cloudUsageSignIn'])).toBeTruthy()
  })
})

describe('个人中心 · 用量流水', () => {
  it('首屏取一页，加载更多带游标追加', async () => {
    const pageOne = { items: [usageAt(1), usageAt(2)], nextCursor: 'c2' }
    const pageTwo = { items: [usageAt(3), usageAt(4), usageAt(5)], nextCursor: null }
    const usage = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: pageOne })
      .mockResolvedValueOnce({ ok: true, value: pageTwo })
    renderCenter(signedIn(), usage)

    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(2) })
    expect(usage).toHaveBeenNthCalledWith(1, { limit: 20 })

    fireEvent.click(screen.getByRole('button', { name: zh['shell.cloudUsageMore'] }))
    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(5) })
    expect(usage).toHaveBeenNthCalledWith(2, { limit: 20, cursor: 'c2' })
    expect(screen.queryByRole('button', { name: zh['shell.cloudUsageMore'] })).toBeNull()
  })

  it('空列表给空态，不给加载更多', async () => {
    renderCenter(signedIn(), emptyPage())
    await waitFor(() => { expect(screen.getByText(zh['shell.cloudUsageEmpty'])).toBeTruthy() })
    expect(screen.queryByRole('button', { name: zh['shell.cloudUsageMore'] })).toBeNull()
  })

  it('不足一分钱的花费保留四位小数', async () => {
    const usage = vi.fn(async () => ({
      ok: true as const,
      value: { items: [{ ...usageAt(1), costMicroUsd: 2_000 }], nextCursor: null },
    }))
    renderCenter(signedIn(), usage)
    await waitFor(() => { expect(screen.getByText('$0.0020')).toBeTruthy() })
    expect(within(screen.getByRole('listitem')).queryByText('$0.00')).toBeNull()
  })
})

/** 递归列出目录下的源码文件。 */
function sourcesAt(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory()) return sourcesAt(path)
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : []
  })
}

describe('个人中心 · 单价只在云端', () => {
  it('客户端源码不含单价常量与 8:2 折算公式', () => {
    const fromRepo = resolve(process.cwd(), 'packages/lcoder/workspace/src/client')
    const root = existsSync(fromRepo) ? fromRepo : resolve(process.cwd(), 'src/client')
    const offenders = sourcesAt(root).filter((file) => {
      const text = readFileSync(file, 'utf8')
      return [
        /(?:input|cachedInput|output)MicroUsdPerMtok\s*[:=]\s*[\d_]/u,
        /inputOutputRatio\s*[:=]\s*['"]8:2['"]/u,
        /0\.8\s*\*[^;\n]*\+\s*0\.2\s*\*/u,
      ].some(pattern => pattern.test(text))
    })
    expect(offenders).toEqual([])
  })
})
