/**
 * 匿名授权：领取幂等、剩余量缓存、过期后清令牌。
 */
import { describe, expect, it, vi } from 'vitest'
import { CloudApiError } from '../src/cloud/api.ts'
import { CloudGuestManager } from '../src/cloud/guest.ts'
import type { CloudSecretStore } from '../src/cloud/tokens.ts'
import { CLOUD_GUEST_REF } from '../src/cloud/types.ts'
import type { CloudGuestView } from '../src/cloud/types.ts'

const NOW = 1_800_000_000_000

function jwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ exp, aud: 'lcoder-guest' })).toString('base64url')
  return `${header}.${body}.sig`
}

function view(remaining = 20): CloudGuestView {
  return {
    grantDate: '2026-11-06',
    expiresAt: new Date(NOW + 3600_000).toISOString(),
    remainingRequests: remaining,
    remainingCostMicroUsd: 150_000,
    limits: { maxRequests: 20, maxCostMicroUsd: 150_000, dailyGrantLimit: 1 },
    model: 'deepseek-flash',
    scope: 'onboarding',
    revoked: false,
  }
}

class MemoryStore implements CloudSecretStore {
  readonly values = new Map<string, string>()
  async read(ref: string): Promise<string | undefined> { return this.values.get(ref) }
  async write(ref: string, value: string): Promise<void> { this.values.set(ref, value) }
  async remove(ref: string): Promise<void> { this.values.delete(ref) }
}

function harness() {
  const store = new MemoryStore()
  const api = { claimGuest: vi.fn(), guestStatus: vi.fn() }
  const manager = new CloudGuestManager(api, store, async () => 'a'.repeat(64), { now: () => NOW, statusCacheMs: 5_000 })
  return { store, api, manager }
}

describe('CloudGuestManager', () => {
  it('领取一次并落盘匿名令牌', async () => {
    const h = harness()
    h.api.claimGuest.mockResolvedValue({
      guestToken: jwt(Math.floor(NOW / 1000) + 3600),
      tokenType: 'Bearer',
      expiresAt: new Date(NOW + 3600_000).toISOString(),
      grantDate: '2026-11-06',
      limits: { maxRequests: 20, maxCostMicroUsd: 150_000, dailyGrantLimit: 1 },
      model: 'deepseek-flash',
      scope: 'onboarding',
    })
    const claimed = await h.manager.claim({})
    expect(claimed.remainingRequests).toBe(20)
    expect(h.api.claimGuest).toHaveBeenCalledWith('a'.repeat(64), {})
    expect(h.store.values.get(CLOUD_GUEST_REF)).toContain('.')
  })

  it('并发领取共享同一个 Future，不会产生第二次 POST', async () => {
    const h = harness()
    let release = (): void => {}
    h.api.claimGuest.mockImplementation(() => new Promise((resolve) => {
      release = () => {
        resolve({
          guestToken: jwt(Math.floor(NOW / 1000) + 3600),
          tokenType: 'Bearer',
          expiresAt: new Date(NOW + 3600_000).toISOString(),
          grantDate: '2026-11-06',
          limits: { maxRequests: 20, maxCostMicroUsd: 150_000, dailyGrantLimit: 1 },
          model: 'deepseek-flash',
          scope: 'onboarding',
        })
      }
    }))
    const first = h.manager.claim({})
    const second = h.manager.claim({})
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    release()
    await Promise.all([first, second])
    expect(h.api.claimGuest).toHaveBeenCalledTimes(1)
  })

  it('已有令牌时先复查服务端剩余量，并缓存 5 秒', async () => {
    const h = harness()
    h.store.values.set(CLOUD_GUEST_REF, jwt(Math.floor(NOW / 1000) + 3600))
    h.api.guestStatus.mockResolvedValue(view(7))
    expect((await h.manager.status())?.remainingRequests).toBe(7)
    expect((await h.manager.status())?.remainingRequests).toBe(7)
    expect(h.api.guestStatus).toHaveBeenCalledTimes(1)
  })

  it('服务端判过期后清掉本机令牌并标记 guest_expired', async () => {
    const h = harness()
    h.store.values.set(CLOUD_GUEST_REF, jwt(Math.floor(NOW / 1000) + 3600))
    h.api.guestStatus.mockRejectedValue(new CloudApiError({ code: 'token_expired', message: 'ended' }))
    expect(await h.manager.status()).toBeNull()
    expect(h.store.values.has(CLOUD_GUEST_REF)).toBe(false)
    expect((await h.manager.snapshot()).expired).toBe(true)
  })

  it('本地令牌快过期时拒绝发起模型请求', async () => {
    const h = harness()
    h.store.values.set(CLOUD_GUEST_REF, jwt(Math.floor(NOW / 1000) + 1))
    await expect(h.manager.ensureUsable()).rejects.toMatchObject({ info: { code: 'guest_expired' } })
  })
})
