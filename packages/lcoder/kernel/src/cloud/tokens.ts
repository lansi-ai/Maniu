/**
 * 用户令牌的生命周期：单飞刷新、轮换落盘、401 只重试一次、到期前主动续期。
 *
 * 落盘顺序固定为「先刷新令牌、后访问令牌」：刷新成功但访问令牌没写住时，
 * 停止使用新访问令牌并把账号标为需要重新登录；绝不会出现刷新令牌已轮换、
 * 本机却还拿着旧族继续用的状态。
 */
import { CloudApiError } from './api.ts'
import type { CloudAuthApi, CloudAuthSession } from './api.ts'
import type {
  CloudAuthValue, CloudErrorInfo, CloudQuota, CloudState, CloudTokenEstimate, CloudUsagePage, CloudUsageQuery,
  CloudUser,
} from './types.ts'
import { CLOUD_ACCESS_REF, CLOUD_REFRESH_REF } from './types.ts'

/** 凭据引用面的最小读写形状；由宿主用 `ctx.credentials` 适配。 */
export interface CloudSecretStore {
  read(ref: string): Promise<string | undefined>
  write(ref: string, value: string): Promise<void>
  remove(ref: string): Promise<void>
}

/** 本模块只记“成功/失败/耗时/requestId”，不记令牌。 */
export interface CloudLogger {
  warn(message: string, ...args: unknown[]): void
}

/** 可注入的时间与等待；测试不必碰真实计时器。 */
export interface CloudTokenOptions {
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly logger?: CloudLogger
  /** 小于该剩余时间就刷新；默认 60 秒。 */
  readonly refreshSkewMs?: number
  /** 刷新最多阻塞多久；默认 5 秒。 */
  readonly refreshTimeoutMs?: number
  /** `/v1/me` 的展示缓存；默认 15 秒。 */
  readonly meCacheMs?: number
}

interface AccessState {
  readonly token: string
  readonly expiresAt: number
}

/** 刷新重试的退避；最多 3 次尝试，仍失败就按离线交给调用方。 */
const RETRY_DELAYS_MS = [0, 500, 1_000] as const

