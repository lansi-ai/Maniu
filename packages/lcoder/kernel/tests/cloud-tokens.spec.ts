/**
 * 令牌生命周期的行为：单飞刷新、轮换落盘顺序、401 只重试一次、登出清理。
 *
 * 凭据存储与 HTTP 面都用记录器替身；这里不碰网络，也不写真实凭据。
 */
import { describe, expect, it, vi } from 'vitest'
import { CloudApiError } from '../src/cloud/api.ts'
import type { CloudAuthSession, CloudMeValue } from '../src/cloud/api.ts'
import { CloudTokenManager, jwtExpiresAt } from '../src/cloud/tokens.ts'
import type { CloudSecretStore } from '../src/cloud/tokens.ts'
import { CLOUD_ACCESS_REF, CLOUD_REFRESH_REF } from '../src/cloud/types.ts'

const NOW = 1_800_000_000_000

/** 造一个带 exp 的 JWT；签名不参与本层校验。 */
function jwt(exp: number, sub = 'user-1'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ sub, exp, aud: 'lcoder-api' })).toString('base64url')
  return `${header}.${body}.sig`
}

/** 一次登录/刷新会话。 */
function session(access: string, refresh: string): CloudAuthSession {
  return {
    accessToken: access,
    tokenType: 'Bearer',
    expiresIn: 900,
    refreshToken: refresh,
    refreshExpiresAt: new Date(NOW + 30 * 24 * 3600 * 1000).toISOString(),
    user: {
      id: 'user-1',
      displayName: null,
      phoneMasked: '+861****0000',
      status: 'active',
      quota: {
        grantedMicroUsd: 20_000_000,
        reservedMicroUsd: 0,
        spentMicroUsd: 0,
        availableMicroUsd: 20_000_000,
        currency: 'USD',
      },
    },
  }
}

/** 内存凭据存储；`failWrite` 可让某一条写入失败。 */
class MemoryStore implements CloudSecretStore {
  readonly values = new Map<string, string>()
  readonly writes: string[] = []
  failWrite: string | undefined

  async read(ref: string): Promise<string | undefined> { return this.values.get(ref) }
  async write(ref: string, value: string): Promise<void> {
    if (this.failWrite === ref) throw new Error('disk full')
    this.writes.push(ref)
    this.values.set(ref, value)
  }
  async remove(ref: string): Promise<void> { this.values.delete(ref) }
}

/** 一套可用的令牌面替身。 */
function harness(accessExp = Math.floor(NOW / 1000) + 900) {
  const store = new MemoryStore()
  const api = {
    refresh: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
  }
  const manager = new CloudTokenManager(api, store, {
    now: () => NOW,
    sleep: async () => {},
    meCacheMs: 1,
    refreshTimeoutMs: 5_000,
  })
  return { store, api, manager, access: jwt(accessExp), refresh: 'refresh-1' }
}

describe('jwtExpiresAt', () => {
  it('解码 JWT 的秒级 exp，非 JWT 返回 undefined', () => {
    expect(jwtExpiresAt(jwt(1_900_000_000))).toBe(1_900_000_000_000)
    expect(jwtExpiresAt('opaque-token')).toBeUndefined()
  })
})

