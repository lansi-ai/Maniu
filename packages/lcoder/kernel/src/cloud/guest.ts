/**
 * 匿名立项授权：领取、复查剩余量、过期判定。
 *
 * 匿名令牌没有刷新概念；本地只缓存服务端返回的剩余量，过期即丢弃并提示
 * 登录。重复点击「立项分析」共享同一个领取 Future，不会产生第二个 grant。
 */
import { CloudApiError } from './api.ts'
import type { CloudAuthApi } from './api.ts'
import { cloudErrorInfo, jwtExpiresAt } from './tokens.ts'
import type { CloudErrorInfo, CloudGuestClaimInput, CloudGuestView } from './types.ts'
import { CLOUD_GUEST_REF } from './types.ts'
import type { CloudSecretStore } from './tokens.ts'

/** 匿名管理器需要的时间与状态缓存。 */
export interface CloudGuestOptions {
  readonly now?: () => number
  /** 服务端状态缓存；默认 5 秒。 */
  readonly statusCacheMs?: number
  readonly clientVersion?: string
}

/** 匿名授权的当前视图。 */
export interface CloudGuestSnapshot {
  readonly guest: CloudGuestView | null
  readonly expired: boolean
  readonly lastError: CloudErrorInfo | null
}

/** 匿名令牌与剩余量。 */
export class CloudGuestManager {
  private token: string | undefined
  private view: CloudGuestView | undefined
  private fetchedAt = 0
  private expired = false
  private lastError: CloudErrorInfo | null = null
  private hydrateFlight: Promise<void> | undefined
  private claimFlight: Promise<CloudGuestView> | undefined
  private readonly now: () => number
  private readonly statusCacheMs: number

  /**
   * @param api - 云端 HTTP 客户端。
   * @param store - 凭据存储。
   * @param fingerprint - 安装级设备指纹。
   * @param options - 时间与缓存。
   */
  constructor(
    private readonly api: Pick<CloudAuthApi, 'claimGuest' | 'guestStatus'>,
    private readonly store: CloudSecretStore,
    private readonly fingerprint: () => string | Promise<string>,
    private readonly options: CloudGuestOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.statusCacheMs = options.statusCacheMs ?? 5_000
  }

  /** 从凭据存储装载匿名令牌。 */
  async hydrate(): Promise<void> {
    if (this.hydrateFlight !== undefined) return this.hydrateFlight
    this.hydrateFlight = (async () => {
      const stored = await this.store.read(CLOUD_GUEST_REF)
      if (stored !== undefined) this.token = stored
    })().catch((error: unknown) => {
      this.lastError = cloudErrorInfo(error)
    }).finally(() => { this.hydrateFlight = undefined })
    return this.hydrateFlight
  }

  /**
   * 领取或复用匿名授权；重复点击共享同一个 Future。
   * @param input - 可选客户端版本与人机验证令牌。
   * @returns 服务端承认的授权状态。
   * @throws {CloudApiError} 领取失败；`device_already_granted` 时若本机还留着令牌会先复查剩余量。
   */
  async claim(input: CloudGuestClaimInput = {}): Promise<CloudGuestView> {
    await this.hydrate()
    if (this.claimFlight !== undefined) return this.claimFlight
    const flight = this.doClaim(input).finally(() => { this.claimFlight = undefined })
    this.claimFlight = flight
    return flight
  }

  /**
   * 查询剩余量；本地有缓存时直接返回。
   * @param force - true 时绕过缓存。
   * @returns 授权状态；没有令牌或已过期时返回 null。
   */
  async status(force = false): Promise<CloudGuestView | null> {
    await this.hydrate()
    if (this.token === undefined) return null
    if (!force && this.view !== undefined && this.now() - this.fetchedAt < this.statusCacheMs) return this.view
    try {
      const view = await this.api.guestStatus(this.token)
      this.view = view
      this.fetchedAt = this.now()
      this.expired = view.revoked
      this.lastError = null
      return view
    } catch (error: unknown) {
      const info = cloudErrorInfo(error)
      if (info.code === 'token_expired' || info.code === 'unauthorized') {
        await this.clear()
        this.expired = true
        this.lastError = { code: 'guest_expired', message: '今日免费立项已结束，登录后可继续。' }
        return null
      }
      this.lastError = info
      throw error
    }
  }

  /** 给界面读的快照；查询失败时保留上一次缓存并把原因带出来。 */
  async snapshot(): Promise<CloudGuestSnapshot> {
    try {
      await this.status()
    } catch {
      // `status` 已把原因写进 lastError；快照保留旧值，不把网络故障说成过期。
    }
    return { guest: this.view ?? null, expired: this.expired, lastError: this.lastError }
  }

  /**
   * 发起模型请求前确认匿名令牌仍可用。
   * @throws {CloudApiError} 没有令牌或令牌即将/已经过期。
   */
  async ensureUsable(): Promise<void> {
    await this.hydrate()
    if (this.token === undefined) {
      throw new CloudApiError({ code: 'guest_missing', message: '还没有领取今日免费立项。' })
    }
    const expiresAt = jwtExpiresAt(this.token)
    if (expiresAt !== undefined && expiresAt - this.now() <= 5_000) {
      await this.clear()
      this.expired = true
      throw new CloudApiError({ code: 'guest_expired', message: '今日免费立项已结束，登录后可继续。' })
    }
  }

  /** 清掉本机匿名令牌。 */
  async clear(): Promise<void> {
    this.token = undefined
    this.view = undefined
    this.fetchedAt = 0
    await this.store.remove(CLOUD_GUEST_REF)
  }

  private async doClaim(input: CloudGuestClaimInput): Promise<CloudGuestView> {
    if (this.token !== undefined) {
      const existing = await this.status(true)
      if (existing !== null) return existing
    }
    const deviceFingerprint = await this.fingerprint()
    try {
      const session = await this.api.claimGuest(deviceFingerprint, {
        ...this.options.clientVersion === undefined ? {} : { clientVersion: this.options.clientVersion },
        ...input.captchaToken === undefined ? {} : { captchaToken: input.captchaToken },
      })
      await this.store.write(CLOUD_GUEST_REF, session.guestToken)
      this.token = session.guestToken
      const view: CloudGuestView = {
        grantDate: session.grantDate,
        expiresAt: session.expiresAt,
        remainingRequests: session.limits.maxRequests,
        remainingCostMicroUsd: session.limits.maxCostMicroUsd,
        limits: session.limits,
        model: session.model,
        scope: session.scope,
        revoked: false,
      }
      this.view = view
      this.fetchedAt = this.now()
      this.expired = false
      this.lastError = null
      return view
    } catch (error: unknown) {
      const info = cloudErrorInfo(error)
      if (info.code === 'device_already_granted' || info.code === 'conflict') {
        const existing = await this.status(true)
        if (existing !== null) return existing
      }
      this.lastError = info
      throw error
    }
  }
}