/** 解码 JWT 的 `exp`（秒）；不是 JWT 或没有 exp 时返回 undefined。 */
export function jwtExpiresAt(token: string): number | undefined {
  const segments = token.split('.')
  if (segments.length < 2) return undefined
  const payload = segments[1]
  if (payload === undefined) return undefined
  try {
    const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(decoded)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const exp = (parsed as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined
  } catch {
    return undefined
  }
}

/** 把未知错误折成可展示的 code；调用方不解析原文。 */
export function cloudErrorInfo(error: unknown): CloudErrorInfo {
  if (error instanceof CloudApiError) return error.info
  return { code: 'internal_error', message: error instanceof Error ? error.message : String(error) }
}

/** 一个账号的令牌状态。 */
export class CloudTokenManager {
  private access: AccessState | undefined
  private refreshToken: string | undefined
  private user: CloudUser | undefined
  private quota: CloudQuota | undefined
  private estimate: CloudTokenEstimate | undefined
  private lastError: CloudErrorInfo | null = null
  private meFetchedAt = 0
  private hydrateFlight: Promise<void> | undefined
  private refreshFlight: Promise<string> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly refreshSkewMs: number
  private readonly refreshTimeoutMs: number
  private readonly meCacheMs: number

  /**
   * @param api - 云端 HTTP 客户端。
   * @param store - 凭据存储。
   * @param options - 时间、退避与缓存。
   */
  constructor(
    private readonly api: Pick<CloudAuthApi, 'refresh' | 'me' | 'usage' | 'logout'>,
    private readonly store: CloudSecretStore,
    private readonly options: CloudTokenOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? (ms => new Promise((resolve) => { setTimeout(resolve, ms) }))
    this.refreshSkewMs = options.refreshSkewMs ?? 60_000
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? 5_000
    this.meCacheMs = options.meCacheMs ?? 15_000
  }

  /** 从凭据存储装载一次；重复调用共享同一个装载。 */
  async hydrate(): Promise<void> {
    if (this.hydrateFlight !== undefined) return this.hydrateFlight
    this.hydrateFlight = (async () => {
      const [accessToken, refreshToken] = await Promise.all([
        this.store.read(CLOUD_ACCESS_REF),
        this.store.read(CLOUD_REFRESH_REF),
      ])
      if (refreshToken !== undefined) this.refreshToken = refreshToken
      if (accessToken !== undefined) {
        const expiresAt = jwtExpiresAt(accessToken) ?? 0
        this.access = { token: accessToken, expiresAt }
      }
    })().catch((error: unknown) => {
      this.lastError = cloudErrorInfo(error)
    }).finally(() => { this.hydrateFlight = undefined })
    return this.hydrateFlight
  }

  /** 当前是否存着一族刷新令牌。 */
  hasRefreshToken(): boolean {
    return this.refreshToken !== undefined
  }

  /**
   * 保证访问令牌至少还有 `minRemainingMs`；不足就先刷新。
   * @param minRemainingMs - 阈值；默认 60 秒。
   * @returns 可用的访问令牌。
   * @throws {CloudApiError} 没有刷新令牌或刷新失败。
   */
  async ensureFresh(minRemainingMs = this.refreshSkewMs): Promise<string> {
    await this.hydrate()
    if (this.access !== undefined && this.access.expiresAt - this.now() > minRemainingMs) return this.access.token
    if (this.refreshToken === undefined) {
      throw new CloudApiError({ code: 'needs_login', message: '登录状态已失效，请重新登录。' })
    }
    return this.refresh()
  }

  /**
   * 单飞刷新；并发调用共享同一个在途请求。
   * @param force - true 时即使访问令牌还新鲜也刷新。
   * @returns 新的访问令牌。
   */
  async refresh(force = false): Promise<string> {
    await this.hydrate()
    if (!force && this.access !== undefined && this.access.expiresAt - this.now() > this.refreshSkewMs) {
      return this.access.token
    }
    if (this.refreshFlight !== undefined) return this.refreshFlight
    const flight = this.doRefresh().finally(() => { this.refreshFlight = undefined })
    this.refreshFlight = flight
    return flight
  }

  /**
   * 强制刷新并返回公开资料；账号弹窗的「刷新」用它。
   * @returns 用户与额度。
   */
  async refreshNow(): Promise<CloudAuthValue> {
    await this.refresh(true)
    return this.authValue()
  }

  /** 用已登录的访问令牌发一次请求；401 时刷新并只重试一次。 */
  async authenticated<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    const token = await this.ensureFresh()
    try {
      return await operation(token)
    } catch (error: unknown) {
      const info = cloudErrorInfo(error)
      if (info.code !== 'token_expired' && info.code !== 'unauthorized') throw error
      const refreshed = await this.refresh(true)
      try {
        return await operation(refreshed)
      } catch (retryError: unknown) {
        const retryInfo = cloudErrorInfo(retryError)
        if (retryInfo.code === 'token_expired' || retryInfo.code === 'unauthorized') {
          await this.clear()
          this.lastError = { code: 'needs_login', message: '登录状态已失效，请重新登录。' }
          throw new CloudApiError(this.lastError)
        }
        throw retryError
      }
    }
  }

  /**
   * 登录成功后接管会话。
   * @param session - 云端返回的完整会话。
   */
  async login(session: CloudAuthSession): Promise<void> {
    await this.applySession(session)
    this.lastError = null
  }

  /** 登出：无论服务端是否成功都清本机两个令牌。 */
  async logout(): Promise<void> {
    const token = this.access?.token
    if (token !== undefined) {
      try {
        await this.api.logout(token)
      } catch (error: unknown) {
        // 服务端撤销失败不阻止本地清理；访问令牌最多再存活 15 分钟。
        this.options.logger?.warn('lcoder-cloud: logout request failed (%s)', cloudErrorInfo(error).code)
      }
    }
    await this.clear()
    this.lastError = null
  }

  /** 读 `/v1/me` 并更新展示缓存。 */
  async me(): Promise<CloudAuthValue> {
    const value = await this.authenticated(token => this.api.me(token))
    this.user = value.user
    this.quota = value.quota
    this.estimate = value.estimate ?? undefined
    this.meFetchedAt = this.now()
    this.lastError = null
    return this.authValue()
  }

  /**
   * 读一页用量流水。
   * @param query - 分页与筛选参数。
   * @returns 流水与下一页游标。
   * @throws {CloudApiError} 未登录、令牌失效或云端不可用。
   */
  async usage(query: CloudUsageQuery = {}): Promise<CloudUsagePage> {
    return this.authenticated(token => this.api.usage(token, query))
  }

  /**
   * 给界面与门禁读的状态；后台失败只记在 `lastError`，不抛。
   * @returns 登录状态、用户、额度与最近错误。
   */
  async state(): Promise<CloudState> {
    await this.hydrate()
    if (this.refreshToken === undefined && this.access === undefined) return this.stateOf(false)
    if (this.access === undefined || this.access.expiresAt - this.now() <= this.refreshSkewMs) {
      try {
        await this.refresh()
      } catch (error: unknown) {
        this.lastError = cloudErrorInfo(error)
        const needsLogin = this.refreshToken === undefined
          || this.lastError.code === 'needs_login'
        return this.stateOf(this.access !== undefined && this.access.expiresAt > this.now(), needsLogin)
      }
    }
    if (this.user === undefined || this.now() - this.meFetchedAt > this.meCacheMs) {
      try {
        await this.me()
      } catch (error: unknown) {
        this.lastError = cloudErrorInfo(error)
        const needsLogin = this.lastError.code === 'needs_login'
          || this.lastError.code === 'token_expired'
          || this.lastError.code === 'unauthorized'
        return this.stateOf(this.access !== undefined && !needsLogin, needsLogin)
      }
    }
    return this.stateOf(true)
  }

  /** 清掉定时器；插件卸载时调用。 */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private stateOf(signedIn: boolean, needsLogin = false): CloudState {
    return {
      signedIn,
      needsLogin,
      user: this.user ?? null,
      quota: this.quota ?? null,
      estimate: this.estimate ?? null,
      guest: null,
      guestExpired: false,
      lastError: this.lastError,
    }
  }

  private authValue(): CloudAuthValue {
    if (this.user === undefined || this.quota === undefined) {
      throw new CloudApiError({ code: 'internal_error', message: '登录资料不完整。' })
    }
    return {
      user: this.user,
      quota: this.quota,
      expiresIn: this.access === undefined ? 0 : Math.max(0, Math.floor((this.access.expiresAt - this.now()) / 1000)),
    }
  }

  private async doRefresh(): Promise<string> {
    const refreshToken = this.refreshToken
    if (refreshToken === undefined) {
      this.lastError = { code: 'needs_login', message: '登录状态已失效，请重新登录。' }
      throw new CloudApiError(this.lastError)
    }
    const deadline = this.now() + this.refreshTimeoutMs
    let last: CloudApiError | undefined
    for (const delay of RETRY_DELAYS_MS) {
      if (delay > 0) await this.sleep(delay)
      const remaining = deadline - this.now()
      if (remaining <= 0) break
      try {
        const session = await this.api.refresh(refreshToken, remaining)
        await this.applySession(session)
        this.lastError = null
        return session.accessToken
      } catch (error: unknown) {
        const info = cloudErrorInfo(error)
        last = error instanceof CloudApiError ? error : new CloudApiError(info)
        if (info.code === 'token_expired' || info.code === 'unauthorized' || info.code === 'invalid_credentials') {
          await this.clear()
          this.lastError = { code: 'needs_login', message: '登录状态已失效，请重新登录。' }
          throw new CloudApiError(this.lastError)
        }
        if (info.code !== 'offline' && info.code !== 'upstream_unavailable'
          && info.code !== 'upstream_timeout' && (info.status ?? 0) < 500) {
          break
        }
        this.options.logger?.warn('lcoder-cloud: refresh failed (%s), retrying', info.code)
      }
    }
    this.lastError = last?.info ?? { code: 'offline', message: '云端暂时不可用，请稍后重试。' }
    throw last ?? new CloudApiError(this.lastError)
  }

  private async applySession(session: CloudAuthSession): Promise<void> {
    // 顺序是契约：先刷新令牌，再访问令牌。任一步失败都停止用新令牌。
    await this.store.write(CLOUD_REFRESH_REF, session.refreshToken)
    try {
      await this.store.write(CLOUD_ACCESS_REF, session.accessToken)
    } catch (error: unknown) {
      this.access = undefined
      this.lastError = {
        code: 'needs_login',
        message: '新的访问令牌没有写入本机，请重新登录。',
      }
      this.options.logger?.warn('lcoder-cloud: access token write failed (%s)', cloudErrorInfo(error).code)
      throw new CloudApiError(this.lastError)
    }
    this.refreshToken = session.refreshToken
    this.access = {
      token: session.accessToken,
      expiresAt: jwtExpiresAt(session.accessToken) ?? this.now() + session.expiresIn * 1000,
    }
    this.user = session.user
    this.quota = session.user.quota
    // 登录响应不带预估；下一次读状态时补 `/v1/me`，别让缓存把预估挡在 15 秒外。
    this.estimate = undefined
    this.meFetchedAt = 0
    this.schedule()
  }

  private async clear(): Promise<void> {
    this.access = undefined
    this.refreshToken = undefined
    this.user = undefined
    this.quota = undefined
    this.estimate = undefined
    this.meFetchedAt = 0
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.store.remove(CLOUD_ACCESS_REF)
    await this.store.remove(CLOUD_REFRESH_REF)
  }

  private schedule(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    const expiresAt = this.access?.expiresAt
    if (expiresAt === undefined) return
    const delay = Math.max(1_000, expiresAt - this.now() - this.refreshSkewMs)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.refresh().catch((error: unknown) => {
        this.options.logger?.warn('lcoder-cloud: scheduled refresh failed (%s)', cloudErrorInfo(error).code)
        if (!this.disposed && this.refreshToken !== undefined) {
          this.timer = setTimeout(() => { this.schedule() }, 60_000)
        }
      })
    }, delay)
    this.timer.unref()
  }
}