describe('CloudTokenManager', () => {
  it('访问令牌还新鲜时直接返回，不刷新', async () => {
    const h = harness()
    h.store.values.set(CLOUD_ACCESS_REF, h.access)
    h.store.values.set(CLOUD_REFRESH_REF, h.refresh)
    expect(await h.manager.ensureFresh(60_000)).toBe(h.access)
    expect(h.api.refresh).not.toHaveBeenCalled()
  })

  it('并发过期请求只发出一次刷新，且先写刷新令牌再写访问令牌', async () => {
    const h = harness(Math.floor(NOW / 1000) - 1)
    h.store.values.set(CLOUD_ACCESS_REF, h.access)
    h.store.values.set(CLOUD_REFRESH_REF, h.refresh)
    const next = session(jwt(Math.floor(NOW / 1000) + 900), 'refresh-2')
    h.api.refresh.mockResolvedValue(next)
    const [first, second, third] = await Promise.all([
      h.manager.ensureFresh(), h.manager.ensureFresh(), h.manager.ensureFresh(),
    ])
    expect(first).toBe(next.accessToken)
    expect(second).toBe(next.accessToken)
    expect(third).toBe(next.accessToken)
    expect(h.api.refresh).toHaveBeenCalledTimes(1)
    expect(h.store.writes).toEqual([CLOUD_REFRESH_REF, CLOUD_ACCESS_REF])
    expect(h.store.values.get(CLOUD_REFRESH_REF)).toBe('refresh-2')
    expect(h.store.values.get(CLOUD_ACCESS_REF)).toBe(next.accessToken)
  })

  it('刷新令牌已轮换但访问令牌写失败时停止使用新令牌并标记重新登录', async () => {
    const h = harness(Math.floor(NOW / 1000) - 1)
    h.store.values.set(CLOUD_ACCESS_REF, h.access)
    h.store.values.set(CLOUD_REFRESH_REF, h.refresh)
    h.store.failWrite = CLOUD_ACCESS_REF
    h.api.refresh.mockResolvedValue(session(jwt(Math.floor(NOW / 1000) + 900), 'refresh-2'))
    await expect(h.manager.ensureFresh()).rejects.toMatchObject({ info: { code: 'needs_login' } })
    expect(h.store.values.get(CLOUD_REFRESH_REF)).toBe('refresh-2')
    expect(h.store.values.has(CLOUD_ACCESS_REF)).toBe(true)
    const state = await h.manager.state()
    expect(state.signedIn).toBe(false)
    expect(state.needsLogin).toBe(true)
  })

  it('401 时单飞刷新并只重试一次', async () => {
    const h = harness()
    h.store.values.set(CLOUD_ACCESS_REF, h.access)
    h.store.values.set(CLOUD_REFRESH_REF, h.refresh)
    h.api.refresh.mockResolvedValue(session(jwt(Math.floor(NOW / 1000) + 900), 'refresh-2'))
    const operation = vi.fn()
      .mockRejectedValueOnce(new CloudApiError({ code: 'token_expired', message: 'expired' }))
      .mockResolvedValueOnce('done')
    expect(await h.manager.authenticated(operation)).toBe('done')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(h.api.refresh).toHaveBeenCalledTimes(1)
  })

  it('重试后仍 401 就清本机令牌并进入登录', async () => {
    const h = harness()
    h.store.values.set(CLOUD_ACCESS_REF, h.access)
    h.store.values.set(CLOUD_REFRESH_REF, h.refresh)
    h.api.refresh.mockResolvedValue(session(jwt(Math.floor(NOW / 1000) + 900), 'refresh-2'))
    const operation = vi.fn().mockRejectedValue(new CloudApiError({ code: 'token_expired', message: 'expired' }))
    await expect(h.manager.authenticated(operation)).rejects.toMatchObject({ info: { code: 'needs_login' } })
    expect(operation).toHaveBeenCalledTimes(2)
    expect(h.store.values.has(CLOUD_ACCESS_REF)).toBe(false)
    expect(h.store.values.has(CLOUD_REFRESH_REF)).toBe(false)
  })

  it('刷新本身 401 时清掉刷新令牌，不拿同一个令牌重试', async () => {
    const h = harness(Math.floor(NOW / 1000) - 1)
    h.store.values.set(CLOUD_ACCESS_REF, h.access)
    h.store.values.set(CLOUD_REFRESH_REF, h.refresh)
    h.api.refresh.mockRejectedValue(new CloudApiError({ code: 'unauthorized', message: 'revoked' }))
    await expect(h.manager.ensureFresh()).rejects.toMatchObject({ info: { code: 'needs_login' } })
    expect(h.api.refresh).toHaveBeenCalledTimes(1)
    expect(h.store.values.has(CLOUD_REFRESH_REF)).toBe(false)
  })

  it('网络失败按退避重试两次，仍失败交给离线', async () => {
    const h = harness(Math.floor(NOW / 1000) - 1)
    h.store.values.set(CLOUD_REFRESH_REF, h.refresh)
    h.api.refresh.mockRejectedValue(new CloudApiError({ code: 'offline', message: 'down' }))
    await expect(h.manager.ensureFresh()).rejects.toMatchObject({ info: { code: 'offline' } })
    expect(h.api.refresh).toHaveBeenCalledTimes(3)
  })

  it('登出时服务端失败也清本机两个令牌', async () => {
    const h = harness()
    await h.manager.login(session(h.access, h.refresh))
    h.api.logout.mockRejectedValue(new CloudApiError({ code: 'offline', message: 'down' }))
    await h.manager.logout()
    expect(h.store.values.has(CLOUD_ACCESS_REF)).toBe(false)
    expect(h.store.values.has(CLOUD_REFRESH_REF)).toBe(false)
  })

  it('刷新成功后缓存用户与额度，再读 me 只补一次预估', async () => {
    const h = harness(Math.floor(NOW / 1000) - 1)
    h.store.values.set(CLOUD_REFRESH_REF, h.refresh)
    h.api.refresh.mockResolvedValue(session(jwt(Math.floor(NOW / 1000) + 900), 'refresh-2'))
    const cached = session(h.access, h.refresh).user
    const me: CloudMeValue = {
      user: cached,
      quota: cached.quota,
      estimate: {
        available: true,
        unavailableReason: null,
        model: 'deepseek-flash',
        availableMicroUsd: 20_000_000,
        lowerBoundTokens: 64_935_064,
        upperBoundTokens: 187_969_924,
        inputOutputRatio: '8:2',
        price: { inputMicroUsdPerMtok: 260_000, cachedInputMicroUsdPerMtok: 8_000, outputMicroUsdPerMtok: 500_000 },
      },
    }
    h.api.me.mockResolvedValue(me)
    const state = await h.manager.state()
    expect(state.signedIn).toBe(true)
    expect(state.quota?.availableMicroUsd).toBe(20_000_000)
    expect(h.api.me).toHaveBeenCalledTimes(1)
    expect(state.estimate?.lowerBoundTokens).toBe(64_935_064)
    expect(state.estimate?.upperBoundTokens).toBe(187_969_924)
  })
})
